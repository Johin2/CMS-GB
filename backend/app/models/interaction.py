# app/models/interaction.py
from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.sql import func
import uuid

from app.models.base import Base

def _uuid() -> str:
    return str(uuid.uuid4())

class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(String, primary_key=True, default=_uuid)
    contact_id = Column(String, ForeignKey("contacts.id"), index=True, nullable=False)
    type = Column(String, nullable=False)  # e.g., 'DELETED', 'UPDATED'
    meta = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
