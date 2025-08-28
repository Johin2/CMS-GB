# app/models/contact.py
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.sql import func
import uuid

from app.models.base import Base

def _uuid() -> str:
    return str(uuid.uuid4())

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    title = Column(String, nullable=True)
    seniority = Column(String, nullable=True)
    linkedin_url = Column(Text, nullable=True)

    company_id = Column(String, ForeignKey("companies.id"), nullable=True)
    company = Column(String, nullable=True)

    source = Column(String, nullable=True)
    email_status = Column(String, nullable=True)

    is_active = Column(Boolean, nullable=False, default=True)

    first_seen_at = Column(DateTime(timezone=True), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
