from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.api import router
from app.core.config import settings
from app.core.database import Base, engine
import app.models

def ensure_sqlite_schema():
    with engine.begin() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(school_events)"))}
        additions = {
            "summary": "TEXT NOT NULL DEFAULT ''",
            "apply_deadline": "DATETIME",
            "source_type": "VARCHAR(20) NOT NULL DEFAULT 'school'",
            "location": "VARCHAR(150) NOT NULL DEFAULT ''",
            "interests": "TEXT NOT NULL DEFAULT ''",
            "apply_url": "VARCHAR(500) NOT NULL DEFAULT ''",
            "created_at": "DATETIME",
        }
        for name, definition in additions.items():
            if name not in columns:
                conn.execute(text(f"ALTER TABLE school_events ADD COLUMN {name} {definition}"))
        conn.execute(
            text(
                """
                UPDATE school_events
                SET source_type = 'external'
                WHERE source_key LIKE 'kmu:141:%'
                   OR url LIKE '%mnu_uid=141%'
                   OR apply_url LIKE '%mnu_uid=141%'
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE school_events
                SET source_type = 'school'
                WHERE source_key LIKE 'kmu:143:%'
                   OR url LIKE '%mnu_uid=143%'
                   OR apply_url LIKE '%mnu_uid=143%'
                   OR source_key LIKE 'story:%'
                """
            )
        )

@asynccontextmanager
async def lifespan(app:FastAPI):
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
        ensure_sqlite_schema()
    yield

app=FastAPI(title=settings.app_name,version="0.1.0",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])
app.include_router(router)
@app.get("/health",tags=["System"])
def health(): return {"status":"ok"}
