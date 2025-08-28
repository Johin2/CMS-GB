from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

# ---------- OUT MODELS ----------
class ContactOut(BaseModel):
    id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    linkedin_url: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True  # pydantic v2 compat via FastAPI wrapper

class ContactList(BaseModel):
    items: List[ContactOut]
    page: int
    limit: int
    total: int

class ContactsFacets(BaseModel):
    titles: List[str]
    companies: List[str]
    total_contacts: int

# ---------- IN MODELS ----------
class ContactCreate(BaseModel):
    email: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    linkedinUrl: Optional[str] = None
    company: Optional[str] = None
    companyDomain: Optional[str] = None

# Accept BOTH snake_case and camelCase for PATCH
class ContactUpdate(BaseModel):
    # snake_case fields with camelCase aliases
    first_name: Optional[str] = Field(default=None, alias="firstName")
    last_name: Optional[str]  = Field(default=None, alias="lastName")
    title: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = Field(default=None, alias="linkedinUrl")
    company: Optional[str] = None
    companyDomain: Optional[str] = None  # leave as-is (your backend reads this name)

    class Config:
        populate_by_name = True  # allow either form
        extra = "ignore"         # ignore stray keys

# POST response wrapper
class ContactUpsertResponse(BaseModel):
    created: bool
    contact: ContactOut
