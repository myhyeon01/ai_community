from app.services.notices import NoticeService

LIST_HTML = """
<table class="board_st"><thead><tr><th>번호</th><th>제목</th><th>작성자</th><th>작성일</th><th>파일</th><th>조회</th></tr></thead>
<tbody>
<tr><td><img alt="공지"></td><td><a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=100&amp;mnu_uid=143">수강신청 안내</a></td><td>학사지원팀</td><td>26-07-10</td><td></td><td>10</td></tr>
<tr><td>99</td><td><a href="/uni/main/page.jsp?cmd=2&amp;parm_bod_uid=99&amp;mnu_uid=143">취업 특강 안내</a></td><td>진로취업지원팀</td><td>26-07-09</td><td></td><td>5</td></tr>
</tbody></table>
"""

DETAIL_HTML = """
<div class="bbs_view"><div class="bbs_info">
<dl class="subject"><dt>제목</dt><dd>취업 특강 안내</dd></dl>
<dl><dt>작성자</dt><dd>진로취업지원팀</dd><dt>일시</dt><dd>2026-07-09 10:00:00</dd><dt>연락처</dt><dd>053-580-0000</dd></dl>
<dl class="file"><dt>첨부파일</dt><dd><a href="/programs/common/com_download.jsp?parm_file_uid=1">안내.pdf</a><a href="/programs/common/com_fileViewer.jsp?parm_file_uid=1">미리보기</a></dd></dl>
</div><div class="bbs_con"><p>신청 대상은 재학생입니다.</p><p>7월 20일까지 신청하세요.</p></div></div>
"""


def test_parse_notice_list_and_categories():
    rows = NoticeService().parse_list(LIST_HTML, "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=143")
    assert len(rows) == 2
    assert rows[0]["id"] == "100"
    assert rows[0]["isImportant"] is True
    assert rows[0]["category"] == "학사"
    assert rows[1]["category"] == "취업"
    assert "hasToken=1" in rows[0]["url"]


def test_parse_notice_detail_and_attachments():
    detail = NoticeService().parse_detail(DETAIL_HTML, "https://www.kmu.ac.kr/uni/main/page.jsp", "99")
    assert detail["title"] == "취업 특강 안내"
    assert detail["date"] == "2026-07-09"
    assert detail["category"] == "취업"
    assert "재학생" in detail["content"]
    assert detail["attachments"] == [{"name": "안내.pdf", "url": "https://www.kmu.ac.kr/programs/common/com_download.jsp?parm_file_uid=1"}]
