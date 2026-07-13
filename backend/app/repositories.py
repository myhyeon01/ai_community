from datetime import date, datetime
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app import models

class UserRepository:
    def __init__(self, db: Session): self.db = db
    def by_student_id(self, value: str): return self.db.scalar(select(models.User).where(models.User.student_id == value))
    def get(self, user_id: str): return self.db.get(models.User, user_id)
    def add(self, user: models.User): self.db.add(user); self.db.commit(); self.db.refresh(user); return user

class CourseRepository:
    def __init__(self, db: Session): self.db = db
    def list(self, user_id: int):
        return list(self.db.scalars(select(models.Course).options(selectinload(models.Course.sessions)).where(models.Course.user_id == user_id)))
    def add(self, course: models.Course): self.db.add(course); self.db.commit(); self.db.refresh(course); return self.db.scalar(select(models.Course).options(selectinload(models.Course.sessions)).where(models.Course.id == course.id))
    def delete(self, user_id: int, course_id: int):
        item = self.db.scalar(select(models.Course).where(models.Course.id == course_id, models.Course.user_id == user_id))
        if item: self.db.delete(item); self.db.commit()
        return item is not None

class CalendarRepository:
    def __init__(self, db: Session): self.db = db
    def override_for(self, target: date):
        return self.db.scalar(select(models.AcademicEvent).where(models.AcademicEvent.start_date <= target, models.AcademicEvent.end_date >= target, models.AcademicEvent.applied_weekday.is_not(None)).order_by(models.AcademicEvent.updated_at.desc()))
    def schedules_on(self, user_id: int, target: date):
        start = datetime.combine(target, datetime.min.time()); end = datetime.combine(target, datetime.max.time())
        return list(self.db.scalars(select(models.ScheduleItem).where(models.ScheduleItem.user_id == user_id, models.ScheduleItem.starts_at <= end, models.ScheduleItem.ends_at >= start).order_by(models.ScheduleItem.starts_at)))
