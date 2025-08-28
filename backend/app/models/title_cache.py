from sqlalchemy import Column, Integer, String, Text, UniqueConstraint
from app.db.base import Base

class TitleParseCache(Base):
    __tablename__ = "title_parse_cache"

    id = Column(Integer, primary_key=True)
    url = Column(String(500), nullable=False)
    title = Column(Text, nullable=False)

    # store normalized fields as plain text (SQLite-friendly)
    company = Column(Text, nullable=True)
    name = Column(Text, nullable=True)
    designation = Column(Text, nullable=True)
    ambassador_featuring = Column(Text, nullable=True)
    promoting = Column(Text, nullable=True)
    location = Column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("url", name="uq_title_cache_url"),)
