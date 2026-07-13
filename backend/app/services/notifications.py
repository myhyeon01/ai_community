from datetime import datetime, timedelta

class NotificationService:
    def upcoming(self, today, now: datetime):
        notices=[]
        for course in today.courses:
            begins=datetime.combine(today.date,course.start_time)
            if timedelta() <= begins-now <= timedelta(minutes=30): notices.append({"type":"class","title":f"{course.name} 수업 30분 전입니다.","at":now})
        if today.override_message: notices.insert(0,{"type":"weekday_override","title":today.override_message,"at":now})
        return notices

