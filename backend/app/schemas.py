from datetime import date, datetime, time
from pydantic import BaseModel, ConfigDict, Field

class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class Register(BaseModel):
    email: str
    student_id: str = Field(min_length=4, max_length=20)
    department: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=8, max_length=72)
    grade: int = Field(ge=1, le=6)

class Login(BaseModel):
    student_id: str
    password: str

class UserOut(ORM):
    id: str; student_id: str; department: str; name: str; grade: int; interests: str

class Token(BaseModel):
    access_token: str; token_type: str = "bearer"; user: UserOut

class SessionIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time

class SessionOut(SessionIn, ORM):
    id: int

class CourseIn(BaseModel):
    name: str; professor: str = ""; classroom: str = ""; color: str = "#356AE6"; memo: str = ""
    sessions: list[SessionIn]

class CourseOut(ORM):
    id: int; name: str; professor: str; classroom: str; color: str; memo: str; sessions: list[SessionOut]

class ScheduleIn(BaseModel):
    title: str; category: str = "personal"; starts_at: datetime; ends_at: datetime; memo: str = ""

class ScheduleOut(ScheduleIn, ORM):
    id: int; completed: bool

class AcademicOut(ORM):
    id: int; title: str; start_date: date; end_date: date; event_type: str; applied_weekday: int | None

class TodayCourse(BaseModel):
    course_id: int; name: str; professor: str; classroom: str; start_time: time; end_time: time

class TodayView(BaseModel):
    date: date; calendar_weekday: int; applied_weekday: int; override_message: str | None
    courses: list[TodayCourse]; schedules: list[ScheduleOut]
