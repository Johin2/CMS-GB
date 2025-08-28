from typing import Optional
from pydantic import BaseModel


class OverrideUpsert(BaseModel):
    url: str
    type: Optional[str] = None

    # people
    name: Optional[str] = None
    company: Optional[str] = None
    designation: Optional[str] = None

    # funding
    amount: Optional[str] = None
    round: Optional[str] = None
    investors: Optional[str] = None

    # display
    date: Optional[str] = None
    month: Optional[str] = None
