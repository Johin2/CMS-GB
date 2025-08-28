from sqlalchemy import Column, Integer, String, Text, UniqueConstraint, Date
from app.db.base import Base

class Movement(Base):
    __tablename__ = "movements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    url = Column(String(500), nullable=False)
    source = Column(String(100), nullable=False, default="afaqs")
    # DATE only (no time); removed captured_at
    published_at = Column(Date, nullable=True)

    __table_args__ = (UniqueConstraint("url", name="uq_movements_url"),)
