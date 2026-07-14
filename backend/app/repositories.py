from __future__ import annotations

from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload
from app import models, schemas

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

class SchoolEventRepository:
    def __init__(self, db: Session): self.db = db

    def _tokens(self, value: str | list[str] | None):
        if value is None: return []
        if isinstance(value, str): raw = value.split(",")
        else: raw = value
        return [x.strip().lower() for x in raw if str(x).strip()]

    def _favorite_ids(self, user_id: str, event_ids: list[int]):
        if not event_ids: return set()
        stmt = select(models.SchoolEventFavorite.event_id).where(
            models.SchoolEventFavorite.user_id == user_id,
            models.SchoolEventFavorite.event_id.in_(event_ids),
        )
        return set(self.db.scalars(stmt))

    def _external_source_clause(self):
        return or_(
            models.SchoolEvent.source_type == "external",
            models.SchoolEvent.source_key.like("kmu:141:%"),
            models.SchoolEvent.url.like("%mnu_uid=141%"),
            models.SchoolEvent.apply_url.like("%mnu_uid=141%"),
        )

    def _school_source_clause(self):
        return or_(
            models.SchoolEvent.source_key.like("kmu:143:%"),
            models.SchoolEvent.url.like("%mnu_uid=143%"),
            models.SchoolEvent.apply_url.like("%mnu_uid=143%"),
            (
                (models.SchoolEvent.source_type == "school")
                & ~models.SchoolEvent.source_key.like("story:%")
                & ~models.SchoolEvent.source_key.like("kmu:141:%")
                & ~models.SchoolEvent.url.like("%mnu_uid=141%")
                & ~models.SchoolEvent.apply_url.like("%mnu_uid=141%")
            ),
        )

    def _source_type_for_event(self, event: models.SchoolEvent):
        source_key = getattr(event, "source_key", "") or ""
        url = getattr(event, "url", "") or ""
        apply_url = getattr(event, "apply_url", "") or ""
        if (
            source_key.startswith("kmu:141:")
            or "mnu_uid=141" in url
            or "mnu_uid=141" in apply_url
            or getattr(event, "source_type", "") == "external"
        ):
            return "external"
        if (
            source_key.startswith("kmu:143:")
            or "mnu_uid=143" in url
            or "mnu_uid=143" in apply_url
        ):
            return "school"
        return getattr(event, "source_type", "") or "school"

    def _out(self, event: models.SchoolEvent, favorite_ids: set[int], reason: str = ""):
        event_url = self._public_event_url(getattr(event, "url", "") or "")
        apply_url = self._public_event_url(
            getattr(event, "apply_url", "") or event_url
        )
        return schemas.SchoolEventOut(
            id=event.id,
            title=event.title,
            summary=getattr(event, "summary", "") or "",
            category=event.category or "event",
            source_type=self._source_type_for_event(event),
            interests=getattr(event, "interests", "") or "",
            department=event.department or "",
            location=getattr(event, "location", "") or "",
            starts_at=event.starts_at,
            ends_at=event.ends_at,
            apply_deadline=getattr(event, "apply_deadline", None),
            url=event_url,
            apply_url=apply_url,
            is_favorite=event.id in favorite_ids,
            recommendation_reason=reason,
        )

    def _public_event_url(self, url: str):
        if "kmu.ac.kr" not in (url or "") or "parm_bod_uid" not in url:
            return url or ""
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        query["cmd"] = ["2"]
        query["hasToken"] = ["1"]
        query["mnu_uid"] = [query.get("mnu_uid", ["143"])[0] or "143"]
        return urlunsplit(
            (
                parts.scheme or "https",
                parts.netloc or "www.kmu.ac.kr",
                parts.path or "/uni/main/page.jsp",
                urlencode(query, doseq=True),
                parts.fragment,
            )
        )

    def list(
        self,
        user_id: str,
        q: str = "",
        category: str = "",
        source_type: str = "",
        interest: str = "",
        start_date: date | None = None,
        end_date: date | None = None,
        sort: str = "upcoming",
        page: int = 1,
        limit: int = 24,
        active_only: bool = False,
    ):
        stmt = select(models.SchoolEvent)
        if active_only:
            now = datetime.now()
            stmt = stmt.where(
                models.SchoolEvent.ends_at >= now,
                or_(
                    models.SchoolEvent.apply_deadline.is_(None),
                    models.SchoolEvent.apply_deadline >= now,
                ),
            )
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    models.SchoolEvent.title.ilike(like),
                    models.SchoolEvent.summary.ilike(like),
                    models.SchoolEvent.location.ilike(like),
                    models.SchoolEvent.department.ilike(like),
                    models.SchoolEvent.interests.ilike(like),
                )
            )
        if category:
            stmt = stmt.where(models.SchoolEvent.category == category)
        if source_type == "school":
            stmt = stmt.where(self._school_source_clause())
        elif source_type == "external":
            stmt = stmt.where(self._external_source_clause())
        for token in self._tokens(interest):
            like = f"%{token}%"
            stmt = stmt.where(or_(models.SchoolEvent.interests.ilike(like), models.SchoolEvent.category.ilike(like)))
        if start_date:
            stmt = stmt.where(models.SchoolEvent.ends_at >= datetime.combine(start_date, datetime.min.time()))
        if end_date:
            stmt = stmt.where(models.SchoolEvent.starts_at <= datetime.combine(end_date, datetime.max.time()))
        if sort == "deadline":
            now = datetime.now()
            stmt = stmt.where(
                models.SchoolEvent.apply_deadline.is_not(None),
                models.SchoolEvent.apply_deadline >= now,
                models.SchoolEvent.apply_deadline <= now + timedelta(days=30),
                models.SchoolEvent.ends_at >= now,
            )
            stmt = stmt.order_by(models.SchoolEvent.apply_deadline.is_(None), models.SchoolEvent.apply_deadline, models.SchoolEvent.starts_at)
        elif sort == "latest":
            stmt = stmt.order_by(models.SchoolEvent.id.desc())
        else:
            stmt = stmt.order_by(models.SchoolEvent.starts_at, models.SchoolEvent.id)
        safe_limit = min(max(limit, 1), 100)
        safe_page = max(page, 1)
        events = list(self.db.scalars(stmt.offset((safe_page - 1) * safe_limit).limit(safe_limit)))
        favorite_ids = self._favorite_ids(user_id, [event.id for event in events])
        return [self._out(event, favorite_ids) for event in events]

    def upsert_many(self, events: list[dict]):
        created = 0
        updated = 0
        for data in events:
            source_key = data.get("source_key")
            if not source_key:
                continue
            data["source_type"] = self._source_type_from_data(data)
            event = self.db.scalar(
                select(models.SchoolEvent).where(
                    models.SchoolEvent.source_key == source_key
                )
            )
            if event:
                updated += 1
                for key, value in data.items():
                    if key != "source_key" and hasattr(event, key):
                        setattr(event, key, value)
            else:
                created += 1
                self.db.add(models.SchoolEvent(**data))
        self.db.commit()
        return {"created": created, "updated": updated}

    def _source_type_from_data(self, data: dict):
        source_key = data.get("source_key") or ""
        url = data.get("url") or ""
        apply_url = data.get("apply_url") or ""
        if (
            source_key.startswith("kmu:141:")
            or "mnu_uid=141" in url
            or "mnu_uid=141" in apply_url
            or data.get("source_type") == "external"
        ):
            return "external"
        if (
            source_key.startswith("kmu:143:")
            or "mnu_uid=143" in url
            or "mnu_uid=143" in apply_url
        ):
            return "school"
        return data.get("source_type") or "school"

    def recommendations(self, user: models.User, interests: str = "", limit: int = 12):
        now = datetime.utcnow()
        events = list(
            self.db.scalars(
                select(models.SchoolEvent)
                .where(models.SchoolEvent.ends_at >= now)
                .order_by(
                    models.SchoolEvent.apply_deadline.is_(None),
                    models.SchoolEvent.apply_deadline,
                    models.SchoolEvent.starts_at,
                    models.SchoolEvent.id,
                )
                .limit(100)
            )
        )
        selected = set(self._tokens(interests) + self._tokens(user.interests))
        department = (user.department or "").strip().lower()
        scored = []
        for event in events:
            score = 0
            reasons = []
            event_department = (event.department or "").lower()
            event_tags = set(self._tokens(getattr(event, "interests", "")))
            if department and event_department and (department in event_department or event_department in department):
                score += 4
                reasons.append("학과와 관련된 행사입니다.")
            matched = sorted(selected & event_tags)
            if matched:
                score += len(matched) * 3
                reasons.append(f"관심 분야({', '.join(matched)})와 맞습니다.")
            if event.apply_deadline and event.apply_deadline >= now:
                score += 1
            if not reasons:
                reasons.append("가까운 일정의 교내 행사입니다.")
            scored.append((score, event.starts_at, event, " ".join(reasons)))
        scored.sort(key=lambda item: (-item[0], item[1], item[2].id))
        events = scored[: min(max(limit, 1), 50)]
        favorite_ids = self._favorite_ids(user.id, [event.id for _, _, event, _ in events])
        return [self._out(event, favorite_ids, reason) for _, _, event, reason in events]

    def favorites(self, user_id: str):
        stmt = (
            select(models.SchoolEvent)
            .join(models.SchoolEventFavorite, models.SchoolEventFavorite.event_id == models.SchoolEvent.id)
            .where(models.SchoolEventFavorite.user_id == user_id)
            .order_by(models.SchoolEvent.starts_at, models.SchoolEvent.id)
        )
        events = list(self.db.scalars(stmt))
        return [self._out(event, {event.id for event in events}) for event in events]

    def add_favorite(self, user_id: str, event_id: int):
        event = self.db.get(models.SchoolEvent, event_id)
        if not event: return None
        favorite = self.db.get(models.SchoolEventFavorite, {"user_id": user_id, "event_id": event_id})
        if not favorite:
            self.db.add(models.SchoolEventFavorite(user_id=user_id, event_id=event_id))
            self.db.commit()
        return self._out(event, {event_id})

    def delete_favorite(self, user_id: str, event_id: int):
        if not self.db.get(models.SchoolEvent, event_id): return False
        favorite = self.db.get(models.SchoolEventFavorite, {"user_id": user_id, "event_id": event_id})
        if favorite:
            self.db.delete(favorite)
            self.db.commit()
        return True
