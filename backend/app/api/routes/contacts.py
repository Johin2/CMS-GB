# app/api/routes/contacts.py
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.crud.contacts import get_contacts, count_contacts, list_titles, keep_digits_plus
from app.crud.companies import upsert_company, list_unique_companies
from app.crud.interactions import log_interaction
from app.models.contact import Contact
from app.schemas.contacts import (
    ContactList,
    ContactsFacets,
    ContactOut,
    ContactCreate,
    ContactUpdate,
    ContactUpsertResponse,
)

router = APIRouter(prefix="/contacts", tags=["contacts"])

# GET /api/contacts/list
@router.get("/list", response_model=ContactList)
def list_contacts(
    search: str = Query("", alias="search"),
    company: str = Query("", alias="company"),
    title_csv: str = Query("", alias="title"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=1000),
    ts: Optional[int] = Query(None, alias="ts"),  # cache-buster accepted, ignored
    db: Session = Depends(get_db),
):
    titles: List[str] = [t.strip() for t in title_csv.split(",") if t.strip()] if title_csv else []
    items, total = get_contacts(
        db,
        page=page,
        limit=limit,
        search=search.strip().lower(),
        company=company.strip().lower(),
        titles=titles,
    )
    return {"items": items, "page": page, "limit": limit, "total": total}


# GET /api/contacts/facets
@router.get("/facets", response_model=ContactsFacets)
def contacts_facets(db: Session = Depends(get_db)):
    total = count_contacts(db)
    titles = list_titles(db, max_items=250)
    companies = list_unique_companies(db, max_items=250)
    return {"titles": titles, "companies": companies, "total_contacts": total}


# GET /api/contacts/{id}
@router.get("/{id}", response_model=ContactOut)
def get_contact(id: str, db: Session = Depends(get_db)):
    obj = db.get(Contact, id)
    if not obj or (obj.deleted_at is not None):
        raise HTTPException(status_code=404, detail="Contact not found")
    return obj


# DELETE /api/contacts/{id} (soft delete)
@router.delete("/{id}")
def delete_contact(id: str, db: Session = Depends(get_db)):
    obj: Optional[Contact] = db.get(Contact, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.utcnow()
    obj.is_active = False
    obj.deleted_at = now
    obj.updated_at = now
    log_interaction(db, contact_id=id, type_="DELETED", meta={"reason": "deleted_via_ui"})
    db.commit()
    return {"ok": True, "id": id, "soft_deleted": True}


# POST /api/contacts (CREATE-ONLY; 409 if email exists)
@router.post("", response_model=ContactUpsertResponse, status_code=status.HTTP_201_CREATED)
def create_contact(payload: ContactCreate, db: Session = Depends(get_db)):
    email = (payload.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")

    # If a live (non-deleted) contact with this email exists, reject
    exists = (
        db.query(Contact)
        .filter(Contact.email == email, Contact.deleted_at.is_(None))
        .one_or_none()
    )
    if exists:
        raise HTTPException(status_code=409, detail="A contact with this email already exists")

    first_name = (payload.firstName or "").strip() or None
    last_name = (payload.lastName or "").strip() or None
    title = (payload.title or "").strip() or None
    linkedin = (payload.linkedinUrl or "").strip() or None
    phone = keep_digits_plus(payload.phone)
    company_name = (payload.company or "").strip() or None
    company_domain = (payload.companyDomain or "").strip() or None

    company_id = upsert_company(db, name=company_name, domain=company_domain)
    now = datetime.utcnow()

    obj = Contact(
        email=email,
        first_name=first_name or "Unknown",
        last_name=last_name or "",
        phone=phone,
        title=title,
        linkedin_url=linkedin,
        company_id=company_id,
        company=company_name,
        source="manual",
        email_status="unverified",
        is_active=True,
        first_seen_at=now,
        last_synced_at=now,
        updated_at=now,
        created_at=now,
    )
    db.add(obj)
    db.flush()
    log_interaction(db, contact_id=obj.id, type_="UPDATED", meta={"reason": "created_manual"})
    db.commit()
    return {"created": True, "contact": ContactOut.model_validate(obj)}


# PATCH /api/contacts/{id} (partial update/edit)
@router.patch("/{id}", response_model=ContactOut)
def update_contact(id: str, payload: ContactUpdate, db: Session = Depends(get_db)):
    obj: Optional[Contact] = db.get(Contact, id)
    if not obj or (obj.deleted_at is not None):
        raise HTTPException(status_code=404, detail="Contact not found")

    company_name = payload.company or None
    company_domain = payload.companyDomain or None
    company_id = upsert_company(db, name=company_name, domain=company_domain)

    if payload.first_name is not None:
        obj.first_name = payload.first_name or None
    if payload.last_name is not None:
        obj.last_name = payload.last_name or None
    if payload.title is not None:
        obj.title = payload.title or None
    if payload.phone is not None:
        obj.phone = keep_digits_plus(payload.phone)
    if payload.linkedin_url is not None:
        obj.linkedin_url = payload.linkedin_url or None

    if company_id:
        obj.company_id = company_id
    if company_name is not None:
        obj.company = company_name or None

    now = datetime.utcnow()
    obj.updated_at = now
    obj.last_synced_at = now
    db.commit()
    return ContactOut.model_validate(obj)
