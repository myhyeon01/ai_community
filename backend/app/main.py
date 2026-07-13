from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import router
from app.core.config import settings
from app.core.database import Base, engine
import app.models

@asynccontextmanager
async def lifespan(app:FastAPI):
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
    yield

app=FastAPI(title=settings.app_name,version="0.1.0",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])
app.include_router(router)
@app.get("/health",tags=["System"])
def health(): return {"status":"ok"}
