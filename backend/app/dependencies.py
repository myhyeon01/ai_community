import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from app import models
from app.core.config import settings
from app.core.database import get_db
from app.repositories import UserRepository

bearer = HTTPBearer(auto_error=False)
LOCAL_DEV_USER_ID = "local-dev-user"


def _local_dev_auth_enabled() -> bool:
    return (
        not settings.supabase_url
        and not settings.supabase_publishable_key
        and settings.database_url.startswith("sqlite")
    )


def _local_dev_user(db: Session):
    repo = UserRepository(db)
    profile = repo.get(LOCAL_DEV_USER_ID)
    if profile:
        return profile
    return repo.add(
        models.User(
            id=LOCAL_DEV_USER_ID,
            student_id="local-dev",
            department="계명대학교",
            name="개발 사용자",
            grade=1,
            interests="ai,career,culture,contest",
        )
    )


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    """Supabase Auth JWT를 검증하고 public.users 프로필을 반환한다."""
    if _local_dev_auth_enabled():
        return _local_dev_user(db)

    if not credentials:
        raise HTTPException(401, "로그인이 필요합니다.")

    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise HTTPException(503, "Supabase 환경변수가 설정되지 않았습니다.")

    try:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {credentials.credentials}"},
            timeout=8,
        )
        response.raise_for_status()
        auth_user = response.json()
    except Exception:
        raise HTTPException(401, "유효하지 않은 Supabase 세션입니다.")
    profile = UserRepository(db).get(auth_user["id"])
    if not profile:
        raise HTTPException(409, "회원 프로필이 아직 생성되지 않았습니다.")
    return profile
