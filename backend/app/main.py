# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from app.api.routes.contacts import router as contacts_router
from app.api.routes.health import router as health_router
from app.api.routes.news import router as news_router
from app.api.routes.debug import router as debug_router

from app.core.config import settings
from app.api.routes.news import start_funding_refresh_background
from app.db.base import create_all
from app.db.session import engine
from app.scheduler import init_scheduler
from app.api.routes.overrides import router as overrides_router  # add
         # add

# Create tables (after session ensured the folder exists)
create_all(engine)

# Helpful log so you can see exactly which DB file is used
if settings.DATABASE_URL.startswith("sqlite:///"):
    print("[DB] Using:", Path(settings.DATABASE_URL.replace("sqlite:///","")).resolve())

app = FastAPI(title="People Movements API", version="1.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=(settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else str(settings.CORS_ORIGINS).split(",")),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(health_router, tags=["health"])
app.include_router(news_router, prefix="/api", tags=["news"])
app.include_router(debug_router, prefix="/api/debug", tags=["debug"])
app.include_router(overrides_router, prefix="/api")    
app.include_router(contacts_router, prefix="/api", tags=["contacts"])

init_scheduler(app)
@app.on_event("startup")
async def _start_background_jobs():
    await start_funding_refresh_background()