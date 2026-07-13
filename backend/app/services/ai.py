import json
from app.core.config import settings

class AIService:
    def recommend(self, user, today) -> dict:
        context = {"student": {"department": user.department, "grade": user.grade}, "courses": [x.model_dump(mode="json") for x in today.courses], "schedules": [x.model_dump(mode="json") for x in today.schedules]}
        if not settings.openai_api_key:
            return {"source": "fallback", "recommendations": self._fallback(today)}
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.responses.create(model=settings.openai_model, input="다음 대학생 일정의 빈 시간에 무리 없는 학습 일정을 JSON 배열로 추천하세요. 이동과 휴식 시간을 포함하세요.\n" + json.dumps(context, ensure_ascii=False))
        return {"source": "openai", "text": response.output_text}
    def _fallback(self, today):
        if not today.courses: return [{"title": "집중 학습", "duration_minutes": 60, "reason": "수업이 없는 날의 학습 리듬 유지"}]
        return [{"title": f"{today.courses[0].name} 복습", "duration_minutes": 45, "reason": "당일 수업 내용을 장기 기억으로 전환"}]

