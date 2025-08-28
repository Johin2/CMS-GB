from datetime import datetime
from sqlalchemy import Column, DateTime, String
from app.models.base import Base


class Override(Base):
    __tablename__ = "overrides"

    # Use URL as primary key (unique row per article)
    url = Column(String, primary_key=True, index=True)

    # Optional type ("Funding" / "In the News")
    type = Column(String, nullable=True)

    # People fields
    name = Column(String, nullable=True)
    company = Column(String, nullable=True)
    designation = Column(String, nullable=True)

    # Funding fields
    amount = Column(String, nullable=True)
    round = Column(String, nullable=True)
    investors = Column(String, nullable=True)

    # Display fields used by UI table
    date = Column(String, nullable=True)
    month = Column(String, nullable=True)

    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
