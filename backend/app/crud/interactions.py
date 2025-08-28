# app/crud/interactions.py
import json
from sqlalchemy.orm import Session

from app.models.interaction import Interaction

def log_interaction(db: Session, *, contact_id: str, type_: str, meta: dict | None = None) -> None:
    evt = Interaction(contact_id=contact_id, type=type_, meta=json.dumps(meta or {}))
    db.add(evt)
