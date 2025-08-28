# backend/app/db/session.py
from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# -------------------------------------------------------
# Database URL
# -------------------------------------------------------
# Examples:
#   postgresql+psycopg2://user:pass@localhost:5432/mydb
#   mysql+pymysql://user:pass@localhost:3306/mydb
#   sqlite:///./app.db
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db").strip()

# Extra connect args for SQLite
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    # Needed so SQLite works in multi-threaded FastAPI
    connect_args = {"check_same_thread": False}

# -------------------------------------------------------
# Engine & Session factory
# -------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,          # drops dead connections
    future=True,                 # SQLAlchemy 2.0 style
    connect_args=connect_args,   # only used by SQLite
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
    future=True,
)

# Base class for your ORM models to inherit from
Base = declarative_base()


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
