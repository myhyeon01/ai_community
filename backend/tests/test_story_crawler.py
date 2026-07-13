from datetime import datetime

from app.services.story import StoryPlusCrawler


LIST_HTML = """
<table>
  <tbody>
    <tr>
      <td class="subject">
        <a href="/user/Ep/EpMng010PD.do?PRM_SEQ=77&amp;CURRENT_MENU_CODE=MENU0052&amp;TOP_MENU_CODE=MENU0004">
          [학생성공센터] 클라우드 플랫폼 활용 교육(AZ-900) 학생 모집
        </a>
      </td>
      <td>학생성공센터</td>
      <td>신청기간 2026. 6. 10. ~ 2026. 6. 20. 17:00</td>
      <td>운영기간 2026. 6. 25. 13:00 ~ 2026. 6. 25. 15:00</td>
    </tr>
  </tbody>
</table>
"""


DETAIL_HTML = """
<div id="content">
  <h2>[학생성공센터] 클라우드 플랫폼 활용 교육(AZ-900) 학생 모집</h2>
  <table>
    <tr><th>신청기간</th><td>2026. 6. 10. ~ 2026. 6. 20. 17:00</td></tr>
    <tr><th>교육기간</th><td>2026. 6. 25. 13:00 ~ 2026. 6. 25. 15:00</td></tr>
    <tr><th>장소</th><td>동천관 전산실</td></tr>
    <tr><th>운영부서</th><td>학생성공센터</td></tr>
  </table>
  <p>클라우드 기초와 AZ-900 대비 교육입니다.</p>
</div>
"""


def test_story_list_parses_detail_links_and_source_key():
    crawler = StoryPlusCrawler(target_year=2026)

    programs = crawler.parse_list(
        LIST_HTML,
        "https://story.kmu.ac.kr/user/Ep/EpMng010L.do?CURRENT_MENU_CODE=MENU0052",
    )

    assert len(programs) == 1
    assert programs[0].title == "[학생성공센터] 클라우드 플랫폼 활용 교육(AZ-900) 학생 모집"
    assert programs[0].source_key == "story:77"
    assert programs[0].url.startswith("https://story.kmu.ac.kr/user/Ep/EpMng010PD.do")


def test_story_detail_extracts_school_event_fields():
    crawler = StoryPlusCrawler(target_year=2026)
    program = crawler.parse_list(
        LIST_HTML,
        "https://story.kmu.ac.kr/user/Ep/EpMng010L.do?CURRENT_MENU_CODE=MENU0052",
    )[0]

    event = crawler.parse_detail(DETAIL_HTML, program, program.url)

    assert event["title"] == "[학생성공센터] 클라우드 플랫폼 활용 교육(AZ-900) 학생 모집"
    assert event["starts_at"] == datetime(2026, 6, 25, 13, 0)
    assert event["ends_at"] == datetime(2026, 6, 25, 15, 0)
    assert event["apply_deadline"] == datetime(2026, 6, 20, 17, 0)
    assert event["location"] == "동천관 전산실"
    assert event["department"] == "학생성공센터"
    assert event["category"] == "교육"
    assert event["interests"] == "ai,education"
