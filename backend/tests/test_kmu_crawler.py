from datetime import date, datetime

from app.services.crawler import KMUCrawler


LIST_HTML = """
<table>
  <tbody>
    <tr>
      <td class="num">1</td>
      <td class="subject">
        <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=123&amp;srchBgpUid=-1&amp;mnu_uid=143"
           title="AI 세미나 참가자 모집">AI 세미나 참가자 모집</a>
      </td>
      <td class="writer">교육혁신팀</td>
      <td class="date">26-07-01</td>
      <td class="file"></td>
      <td class="hit">10</td>
    </tr>
    <tr>
      <td class="num">2</td>
      <td class="subject">
        <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=124&amp;srchBgpUid=-1&amp;mnu_uid=143"
           title="일반 행정 안내">일반 행정 안내</a>
      </td>
      <td class="writer">총무팀</td>
      <td class="date">26-07-02</td>
      <td class="file"></td>
      <td class="hit">11</td>
    </tr>
  </tbody>
</table>
"""


DETAIL_HTML = """
<div class="bbs_view">
  <div class="bbs_info">
    <dl class="subject"><dt>제목</dt><dd>AI 세미나 참가자 모집</dd></dl>
    <dl>
      <dt>작성자</dt><dd>교육혁신팀</dd>
      <dt>일시</dt><dd>2026-07-01 12:00:00</dd>
    </dl>
  </div>
  <div class="bbs_con">
    <p>행사 일시: 7. 15. ~ 7. 16.</p>
    <p>시간: 13:00 ~ 15:30</p>
    <p>장소 : 동천관 국제세미나실</p>
    <p>신청기간: 7. 1. ~ 7. 10.</p>
    <a href="https://story.kmu.ac.kr/apply">신청 바로가기</a>
  </div>
</div>
"""


def test_parse_kmu_notice_list_and_keyword_filter():
    crawler = KMUCrawler(target_year=2026)
    posts = crawler.parse_list(LIST_HTML, "https://www.kmu.ac.kr/page.jsp?mnu_uid=143")

    assert len(posts) == 2
    assert posts[0].title == "AI 세미나 참가자 모집"
    assert posts[0].source_key == "kmu:143:123"
    assert posts[0].posted_at.isoformat() == "2026-07-01"
    assert crawler.should_include_post(posts[0]) is True
    assert crawler.should_include_post(posts[1]) is False


def test_parse_kmu_detail_extracts_event_datetime_and_location():
    crawler = KMUCrawler(target_year=2026)
    post = crawler.parse_list(
        LIST_HTML, "https://www.kmu.ac.kr/page.jsp?mnu_uid=143"
    )[0]

    event = crawler.parse_detail(
        DETAIL_HTML,
        post,
        "https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&parm_bod_uid=123&mnu_uid=143",
    )

    assert event["starts_at"] == datetime(2026, 7, 15, 13, 0)
    assert event["ends_at"] == datetime(2026, 7, 16, 15, 30)
    assert event["apply_deadline"] == datetime(2026, 7, 10, 23, 59, 59)
    assert "행사 일시: 7. 15. ~ 7. 16.\n시간: 13:00 ~ 15:30" in event["summary"]
    assert event["location"] == "동천관 국제세미나실"
    assert event["category"] == "특강"
    assert event["interests"] == "ai"
    assert event["apply_url"] == "https://story.kmu.ac.kr/apply"


def test_apply_deadline_uses_keyword_neighbor_lines():
    crawler = KMUCrawler(target_year=2026)

    deadline = crawler._extract_apply_deadline(
        "1) 모집 기간\n: ~ 2026. 7. 5.(일) 23:59 까지",
        date(2026, 7, 1),
    )

    assert deadline == datetime(2026, 7, 5, 23, 59)


def test_apply_deadline_uses_ocr_text_application_period():
    crawler = KMUCrawler(target_year=2026, image_ocr=False)

    deadline = crawler._extract_apply_deadline(
        (
            "신청기간\n"
            "1) 오프라인 : 6월 15일(월) ~ 7월 10일(금)\n"
            "어학상담실 방문 또는 유선 신청 가능\n"
            "2) 온라인 : 6월 15일(월) ~ 7월 12일(일)"
        ),
        date(2026, 6, 20),
    )

    assert deadline == datetime(2026, 7, 12, 23, 59, 59)


def test_apply_deadline_parses_korean_pm_time():
    crawler = KMUCrawler(target_year=2026, image_ocr=False)

    deadline = crawler._extract_apply_deadline(
        "원서제출: 2026년 8월 3일(월) ~ 8월 28일(금) 오후 5시, 온라인 및 우편 접수",
        date(2026, 4, 29),
    )

    assert deadline == datetime(2026, 8, 28, 17, 0)


