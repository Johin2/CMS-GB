from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# -------------------------------------------------------
# Database URL
# -------------------------------------------------------
# Examples:
#   postgresql+psycopg://user:pass@host:5432/dbname
#   mysql+pymysql://user:pass@host:3306/dbname
#   sqlite:///./app.db
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db").strip()

# Extra connect args for SQLite
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# -------------------------------------------------------
# Engine & Session factory (SYNC)
# -------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,        # drops dead connections
    future=True,               # SQLAlchemy 2.0 style
    connect_args=connect_args, # only used by SQLite
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    class_=Session,
    future=True,
)

# -------------------------------------------------------
# FastAPI dependency
# -------------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    """
    Usage in routes:
        from app.db.session import get_db
        def endpoint(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
