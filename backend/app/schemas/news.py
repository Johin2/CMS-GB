# backend/app/schemas/news.py
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class NewsItem(BaseModel):
    # For the list endpoint
    person_name: Optional[str] = None
    role: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    url: Optional[str] = None

    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    city: Optional[str] = None
    month_label: Optional[str] = None

    category: Optional[str] = None  # "People Spotting" | "Funding"
    source: Optional[str] = None


class NewsFlatItem(BaseModel):
    company: Optional[str] = None
    industry: Optional[str] = None
    promoting: Optional[str] = None
    name: Optional[str] = None
    designation: Optional[str] = None
    email: Optional[str] = None
    link: Optional[str] = None
    date: Optional[str] = None
    location: Optional[str] = None
    created_by: Optional[str] = None
    ambassador_featuring: Optional[str] = None
    month: Optional[str] = None
    type: str

    # ✅ Add these fields
    amount: Optional[str] = None
    round: Optional[str] = None
    investors: Optional[str] = None