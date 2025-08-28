# app/crud/contacts.py
from datetime import datetime
from typing import List, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.company import Company

def _now() -> datetime:
    return datetime.utcnow()

def keep_digits_plus(s: str | None) -> str | None:
    if not s:
        return None
    out = []
    for ch in str(s):
        o = ord(ch)
        if (48 <= o <= 57) or ch in "+ ":
            out.append(ch)
    res = "".join(out).strip()
    return res or None

def count_contacts(db: Session) -> int:
    return db.execute(
        select(func.count()).select_from(Contact).where(
            or_(Contact.is_active == True, Contact.is_active.is_(None)),
            Contact.deleted_at.is_(None),
        )
    ).scalar_one()

def get_contacts(
    db: Session, *, page: int, limit: int, search: str = "", company: str = "", titles: List[str] | None = None
) -> Tuple[List[Contact], int]:
    titles = titles or []

    where = [
        or_(Contact.is_active == True, Contact.is_active.is_(None)),
        Contact.deleted_at.is_(None),
    ]

    if search:
        like = f"%{search.lower()}%"
        where.append(or_(
            func.lower(Contact.first_name).like(like),
            func.lower(Contact.last_name).like(like),
            func.lower(Contact.email).like(like),
            func.lower(Contact.title).like(like),
            func.lower(Contact.company).like(like),
        ))

    if company:
        clike = f"%{company.lower()}%"
        where.append(func.lower(Contact.company).like(clike))

    if titles:
        ors = [func.lower(Contact.title).like(f"%{t.lower()}%") for t in titles]
        where.append(or_(*ors))

    base = select(Contact)
    stmt = base.where(and_(*where))

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()

    rows = db.execute(
        stmt.order_by(func.coalesce(Contact.updated_at, Contact.created_at).desc())
            .offset((page - 1) * limit)
            .limit(limit)
    ).scalars().all()

    return rows, total

def list_titles(db: Session, max_items: int = 250) -> list[str]:
    rows = db.execute(
        select(func.trim(Contact.title)).where(
            func.trim(Contact.title).isnot(None),
            func.trim(Contact.title) != "",
            or_(Contact.is_active == True, Contact.is_active.is_(None)),
            Contact.deleted_at.is_(None),
        ).distinct().order_by(func.trim(Contact.title)).limit(max_items)
    ).all()
    return [r[0] for r in rows]
