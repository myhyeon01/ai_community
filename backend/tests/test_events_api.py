from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.core.config import settings
from app.core.database import Base, get_db
from app.dependencies import current_user
from app.main import app


def make_client(seed=True):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    Base.metadata.create_all(engine)
    user = models.User(
        id="user-1",
        student_id="20260001",
        department="컴퓨터공학",
        name="테스트",
        grade=3,
        interests="ai,career",
    )
    with TestingSession() as db:
        db.add(user)
        if seed:
            now = datetime.utcnow()
            db.add_all(
                [
                    models.SchoolEvent(
                        title="AI 취업 특강",
                        summary="AI 직무와 포트폴리오를 다룹니다.",
                        starts_at=now + timedelta(days=5),
                        ends_at=now + timedelta(days=5, hours=2),
                        apply_deadline=now + timedelta(days=2),
                        category="특강",
                        source_type="school",
                        department="컴퓨터공학",
                        location="공학관",
                        interests="ai,career",
                        apply_url="https://example.com/apply",
                        url="https://example.com/event",
                        source_key="event-1",
                    ),
                    models.SchoolEvent(
                        title="문화 축제",
                        summary="교내 문화 행사입니다.",
                        starts_at=now + timedelta(days=8),
                        ends_at=now + timedelta(days=8, hours=3),
                        category="축제",
                        source_type="external",
                        department="전체",
                        location="대운동장",
                        interests="culture",
                        apply_url="",
                        url="https://example.com/festival",
                        source_key="event-2",
                    ),
                ]
            )
        db.commit()

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[current_user] = lambda: user
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_events_empty_filter_returns_array():
    client = make_client()
    response = client.get("/api/v1/events?q=없는행사")
    assert response.status_code == 200
    assert response.json() == []


def test_events_list_and_recommendations():
    client = make_client()
    response = client.get("/api/v1/events?interest=ai")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "AI 취업 특강"
    assert data[0]["is_favorite"] is False

    response = client.get("/api/v1/events/recommendations?interests=ai")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["title"] == "AI 취업 특강"
    assert data[0]["recommendation_reason"]


def test_fourth_year_recommendations_prioritize_career_and_explain_reason():
    client = make_client(seed=False)
    with next(app.dependency_overrides[get_db]()) as db:
        now = datetime.utcnow()
        db.add_all(
            [
                models.SchoolEvent(
                    title="문화 체험 프로그램",
                    summary="교내 문화 체험",
                    starts_at=now + timedelta(days=1),
                    ends_at=now + timedelta(days=1, hours=2),
                    category="비교과",
                    department="학생지원팀",
                    location="바우어관",
                    interests="culture",
                    url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=1",
                    apply_url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=1",
                    source_key="story:1",
                ),
                models.SchoolEvent(
                    title="취업 면접과 포트폴리오 특강",
                    summary="채용 준비와 직무 면접 실습",
                    starts_at=now + timedelta(days=5),
                    ends_at=now + timedelta(days=5, hours=2),
                    category="특강",
                    department="취업지원팀",
                    location="동천관",
                    interests="career",
                    url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=2",
                    apply_url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=2",
                    source_key="story:2",
                ),
            ]
        )
        db.commit()

    response = client.get("/api/v1/events/recommendations?grade=4")

    assert response.status_code == 200
    data = response.json()
    assert data[0]["title"] == "취업 면접과 포트폴리오 특강"
    assert "4학년" in data[0]["recommendation_reason"]
    assert "Story+" in data[0]["recommendation_reason"]


def test_recommendations_exclude_expired_application():
    client = make_client(seed=False)
    with next(app.dependency_overrides[get_db]()) as db:
        now = datetime.utcnow()
        db.add(
            models.SchoolEvent(
                title="신청이 끝난 비교과",
                summary="운영일은 남았지만 신청은 마감되었습니다.",
                starts_at=now + timedelta(days=5),
                ends_at=now + timedelta(days=5, hours=2),
                apply_deadline=now - timedelta(days=1),
                category="비교과",
                department="Story+",
                location="온라인",
                interests="education",
                url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=9",
                apply_url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=9",
                source_key="story:9",
            )
        )
        db.commit()

    response = client.get("/api/v1/events/recommendations")

    assert response.status_code == 200
    assert response.json() == []


