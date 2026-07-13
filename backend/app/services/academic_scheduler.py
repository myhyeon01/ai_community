from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models

WEEKDAY_WORDS={"월요일":0,"화요일":1,"수요일":2,"목요일":3,"금요일":4,"토요일":5,"일요일":6}
class AcademicSchedulerService:
    """크롤러 결과를 정규화/업서트하는 계층. HTML 선택자는 crawler에만 존재한다."""
    def infer_applied_weekday(self,title:str):
        if "시간표" not in title: return None
        return next((number for word,number in WEEKDAY_WORDS.items() if word in title),None)
    def upsert(self,db:Session,*,title:str,start:date,end:date,source_key:str,url:str=""):
        item=db.scalar(select(models.AcademicEvent).where(models.AcademicEvent.source_key==source_key))
        if not item: item=models.AcademicEvent(source_key=source_key,title=title,start_date=start,end_date=end);db.add(item)
        item.title,item.start_date,item.end_date,item.source_url=title,start,end,url
        item.applied_weekday=self.infer_applied_weekday(title);db.commit();db.refresh(item);return item

