import csv, io
from datetime import datetime
from icalendar import Calendar
from app import models

KO_WEEKDAY = {"월":0,"화":1,"수":2,"목":3,"금":4,"토":5,"일":6}
class EverytimeImportService:
    """공식 내보내기 파일만 처리하며 로그인 자동화/비공식 API는 사용하지 않는다."""
    def csv(self, content: bytes, user_id: int):
        rows = csv.DictReader(io.StringIO(content.decode("utf-8-sig"))); result=[]
        for r in rows:
            course=models.Course(user_id=user_id,name=r["과목명"],professor=r.get("교수명", ""),classroom=r.get("강의실", ""))
            course.sessions=[models.CourseSession(weekday=KO_WEEKDAY[r["요일"].strip()[0]],start_time=datetime.strptime(r["시작시간"],"%H:%M").time(),end_time=datetime.strptime(r["종료시간"],"%H:%M").time())]; result.append(course)
        return result
    def ics(self, content: bytes, user_id: int):
        result=[]
        for event in Calendar.from_ical(content).walk("VEVENT"):
            start=event.decoded("DTSTART"); end=event.decoded("DTEND")
            result.append(models.Course(user_id=user_id,name=str(event.get("SUMMARY","수업")),classroom=str(event.get("LOCATION","")),sessions=[models.CourseSession(weekday=start.weekday(),start_time=start.time(),end_time=end.time())]))
        return result

