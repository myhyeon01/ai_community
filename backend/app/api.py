from datetime import date, datetime
import asyncio
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models, schemas
from app.core.config import settings
from app.core.database import get_db
from app.dependencies import current_user
from app.repositories import CalendarRepository, CourseRepository, SchoolEventRepository, UserRepository
from app.services.auth import AuthService
from app.services.calendar import CalendarService
from app.services.ai import AIService
from app.services.imports import EverytimeImportService
from app.services.ocr import OCRService
from app.services.academic_calendar import AcademicCalendarCrawler
from app.services.crawler import KMUCrawler
from app.services.story import StoryPlusCrawler
from app.services.notices import notice_service

router=APIRouter(prefix="/api/v1")

@router.get("/academic-calendar",tags=["Academic"])
async def live_academic_calendar(year:int=date.today().year,refresh:bool=False):
    if year < 2010 or year > date.today().year + 1:
        raise HTTPException(422,"조회 가능한 연도가 아닙니다.")
    try:
        return await AcademicCalendarCrawler().fetch(year, force=refresh)
    except Exception as exc:
        raise HTTPException(502,f"학교 학사일정을 불러오지 못했습니다: {exc}") from exc

@router.get("/academic-calendar/years",tags=["Academic"])
async def academic_calendar_years():
    try:
        return await AcademicCalendarCrawler().available_years()
    except Exception as exc:
        raise HTTPException(502,f"학교 학사일정 연도 목록을 불러오지 못했습니다: {exc}") from exc

@router.get("/notices",tags=["Notices"])
async def notices(query:str="",category:str="전체",page:int=Query(1,ge=1),limit:int=Query(20,ge=1,le=50)):
    if category not in {"전체","학사","장학","취업","행사","기타"}:
        raise HTTPException(422,"지원하지 않는 공지 카테고리입니다.")
    try:
        return await notice_service.list(query=query,category=category,page=page,limit=limit)
    except Exception as error:
        raise HTTPException(502,f"계명대학교 공지를 불러오지 못했습니다: {error}") from error

@router.post("/notices/refresh",tags=["Notices"])
async def refresh_notices():
    try:
        return await notice_service.refresh()
    except Exception as error:
        raise HTTPException(502,f"계명대학교 공지를 새로고침하지 못했습니다: {error}") from error

@router.post("/notices/{notice_id}/summary",tags=["Notices"])
async def summarize_notice(notice_id:str):
    try:
        notice=await notice_service.detail(notice_id)
        return await asyncio.to_thread(AIService().summarize_notice,notice)
    except Exception as error:
        raise HTTPException(502,f"공지 AI 요약에 실패했습니다: {error}") from error

@router.get("/notices/{notice_id}",tags=["Notices"])
async def notice_detail(notice_id:str):
    if not notice_id.isdigit():
        raise HTTPException(422,"올바른 공지 ID가 아닙니다.")
    try:
        return await notice_service.detail(notice_id)
    except Exception as error:
        raise HTTPException(502,f"계명대학교 공지 상세를 불러오지 못했습니다: {error}") from error

@router.post("/auth/register",response_model=schemas.Token,tags=["Auth"])
def register(data:schemas.Register,db:Session=Depends(get_db)): return AuthService(UserRepository(db)).register(data)
@router.post("/auth/login",response_model=schemas.Token,tags=["Auth"])
def login(data:schemas.Login,db:Session=Depends(get_db)): return AuthService(UserRepository(db)).login(data)
@router.get("/auth/me",response_model=schemas.UserOut,tags=["Auth"])
def me(user=Depends(current_user)): return user

@router.get("/courses",response_model=list[schemas.CourseOut],tags=["Timetable"])
def courses(user=Depends(current_user),db:Session=Depends(get_db)): return CourseRepository(db).list(user.id)
@router.post("/courses",response_model=schemas.CourseOut,tags=["Timetable"])
def add_course(data:schemas.CourseIn,user=Depends(current_user),db:Session=Depends(get_db)):
    course=models.Course(user_id=user.id,**data.model_dump(exclude={"sessions"})); course.sessions=[models.CourseSession(**x.model_dump()) for x in data.sessions]
    return CourseRepository(db).add(course)
@router.delete("/courses/{course_id}",status_code=204,tags=["Timetable"])
def delete_course(course_id:int,user=Depends(current_user),db:Session=Depends(get_db)):
    if not CourseRepository(db).delete(user.id,course_id): raise HTTPException(404,"과목을 찾을 수 없습니다.")

@router.post("/imports/everytime/{kind}",response_model=list[schemas.CourseOut],tags=["Import"])
async def import_everytime(kind:str,file:UploadFile=File(...),user=Depends(current_user),db:Session=Depends(get_db)):
    content=await file.read(); service=EverytimeImportService()
    if kind not in {"csv","ics"}: raise HTTPException(400,"csv 또는 ics만 지원합니다.")
    parsed=getattr(service,kind)(content,user.id); repo=CourseRepository(db)
    return [repo.add(x) for x in parsed]
@router.post("/imports/ocr/preview",tags=["Import"])
def ocr_preview(blocks:list[dict],user=Depends(current_user)): return OCRService().normalize(blocks)

@router.get("/calendar/today",response_model=schemas.TodayView,tags=["Calendar"])
def today(target:date|None=None,user=Depends(current_user),db:Session=Depends(get_db)):
    return CalendarService(CalendarRepository(db),CourseRepository(db)).today(user.id,target or date.today())
