import json
import re
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

    def summarize_notice(self, notice: dict) -> dict:
        if not settings.openai_api_key:
            return {"available": False, "message": "OPENAI_API_KEY가 설정되지 않아 AI 요약을 사용할 수 없습니다."}
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        prompt = """다음 대학 공지를 한국어 JSON으로 요약하세요. 반드시 core(핵심내용), target(대상), period(신청기간), action(해야 할 일), contact(문의처) 다섯 문자열 필드만 반환하세요. 공지에 없는 정보는 빈 문자열로 두고 추측하지 마세요.\n\n""" + json.dumps(notice, ensure_ascii=False)
        response = client.responses.create(model=settings.openai_model, input=prompt)
        raw = response.output_text.strip()
        match = re.search(r"\{.*\}", raw, re.S)
        try:
            summary = json.loads(match.group(0) if match else raw)
        except json.JSONDecodeError:
            summary = {"core": raw, "target": "", "period": "", "action": "", "contact": ""}
        return {"available": True, "summary": {key: str(summary.get(key, "")) for key in ("core", "target", "period", "action", "contact")}}

