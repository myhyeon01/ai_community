from datetime import date
from app import schemas
from app.repositories import CalendarRepository, CourseRepository

WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]
class CalendarService:
    def __init__(self, calendar: CalendarRepository, courses: CourseRepository): self.calendar, self.courses = calendar, courses
    def today(self, user_id: int, target: date):
        override = self.calendar.override_for(target); applied = override.applied_weekday if override else target.weekday()
        lessons = []
        for course in self.courses.list(user_id):
            for session in course.sessions:
                if session.weekday == applied:
                    lessons.append(schemas.TodayCourse(course_id=course.id, name=course.name, professor=course.professor, classroom=course.classroom, start_time=session.start_time, end_time=session.end_time))
        lessons.sort(key=lambda x: x.start_time)
        message = f"오늘은 {WEEKDAYS[applied]} 시간표가 적용됩니다." if applied != target.weekday() else None
        return schemas.TodayView(date=target, calendar_weekday=target.weekday(), applied_weekday=applied, override_message=message, courses=lessons, schedules=self.calendar.schedules_on(user_id, target))

