from typing import Optional, Dict, Any, Iterable, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models.override import Override

SELECTABLE = {
    "type", "name", "company", "designation",
    "amount", "round", "investors", "date", "month",
}


def get_by_url(db: Session, url: str) -> Optional[Override]:
    if not url:
        return None
    return db.query(Override).filter(Override.url == url).first()


def list_all(db: Session, limit: Optional[int] = None) -> List[Override]:
    """
    Return all overrides, newest first. Optional limit for callers that want to bound results.
    """
    q = db.query(Override).order_by(desc(Override.updated_at))
    if limit is not None:
        q = q.limit(int(limit))
    return q.all()


def list_for_urls(db: Session, urls: Iterable[str]) -> Dict[str, Override]:
    """Fetch overrides for a set of URLs, returned as {url: Override}."""
    urls = list({u for u in urls if u})
    if not urls:
        return {}
    rows = db.query(Override).filter(Override.url.in_(urls)).all()
    return {r.url: r for r in rows}


def upsert(db: Session, url: str, values: Dict[str, Any]) -> Override:
    row = get_by_url(db, url)
    if row is None:
        row = Override(url=url)
        db.add(row)
    for k, v in values.items():
        if k in SELECTABLE:
            setattr(row, k, v)  # allow None to clear a field
    db.commit()
    db.refresh(row)
    return row


def delete_by_url(db: Session, url: str) -> bool:
    row = get_by_url(db, url)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
