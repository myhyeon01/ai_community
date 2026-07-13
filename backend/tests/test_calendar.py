from datetime import date, time
from app.services.calendar import CalendarService

class C:
    def override_for(self,d): return type("E",(),{"applied_weekday":2})()
    def schedules_on(self,u,d): return []
class R:
    def list(self,u):
        session=type("S",(),{"weekday":2,"start_time":time(9),"end_time":time(10)})()
        return [type("Course",(),{"id":1,"name":"자료구조","professor":"김교수","classroom":"공학관","sessions":[session]})()]
def test_override_weekday():
    view=CalendarService(C(),R()).today(1,date(2026,7,13))
    assert view.applied_weekday==2 and view.courses[0].name=="자료구조"
    assert "수요일" in view.override_message
