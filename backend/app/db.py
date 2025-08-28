# app/db.py
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from urllib.parse import urlparse, unquote
from pathlib import Path
import os
from .core.config import settings

def _ensure_sqlite_parent_dir(url: str) -> str:
    parsed = urlparse(url)
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.path.join(BASE_DIR, "app.db")  # lives in backend/app.db


    # On Windows an absolute path may look like "/C:/Users/..."; strip leading slash.
    if db_path.startswith("/") and len(db_path) > 2 and db_path[2] == ":":
        db_path = db_path.lstrip("/")

    # Relative path (e.g., ./app/.data/dev.db) is fine as-is.
    p = Path(db_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)

resolved_db_path = _ensure_sqlite_parent_dir(settings.DATABASE_URL)
print(f"[DB] Using URL: {settings.DATABASE_URL}")
print(f"[DB] Resolved SQLite file path: {resolved_db_path}")

assert "+aiosqlite" in settings.DATABASE_URL, f"Expected async SQLite URL, got: {settings.DATABASE_URL}"

engine: AsyncEngine = create_async_engine(settings.DATABASE_URL, future=True, echo=False)
SessionLocal = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def init_db():
    sql_path = Path(__file__).parent / "bootstrap_sql.sql"
    with open(sql_path, "r", encoding="utf-8") as f:
        ddl = f.read()
    async with engine.begin() as conn:
        for chunk in ddl.split(";"):
            stmt = chunk.strip()
            if stmt:
                await conn.execute(text(stmt))

async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
