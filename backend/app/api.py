from datetime import date, datetime
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models, schemas
from app.core.database import get_db
from app.dependencies import current_user
from app.repositories import CalendarRepository, CourseRepository, UserRepository
from app.services.auth import AuthService
from app.services.calendar import CalendarService
from app.services.ai import AIService
from app.services.imports import EverytimeImportService
from app.services.ocr import OCRService

router=APIRouter(prefix="/api/v1")
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
@router.get("/ai/today",tags=["AI"])
def ai_today(target:date|None=None,user=Depends(current_user),db:Session=Depends(get_db)):
    view=CalendarService(CalendarRepository(db),CourseRepository(db)).today(user.id,target or date.today());return AIService().recommend(user,view)

