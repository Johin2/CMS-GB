from typing import Optional, Dict
from sqlalchemy.orm import Session
from app.models.title_cache import TitleParseCache

def get_by_url(db: Session, url: str) -> Optional[TitleParseCache]:
    return db.query(TitleParseCache).filter(TitleParseCache.url == url).one_or_none()

def upsert(
    db: Session,
    *,
    url: str,
    title: str,
    data: Dict[str, str | None],
) -> TitleParseCache:
    row = get_by_url(db, url)
    if row is None:
        row = TitleParseCache(url=url, title=title)
        db.add(row)

    row.title = title
    row.company = data.get("company")
    row.name = data.get("name")
    row.designation = data.get("designation")
    row.ambassador_featuring = data.get("ambassador_featuring")
    row.promoting = data.get("promoting")
    row.location = data.get("location")

    db.commit()
    db.refresh(row)
    return row
