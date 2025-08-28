# app/crud/companies.py
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.models.company import Company

def upsert_company(
    db: Session, *, name: Optional[str], domain: Optional[str]
) -> Optional[str]:
    """Return company_id or None. Prefer domain match; fall back to name."""
    if domain:
        existing = db.execute(select(Company).where(Company.domain == domain)).scalar_one_or_none()
        if existing:
            if name and not existing.name:
                existing.name = name
            return existing.id
        obj = Company(name=name or domain, domain=domain)
        db.add(obj)
        db.flush()
        return obj.id

    if name:
        existing = db.execute(
            select(Company).where(func.lower(Company.name) == func.lower(name))
        ).scalar_one_or_none()
        if existing:
            return existing.id
        obj = Company(name=name)
        db.add(obj)
        db.flush()
        return obj.id

    return None

def list_unique_companies(db: Session, max_items: int = 250) -> list[str]:
    rows = db.execute(
        select(Company.name).where(Company.name.isnot(None)).order_by(Company.name).limit(max_items)
    ).all()
    return [r[0] for r in rows]
