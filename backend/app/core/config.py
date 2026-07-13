from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "KMU Smart Scheduler API"
    database_url: str = "sqlite:///./kmu_scheduler.db"
    jwt_secret: str = "development-only-secret"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    access_token_minutes: int = 60 * 24 * 7
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    kmu_academic_url: str = "https://www.kmu.ac.kr"
    kmu_notice_url: str = "https://www.kmu.ac.kr"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
