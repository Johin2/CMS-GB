# app/models/company.py
from sqlalchemy import Column, DateTime, String
from sqlalchemy.sql import func
import uuid

from app.models.base import Base

def _uuid() -> str:
    return str(uuid.uuid4())

class Company(Base):
    __tablename__ = "companies"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=True, index=True)
    domain = Column(String, nullable=True, unique=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