def test_events_filter_by_source_type():
    client = make_client()

    response = client.get("/api/v1/events?source_type=external")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "문화 축제"
    assert data[0]["source_type"] == "external"

    response = client.get("/api/v1/events?source_type=school")
    assert response.status_code == 200
    data = response.json()
    assert [event["title"] for event in data] == ["AI 취업 특강"]
    assert data[0]["source_type"] == "school"


def test_events_source_filter_uses_kmu_board_uid_when_saved_type_is_wrong():
    client = make_client(seed=False)
    with next(app.dependency_overrides[get_db]()) as db:
        now = datetime.utcnow()
        db.add_all(
            [
                models.SchoolEvent(
                    title="학교 행사 게시판 행사",
                    summary="mnu_uid=143에서 가져온 행사입니다.",
                    starts_at=now + timedelta(days=1),
                    ends_at=now + timedelta(days=1, hours=2),
                    category="특강",
                    source_type="school",
                    department="계명대학교",
                    location="계명대학교",
                    interests="education",
                    url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&mnu_uid=143&parm_bod_uid=1",
                    apply_url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&mnu_uid=143&parm_bod_uid=1",
                    source_key="kmu:143:1",
                ),
                models.SchoolEvent(
                    title="교외 행사 게시판 행사",
                    summary="mnu_uid=141에서 가져온 행사입니다.",
                    starts_at=now + timedelta(days=2),
                    ends_at=now + timedelta(days=2, hours=2),
                    category="공모전",
                    source_type="school",
                    department="외부기관",
                    location="온라인",
                    interests="contest",
                    url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&mnu_uid=141&parm_bod_uid=2",
                    apply_url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&mnu_uid=141&parm_bod_uid=2",
                    source_key="kmu:141:2",
                ),
                models.SchoolEvent(
                    title="Story+ 행사",
                    summary="학교 제공이지만 이 필터에서는 제외되어야 합니다.",
                    starts_at=now + timedelta(days=3),
                    ends_at=now + timedelta(days=3, hours=2),
                    category="교육",
                    source_type="school",
                    department="Story+",
                    location="온라인",
                    interests="education",
                    url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=3",
                    apply_url="https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=3",
                    source_key="story:3",
                ),
            ]
        )
        db.commit()

    school_events = client.get("/api/v1/events?source_type=school").json()
    external_events = client.get("/api/v1/events?source_type=external").json()

    assert [event["title"] for event in school_events] == ["학교 행사 게시판 행사"]
    assert [event["title"] for event in external_events] == ["교외 행사 게시판 행사"]
    assert external_events[0]["source_type"] == "external"


def test_recommendations_exclude_ended_events_even_with_open_deadline():
    client = make_client(seed=False)
    with next(app.dependency_overrides[get_db]()) as db:
        now = datetime.utcnow()
        db.add(
            models.SchoolEvent(
                title="신청 가능한 교육 프로그램",
                summary="행사일은 지났지만 신청 마감은 남아 있습니다.",
                starts_at=now - timedelta(days=7),
                ends_at=now - timedelta(days=7, hours=-2),
                apply_deadline=now + timedelta(days=3),
                category="교육",
                department="교육팀",
                location="계명대학교",
                interests="education,ai",
                apply_url="https://example.com/apply",
                url="https://example.com/event",
                source_key="event-open-application",
            )
        )
        db.commit()

    response = client.get("/api/v1/events/recommendations?interests=education")

    assert response.status_code == 200
    assert response.json() == []


def test_event_favorites_round_trip():
    client = make_client()
    assert client.get("/api/v1/events/favorites").json() == []

    response = client.post("/api/v1/events/1/favorite")
    assert response.status_code == 200
    assert response.json()["is_favorite"] is True

    response = client.get("/api/v1/events/favorites")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [1]

    response = client.delete("/api/v1/events/1/favorite")
    assert response.status_code == 204
    assert client.get("/api/v1/events/favorites").json() == []