def test_apply_deadline_does_not_use_later_notice_dates_when_period_line_has_date():
    crawler = KMUCrawler(target_year=2026, image_ocr=False)

    deadline = crawler._extract_apply_deadline(
        "\n".join(
            [
                "1) 모집 기간 : ~ 2026. 7. 5.(일) 23:59 까지",
                "2) 모집 대상 : 재학생",
                "5) 최종 수상자 공지 : 7. 13.(월) 예정",
                "- 계명스튜던트포털 시스템을 통한 신청 및 출품작 제출",
                "- 서류 심사 기한 : ~ 7. 9.(목)",
            ]
        ),
        date(2026, 6, 18),
    )

    assert deadline == datetime(2026, 7, 5, 23, 59)


def test_education_posts_are_included_and_categorized():
    crawler = KMUCrawler(target_year=2026)
    html = """
    <table>
      <tbody>
        <tr>
          <td class="subject">
            <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=222&amp;srchBgpUid=-1&amp;mnu_uid=143"
               title="디지털 역량 교육 프로그램 참가자 모집">디지털 역량 교육 프로그램 참가자 모집</a>
          </td>
          <td class="writer">교육혁신팀</td>
          <td class="date">26-07-03</td>
        </tr>
      </tbody>
    </table>
    """

    post = crawler.parse_list(html, "https://www.kmu.ac.kr/page.jsp?mnu_uid=143")[0]
    event = crawler.parse_detail(
        """
        <div class="bbs_view">
          <div class="bbs_info">
            <dl class="subject"><dt>제목</dt><dd>디지털 역량 교육 프로그램 참가자 모집</dd></dl>
            <dl><dt>작성자</dt><dd>교육혁신팀</dd></dl>
          </div>
          <div class="bbs_con">
            <p>교육일: 7. 20.</p>
            <p>시간: 10:00 ~ 12:00</p>
            <p>장소: 바우어관 멀티미디어실</p>
          </div>
        </div>
        """,
        post,
        "https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&parm_bod_uid=222&mnu_uid=143",
    )

    assert crawler.should_include_post(post) is True
    assert event["category"] == "교육"
    assert "education" in event["interests"]


def test_previous_year_posts_are_excluded():
    crawler = KMUCrawler(target_year=2026)
    html = """
    <table>
      <tbody>
        <tr>
          <td class="subject">
            <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=225&amp;srchBgpUid=-1&amp;mnu_uid=143"
               title="작년 교육 프로그램 안내">작년 교육 프로그램 안내</a>
          </td>
          <td class="writer">교육혁신팀</td>
          <td class="date">25-12-30</td>
        </tr>
      </tbody>
    </table>
    """

    post = crawler.parse_list(html, "https://www.kmu.ac.kr/page.jsp?mnu_uid=143")[0]

    assert crawler.should_include_post(post) is False


def test_external_notice_board_uses_dynamic_mnu_uid_and_keywords():
    crawler = KMUCrawler(target_year=2026)
    html = """
    <table>
      <tbody>
        <tr>
          <td class="subject">
            <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=269114&amp;mnu_uid=141"
               title="2026 사회적경제기업 청년 가치텔러 모집">2026 사회적경제기업 청년 가치텔러 모집</a>
          </td>
          <td class="writer">한국전력기술(주)</td>
          <td class="date">26-07-13</td>
        </tr>
      </tbody>
    </table>
    """

    post = crawler.parse_list(
        html, "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=141&"
    )[0]

    assert post.source_key == "kmu:141:269114"
    assert crawler.should_include_post(post) is True
    assert "mnu_uid=141" in crawler._detail_url(post.url)


def test_invalid_date_candidates_are_ignored():
    crawler = KMUCrawler(target_year=2026)

    starts_at, ends_at = crawler._extract_event_range(
        "심사 기준: 적합성 25, 전달력 15, 30. 1. 행사일: 7. 20.",
        date(2026, 7, 1),
    )

    assert starts_at == datetime(2026, 7, 20, 9, 0)
    assert ends_at == datetime(2026, 7, 20, 11, 0)


def test_password_fallback_uses_public_detail_url():
    crawler = KMUCrawler(target_year=2026)
    post = crawler.parse_list(
        """
        <table><tbody><tr>
          <td class="subject">
            <a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=333&amp;mnu_uid=143"
               title="교육 프로그램 안내">교육 프로그램 안내</a>
          </td>
          <td class="writer">교육팀</td>
          <td class="date">26-07-04</td>
        </tr></tbody></table>
        """,
        "https://www.kmu.ac.kr/page.jsp?mnu_uid=143",
    )[0]

    event = crawler.parse_detail(
        "<form><p>글 등록시 입력하셨던 비밀번호를 입력해주세요.</p></form>",
        post,
        "https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&parm_bod_uid=333&mnu_uid=143",
    )

    assert "hasToken=1" in event["apply_url"]
    assert "cmd=2" in event["apply_url"]
