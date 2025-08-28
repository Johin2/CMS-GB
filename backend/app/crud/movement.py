from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.models.movement import Movement

def get_by_url(db: Session, url: str) -> Optional[Movement]:
    return db.query(Movement).filter(Movement.url == url).one_or_none()

def create(
    db: Session,
    *,
    title: str,
    url: str,
    source: str = "afaqs",
    published_at=None,  # datetime.date | None
) -> Movement:
    row = Movement(title=title, url=url, source=source, published_at=published_at)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

def list_recent(db: Session, limit: int = 1000) -> List[Movement]:
    return (
        db.query(Movement)
        .order_by(Movement.published_at.desc().nullslast(), desc(Movement.id))
        .limit(limit)
        .all()
    )

def count_all(db: Session) -> int:
    return db.query(Movement).count()