def test_kmu_event_sync_upserts_school_events(monkeypatch):
    async def fake_fetch(self, url, *, pages=1, limit=50):
        now = datetime.utcnow()
        if "mnu_uid=141" in url:
            return [
                {
                    "title": "교외 공모전 참가자 모집",
                    "summary": "교외 공모전 안내",
                    "starts_at": now + timedelta(days=2),
                    "ends_at": now + timedelta(days=2, hours=2),
                    "apply_deadline": now + timedelta(days=1),
                    "category": "공모전",
                    "department": "외부기관",
                    "location": "온라인",
                    "interests": "contest",
                    "url": "https://www.kmu.ac.kr/external",
                    "apply_url": "https://www.kmu.ac.kr/external",
                    "source_key": "kmu:141:456",
                }
            ]
        return [
            {
                "title": "AI 세미나 참가자 모집",
                "summary": "AI 세미나 안내",
                "starts_at": now + timedelta(days=1),
                "ends_at": now + timedelta(days=1, hours=2),
                "apply_deadline": now,
                "category": "특강",
                "department": "교육혁신팀",
                "location": "동천관",
                "interests": "ai",
                "url": "https://www.kmu.ac.kr/detail",
                "apply_url": "https://www.kmu.ac.kr/detail",
                "source_key": "kmu:143:123",
            }
        ]

    monkeypatch.setattr(
        "app.services.crawler.KMUCrawler.fetch_school_events", fake_fetch
    )
    client = make_client(seed=False)

    response = client.post("/api/v1/events/sync/kmu?pages=1&limit=2")

    assert response.status_code == 200
    assert response.json()["created"] == 2
    events = client.get("/api/v1/events").json()
    assert events[0]["title"] == "AI 세미나 참가자 모집"
    assert events[0]["category"] == "특강"
    assert events[0]["source_type"] == "school"
    external_events = client.get("/api/v1/events?source_type=external").json()
    assert external_events[0]["title"] == "교외 공모전 참가자 모집"


def test_story_event_sync_upserts_school_events(monkeypatch):
    async def fake_fetch(self, url, *, pages=1, limit=50):
        now = datetime.utcnow()
        return [
            {
                "title": "Story+ 클라우드 교육",
                "summary": "Story+ 교육 안내",
                "starts_at": now + timedelta(days=3),
                "ends_at": now + timedelta(days=3, hours=2),
                "apply_deadline": now + timedelta(days=1),
                "category": "교육",
                "department": "학생성공센터",
                "location": "동천관",
                "interests": "ai,education",
                "url": "https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=77",
                "apply_url": "https://story.kmu.ac.kr/user/Ep/EpMng010PD.do?PRM_SEQ=77",
                "source_key": "story:77",
            }
        ]

    monkeypatch.setattr(
        "app.services.story.StoryPlusCrawler.fetch_school_events", fake_fetch
    )
    client = make_client(seed=False)

    response = client.post("/api/v1/events/sync/story?pages=1&limit=1")

    assert response.status_code == 200
    assert response.json()["created"] == 1
    events = client.get("/api/v1/events?category=교육").json()
    assert events[0]["title"] == "Story+ 클라우드 교육"
    assert events[0]["apply_url"].startswith("https://story.kmu.ac.kr")
    assert events[0]["source_type"] == "school"


def test_events_use_local_dev_user_without_supabase_env(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    Base.metadata.create_all(engine)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_publishable_key", "")
    monkeypatch.setattr(settings, "database_url", "sqlite:///./test.db")
    app.dependency_overrides[get_db] = override_db

    client = TestClient(app)
    response = client.get("/api/v1/events")

    assert response.status_code == 200
    assert response.json() == []


def test_events_public_kmu_url_adds_has_token():
    client = make_client(seed=False)
    with next(app.dependency_overrides[get_db]()) as db:
        now = datetime.utcnow()
        db.add(
            models.SchoolEvent(
                title="교육 프로그램 안내",
                summary="교육 프로그램 안내",
                starts_at=now,
                ends_at=now + timedelta(hours=1),
                category="교육",
                department="교육팀",
                location="계명대학교",
                interests="education",
                url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&parm_bod_uid=333&mnu_uid=143",
                apply_url="https://www.kmu.ac.kr/uni/main/page.jsp?cmd=2&parm_bod_uid=333&mnu_uid=143",
                source_key="kmu:143:333",
            )
        )
        db.commit()

    response = client.get("/api/v1/events?category=교육")

    assert response.status_code == 200
    assert "hasToken=1" in response.json()[0]["apply_url"]
