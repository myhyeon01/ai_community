from app.services.crawler import KMUCrawler

HTML = """
<h4>2026년 학사일정</h4>
<table><tr><td>05-05</td><td>어린이날(공휴일)</td></tr></table>
<table><tr><td>06-10</td><td>어린이날[5. 5.] 휴강에 대한 보강일</td></tr></table>
<table><tr><td>10-12</td><td>월요일 수업 진행</td></tr></table>
<div class="mobile"><table><tr><td>05-05</td><td>어린이날(공휴일)</td></tr></table></div>
"""

def test_parse_academic_calendar_and_makeup_relation():
    result = KMUCrawler().parse_academic_calendar(HTML)
    assert result["year"] == 2026
    assert result["stats"]["table_count"] == 4
    assert result["stats"]["schedule_count"] == 3
    holiday = next(row for row in result["schedules"] if row["date"] == "05-05")
    assert holiday["original_date"].isoformat() == "2026-05-05"
    assert holiday["changed_date"].isoformat() == "2026-06-10"
    assert holiday["original_weekday"] == "화"
    assert holiday["changed_weekday"] == "수"
    assert holiday["schedule_type"] == "보강"
    override = next(row for row in result["schedules"] if row["date"] == "10-12")
    assert override["applied_weekday"] == "월"
