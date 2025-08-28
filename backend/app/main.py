import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.contacts import router as contacts_router
from app.api.routes.health import router as health_router
from app.api.routes.news import router as news_router, start_funding_refresh_background, start_people_refresh_background
from app.api.routes.debug import router as debug_router
from app.api.routes.overrides import router as overrides_router

from app.core.config import settings
from app.db.base import create_all
from app.db.session import engine
from app.scheduler import init_scheduler


def _parse_origins(env_value: str) -> list[str]:
    if not env_value:
        return []
    raw = [p.strip() for p in env_value.replace("\n", ",").split(",")]
    cleaned = []
    for v in raw:
        if not v:
            continue
        v = v.rstrip("/")
        if v not in cleaned:
            cleaned.append(v)
    return cleaned


app = FastAPI(title="People Movements API", version="1.3")

env_origins = os.getenv("CORS_ORIGIN", "")
allowed_origins = _parse_origins(env_origins) or [
    "https://cms-gb.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)

app.include_router(health_router, tags=["health"])
app.include_router(news_router, prefix="/api", tags=["news"])
app.include_router(debug_router, prefix="/api/debug", tags=["debug"])
app.include_router(overrides_router, prefix="/api", tags=["overrides"])
app.include_router(contacts_router, prefix="/api", tags=["contacts"])

init_scheduler(app)

@app.on_event("startup")
def _startup_db() -> None:
    create_all(engine)
    if settings.DATABASE_URL.startswith("sqlite:///"):
        print("[DB] Using:", Path(settings.DATABASE_URL.replace("sqlite:///", "")).resolve())
    print("[CORS] allow_origins =", allowed_origins)

@app.on_event("startup")
async def _start_background_jobs() -> None:
    await start_funding_refresh_background()
    await start_people_refresh_background()
