from app.core.config import settings
from app.services.ai import AIService


def test_schedule_refine_falls_back_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")

    result = AIService().refine_schedule({"fixed_blocks": []})

    assert result["available"] is False
    assert result["source"] == "fallback"
    assert result["items"] == []


def test_schedule_items_reject_fixed_time_conflicts():
    service = AIService()
    context = {
        "fixed_blocks": [
            {"start": "09:00", "end": "10:15", "title": "데이터베이스", "type": "class"}
        ]
    }

    result = service._normalize_schedule_items(
        [
            {"start": "10:15", "end": "11:00", "title": "겹치는 복습", "type": "study"},
            {"start": "10:30", "end": "11:15", "title": "안전한 복습", "type": "study"},
        ],
        context,
    )

    assert [item["title"] for item in result] == ["안전한 복습"]


def test_chat_falls_back_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")

    result = AIService().chat_schedule("점심을 늦춰줘", {}, [])

    assert result["available"] is False
    assert result["preference_updates"] == {}


def test_chat_fallback_guides_to_matching_page(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    context = {
        "app_guide": [
            {"id": "home", "title": "홈", "description": "오늘 일정을 확인합니다.", "features": []},
            {"id": "timetable", "title": "시간표", "description": "시간표를 등록합니다.", "features": ["OCR 등록", "수동 등록"]},
        ]
    }

    result = AIService().chat_schedule("시간표 등록 방법 알려줘", context, [])

    assert result["navigate_to"] == "timetable"
    assert "시간표" in result["reply"]


def test_event_rerank_keeps_rule_order_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    events = [object(), object(), object()]

    result = AIService().rerank_events(object(), events, limit=2)

    assert result == events[:2]