@router.get("/calendar/range",response_model=list[schemas.ScheduleOut],tags=["Calendar"])
def calendar_range(start:datetime,end:datetime,user=Depends(current_user),db:Session=Depends(get_db)):
    return list(db.scalars(select(models.ScheduleItem).where(models.ScheduleItem.user_id==user.id,models.ScheduleItem.starts_at<=end,models.ScheduleItem.ends_at>=start)))
@router.post("/schedules",response_model=schemas.ScheduleOut,tags=["Calendar"])
def add_schedule(data:schemas.ScheduleIn,user=Depends(current_user),db:Session=Depends(get_db)):
    if data.ends_at<=data.starts_at: raise HTTPException(422,"종료 시간은 시작 시간 이후여야 합니다.")
    item=models.ScheduleItem(user_id=user.id,**data.model_dump()); db.add(item);db.commit();db.refresh(item);return item
@router.get("/academic-events",response_model=list[schemas.AcademicOut],tags=["Academic"])
def academic_events(start:date,end:date,db:Session=Depends(get_db),user=Depends(current_user)):
    return list(db.scalars(select(models.AcademicEvent).where(models.AcademicEvent.start_date<=end,models.AcademicEvent.end_date>=start)))

@router.get("/events",response_model=list[schemas.SchoolEventOut],tags=["Events"])
def school_events(q:str="",category:str="",source_type:str="",interest:str="",start_date:date|None=None,end_date:date|None=None,sort:str="upcoming",active_only:bool=False,page:int=Query(1,ge=1),limit:int=Query(24,ge=1,le=100),user=Depends(current_user),db:Session=Depends(get_db)):
    return SchoolEventRepository(db).list(user.id,q,category,source_type,interest,start_date,end_date,sort,page,limit,active_only)

@router.post("/events/sync/kmu",tags=["Events"])
async def sync_kmu_events(pages:int=Query(5,ge=1,le=10),limit:int=Query(80,ge=1,le=200),user=Depends(current_user),db:Session=Depends(get_db)):
    events=await KMUCrawler().fetch_school_events(settings.kmu_notice_url,pages=pages,limit=limit)
    for event in events: event["source_type"]="school"
    external=await KMUCrawler(image_ocr=False).fetch_school_events(settings.kmu_external_notice_url,pages=pages,limit=limit)
    for event in external: event["source_type"]="external"
    seen={event.get("source_key") for event in events}
    external=[event for event in external if event.get("source_key") not in seen]
    primary_quota=max(1,limit//2)
    merged=events[:primary_quota]+external[:limit-primary_quota]
    if len(merged)<limit:
        used={event.get("source_key") for event in merged}
        merged.extend(event for event in events[primary_quota:] if event.get("source_key") not in used)
        used={event.get("source_key") for event in merged}
        merged.extend(event for event in external[limit-primary_quota:] if event.get("source_key") not in used)
    merged=merged[:limit]
    result=SchoolEventRepository(db).upsert_many(merged)
    return {"fetched":len(merged),**result}

@router.post("/events/sync/story",tags=["Events"])
async def sync_story_events(pages:int=Query(1,ge=1,le=5),limit:int=Query(80,ge=1,le=200),user=Depends(current_user),db:Session=Depends(get_db)):
    events=await StoryPlusCrawler(session_cookie=settings.story_session_cookie).fetch_school_events(settings.story_event_list_url,pages=pages,limit=limit)
    for event in events: event["source_type"]="school"
    result=SchoolEventRepository(db).upsert_many(events)
    return {"fetched":len(events),**result}

@router.get("/events/recommendations",response_model=list[schemas.SchoolEventOut],tags=["Events"])
async def event_recommendations(interests:str="",department:str="",grade:int|None=Query(None,ge=1,le=6),limit:int=Query(12,ge=1,le=50),user=Depends(current_user),db:Session=Depends(get_db)):
    candidate_limit=min(50,max(24,limit*3))
    candidates=SchoolEventRepository(db).recommendations(user,interests,candidate_limit,department,grade)
    return await asyncio.to_thread(AIService().rerank_events,user,candidates,interests,limit)

@router.get("/events/favorites",response_model=list[schemas.SchoolEventOut],tags=["Events"])
def event_favorites(user=Depends(current_user),db:Session=Depends(get_db)):
    return SchoolEventRepository(db).favorites(user.id)

@router.post("/events/{event_id}/favorite",response_model=schemas.SchoolEventOut,tags=["Events"])
def add_event_favorite(event_id:int,user=Depends(current_user),db:Session=Depends(get_db)):
    event=SchoolEventRepository(db).add_favorite(user.id,event_id)
    if not event: raise HTTPException(404,"행사를 찾을 수 없습니다.")
    return event

@router.delete("/events/{event_id}/favorite",status_code=204,tags=["Events"])
def delete_event_favorite(event_id:int,user=Depends(current_user),db:Session=Depends(get_db)):
    if not SchoolEventRepository(db).delete_favorite(user.id,event_id): raise HTTPException(404,"행사를 찾을 수 없습니다.")

@router.get("/ai/today",tags=["AI"])
def ai_today(target:date|None=None,user=Depends(current_user),db:Session=Depends(get_db)):
    view=CalendarService(CalendarRepository(db),CourseRepository(db)).today(user.id,target or date.today());return AIService().recommend(user,view)

@router.post("/ai/schedule/refine",tags=["AI"])
async def refine_ai_schedule(data:schemas.AIScheduleRequest,user=Depends(current_user)):
    return await asyncio.to_thread(AIService().refine_schedule,data.context)

@router.post("/ai/schedule/chat",tags=["AI"])
async def chat_ai_schedule(data:schemas.AIScheduleChatRequest,user=Depends(current_user)):
    return await asyncio.to_thread(AIService().chat_schedule,data.message,data.context,data.history)
