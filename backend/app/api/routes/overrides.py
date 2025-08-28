from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.override import OverrideUpsert
from app.crud.override import (
    upsert as crud_upsert,
    delete_by_url as crud_delete,
    get_by_url as crud_get,
    list_all as crud_list_all,   # optional
)

router = APIRouter(prefix="/overrides", tags=["overrides"])


@router.post("/upsert", response_model=dict)
def upsert_override(payload: OverrideUpsert, db: Session = Depends(get_db)):
    if not payload.url:
        raise HTTPException(status_code=400, detail="url is required")
    values = payload.dict()
    url = values.pop("url")
    row = crud_upsert(db, url, values)
    return {"status": "ok", "url": row.url}


@router.delete("/one", response_model=dict)
def delete_override(url: str = Query(...), db: Session = Depends(get_db)):
    ok = crud_delete(db, url)
    if not ok:
        raise HTTPException(status_code=404, detail="override not found")
    return {"status": "ok", "url": url}


# Optional helpers for debugging in dev
@router.get("/one", response_model=dict)
def get_override(url: str = Query(...), db: Session = Depends(get_db)):
    row = crud_get(db, url)
    if not row:
        raise HTTPException(status_code=404, detail="override not found")
    return {
        "url": row.url,
        "type": row.type,
        "name": row.name,
        "company": row.company,
        "designation": row.designation,
        "amount": row.amount,
        "round": row.round,
        "investors": row.investors,
        "date": row.date,
        "month": row.month,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/all", response_model=dict)
def list_overrides(db: Session = Depends(get_db)):
    rows = crud_list_all(db)
    return {
        "items": [
            {
                "url": r.url,
                "type": r.type,
                "name": r.name,
                "company": r.company,
                "designation": r.designation,
                "amount": r.amount,
                "round": r.round,
                "investors": r.investors,
                "date": r.date,
                "month": r.month,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    }
