from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional, Callable, Dict, Tuple
import json
import os
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from dateutil import parser as dateparse
from sqlalchemy.orm import Session

from app.db.session import get_db
try:
    from app.db.session import SessionLocal
except Exception:
    SessionLocal = None

from app.models.movement import Movement
from app.schemas.news import NewsItem, NewsFlatItem
from app.crud.movement import get_by_url, create, list_recent

# Manual overrides (user edits)
from app.crud.override import (
    list_all as list_overrides_all,
)

# People-spotting utilities
from app.services.scraper.afaqs import scrape_paginated, is_positive_movement

# Funding (RSS) utilities
from app.services.scraper.funding_rss import fetch_funding_items
# Funding parser + stats hooks
from app.services.scraper.funding_parse import (
    parse_funding_text,
    get_funding_parse_stats,
    begin_funding_parse_request,
)

# Optional range-capable funding fetcher (backward-compatible)
try:
    # expected signature:
    # fetch_funding_items_range(start_dt: Optional[datetime], end_dt: Optional[datetime], max_pages: int = 200) -> List[dict]
    from app.services.scraper.funding_rss import fetch_funding_items_range as _fetch_funding_items_range  # type: ignore
except Exception:
    _fetch_funding_items_range: Optional[Callable[..., List[dict]]] = None

# -------- Optional People-title LLM fallback (only if enabled) --------
USE_LLM = str(os.getenv("NEWS_PARSE_WITH_LLM", "1")).lower() in {"1", "true", "yes", "on"}
LLM_MODEL = os.getenv("NEWS_PARSE_MODEL", "gpt-4.1-mini")
try:
    from openai import OpenAI  # pip install openai>=1.30.0
    _openai_available = True
except Exception:  # pragma: no cover
    OpenAI = None
    _openai_available = False

_openai_client = None
if USE_LLM and _openai_available and os.getenv("OPENAI_API_KEY"):
    try:
        _openai_client = OpenAI()
    except Exception:
        _openai_client = None
        USE_LLM = False
# --------------------------------------------------------

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/news")

# =======================
# Funding cache & schedule
# =======================
USE_FUNDING_CACHE = str(os.getenv("FUNDING_CACHE_ENABLED", "1")).lower() in {"1", "true", "yes", "on"}
FUNDING_CACHE_WARM_ON_START = str(os.getenv("FUNDING_CACHE_WARM_ON_START", "1")).lower() in {"1", "true", "yes", "on"}
# Monday refresh time (UTC)
FUNDING_CACHE_UTC_HOUR = int(os.getenv("FUNDING_CACHE_UTC_HOUR", "6"))     # 06:00 UTC
FUNDING_CACHE_UTC_MIN  = int(os.getenv("FUNDING_CACHE_UTC_MINUTE", "0"))

# Cache stores raw feed items (so endpoints can still apply their own filters)
FUNDING_CACHE: dict = {
    "raw": None,            # List[dict] | None
    "built_at": None,       # datetime | None (UTC)
}
_funding_task: Optional[asyncio.Task] = None

# =======================
# People hourly sync
# =======================
PEOPLE_SYNC_ENABLED = str(os.getenv("PEOPLE_SYNC_ENABLED", "1")).lower() in {"1", "true", "yes", "on"}
PEOPLE_SYNC_INTERVAL_MIN = int(os.getenv("PEOPLE_SYNC_INTERVAL_MIN", "60"))
PEOPLE_SYNC_BACKSTOP_DAYS = int(os.getenv("PEOPLE_SYNC_BACKSTOP_DAYS", "30"))
PEOPLE_BACKFILL_ON_START = str(os.getenv("PEOPLE_BACKFILL_ON_START", "1")).lower() in {"1", "true", "yes", "on"}
PEOPLE_BACKFILL_DAYS = int(os.getenv("PEOPLE_BACKFILL_DAYS", "30"))
PEOPLE_BACKFILL_MAX_PAGES = int(os.getenv("PEOPLE_BACKFILL_MAX_PAGES", "600"))
_people_task: Optional[asyncio.Task] = None


# --------------------------
# helpers
# --------------------------

def _as_datetime(v: Optional[object]) -> Optional[datetime]:
    """Normalize date/datetime to datetime for safe comparisons."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    return None


def _as_date(v: Optional[object]) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    if isinstance(v, datetime):
        return v.date()
    return None


def _format_day_mon_year(dt: datetime | date) -> str:
    """16-Jan-25 (no leading zero on day)."""
    if isinstance(dt, datetime):
        d = dt.date()
    else:
        d = dt
    return f"{d.day}-{d.strftime('%b')}-{d.strftime('%y')}"


def _clean(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = s.strip().strip("—–-: ")
    return t or None


def _strip_possessive(name: Optional[str]) -> Optional[str]:
    """Remove leading brand possessives, e.g. 'Netflix’s Akash Iyer' -> 'Akash Iyer'."""
    if not name:
        return name
    for tok in ("’s ", "'s "):
        pos = name.find(tok)
        if 0 <= pos <= 20:
            return name[pos + len(tok):].strip()
    return name


def _max_col(db: Session, col_name: str):
    """Return MAX(Movement.<col>) if the column exists, else None."""
    col = getattr(Movement, col_name, None)
    if col is None:
        return None
    from sqlalchemy import func as _func
    return db.query(_func.max(col)).scalar()


def _row_created_like(r) -> Optional[datetime]:
    """Prefer captured_at, else created_at, else created (whichever exists)."""
    return (
        getattr(r, "captured_at", None)
        or getattr(r, "created_at", None)
        or getattr(r, "created", None)
    )


def _parse_date_only(s: Optional[str]) -> Optional[datetime]:
    """Parse 'YYYY-MM-DD' (or similar) and return a midnight-UTC datetime; None if empty/invalid."""
    if not s:
        return None
    try:
        d = dateparse.parse(s)
        return datetime(d.year, d.month, d.day)
    except Exception:
        return None


# ---------- rules-only people-title parser ----------
def _strip_descriptor_prefix(s: str) -> str:
    """
    Remove leading qualifiers like:
      - "Former Shopify and Wix executive"
      - "Ex-Flipkart, Amazon veteran"
      - "longtime Google manager"
    Return the likely personal name part.
    """
    s = _clean(s)
    if not s:
        return s

    words = s.split()
    lows  = [w.lower() for w in words]

    anchors = (
        "executive","veteran","alum","alumnus","alumna",
        "leader","head","manager","director","officer",
        "chief","founder","cofounder","co-founder","vp",
        "president","vice-president","vice"
    )
    last_anchor = -1
    for idx, tok in enumerate(lows):
        tok_norm = tok.replace("-", "")
        if tok in anchors or tok_norm in ("cofounder","vicepresident"):
            last_anchor = idx
    if last_anchor != -1 and last_anchor + 1 < len(words):
        tail = " ".join(words[last_anchor + 1:]).strip(" ,")
        if tail:
            return tail

    qualifiers = ("former", "ex", "ex-", "longtime")
    if lows and (lows[0] in qualifiers or lows[0].startswith("ex-")):
        for i in range(1, len(words) - 1):
            if words[i][:1].isupper() and words[i+1][:1].isupper():
                return " ".join(words[i:]).strip(" ,")

    sl = s.lower()
    if " at " in sl:
        k = sl.rfind(" at ")
        after = _clean(s[k + 4:])
        if after:
            return after

    return s


def _parse_people_title_rules(title: str) -> dict:
    out = {"name": None, "company": None, "designation": None, "ambassador_featuring": None}
    if not title:
        return out

    def _split_trailing_company(rest: str):
        txt = _clean(rest).strip(" ,")
        if not txt:
            return "", ""
        tokens = txt.replace("—", " – ").replace("-", "-").split()
        n = len(tokens)
        if n == 0:
            return "", ""
        org_suffixes = {
            "media", "group", "holdings", "limited", "ltd", "inc", "llc", "llp", "plc",
            "network", "networks", "studios", "agency", "agencies", "communications",
            "company", "co.", "corp", "corporation", "enterprises", "solutions", "systems"
        }
        role_words = {
            "president", "chief", "cso", "ceo", "cfo", "coo", "cmo", "cio", "cto", "chairman",
            "vice", "vp", "director", "head", "lead", "officer", "partner", "manager"
        }
        i = n - 1
        company_tokens = []
        last_low = tokens[i].strip(",").lower()
        if last_low in org_suffixes:
            while i >= 0:
                tok = tokens[i].strip(",")
                low = tok.lower()
                if low in role_words or low in {"&", "and"} or tok in {"–", "-", "/"}:
                    break
                if tok[:1].isupper() or tok.isupper():
                    company_tokens.insert(0, tokens[i])
                    i -= 1
                    continue
                break
            company = _clean(" ".join(company_tokens)).strip()
            designation = _clean(" ".join(tokens[:i + 1])).strip(" ,–-")
            if company and designation:
                return designation, company
        return txt, ""

    t = " ".join(title.replace("’", "'").split())
    low = t.lower()

    if ("ambassador" in low or "featuring" in low) and " as " in low:
        before_as = t[:low.find(" as ")].strip()
        parts = before_as.split()
        out["ambassador_featuring"] = _clean(" ".join(parts[-2:])) if len(parts) >= 2 else _clean(before_as)

    if " expands " in low and " role " in low:
        i = low.find(" expands ")
        company = _clean(t[:i])
        rest = t[i + len(" expands "):]
        low_rest = rest.lower()
        name = None
        designation = None
        pat = "'s role to "
        if pat in low_rest:
            k = low_rest.find(pat)
            name = _strip_possessive(_clean(rest[:k]))
            designation = _clean(rest[k + len(pat):])
        elif " the role of " in low_rest and " to " in low_rest:
            a = low_rest.find(" the role of ")
            b = low_rest.find(" to ", a + len(" the role of "))
            if b != -1:
                name = _strip_possessive(_clean(rest[a + len(" the role of "): b]))
                designation = _clean(rest[b + len(" to "):])
        if company and name and designation:
            out.update({"company": company, "name": name, "designation": designation})
            return out

    if " joins " in low and " as " in low:
        i = low.find(" joins ")
        j = low.find(" as ", i + 7)
        left = _clean(t[:i])
        out["name"] = _strip_possessive(left)
        out["company"] = _clean(t[i + 7:j])
        out["designation"] = _clean(t[j + 4:])
        return out

    for verb in (" appoints ", " names "):
        if verb in low:
            i = low.find(verb)
            company = _clean(t[:i])
            rest = t[i + len(verb):].strip()
            low_rest = rest.lower()
            name = None
            designation = None
            for sep, add_len in ((" as ", 4), (" to ", 4), (" for ", 5)):
                if sep in low_rest:
                    j = low_rest.find(sep)
                    left = _clean(rest[:j])
                    name = _strip_possessive(left)
                    designation = _clean(rest[j + add_len:])
                    break
            if name is None:
                name = _strip_possessive(_clean(rest))
            out.update({"company": company, "name": name, "designation": designation})
            return out

    for verb in (" promotes ", " elevates "):
        if verb in low:
            i = low.find(verb)
            company = _clean(t[:i])
            rest = t[i + len(verb):].strip()
            low_rest = rest.lower()
            name = None
            designation = None
            for sep, add in ((" to ", 4), (" as ", 4), (" for ", 5)):
                k = low_rest.find(sep)
                if k != -1:
                    left = _clean(rest[:k])
                    name = _strip_possessive(left)
                    rhs = rest[k + add:].strip()
                    if (" at " in rhs.lower()) or (" of " in rhs.lower()):
                        rl = rhs.lower()
                        if " at " in rl:
                            j = rl.rfind(" at ")
                            designation = _clean(rhs[:j]).rstrip(",")
                            company_rhs = _clean(rhs[j + 4:])
                        else:
                            j = rl.rfind(" of ")
                            designation = _clean(rhs[:j]).rstrip(",")
                            company_rhs = _clean(rhs[j + 4:])
                        out.update({"company": company_rhs, "name": name, "designation": designation})
                        return out
                    else:
                        designation, company_rhs = _split_trailing_company(rhs)
                        out.update({"company": company_rhs if company_rhs else company, "name": name, "designation": designation})
                        return out
            if name is None:
                name = _strip_possessive(_clean(rest))
            out.update({"company": company, "name": name, "designation": designation})
            return out

    for verb in (" promoted to ", " elevated to ", " elevated as "):
        if verb in low:
            i = low.find(verb)
            left = _clean(t[:i])
            name = _strip_possessive(left)
            rhs = t[i + len(verb):].strip()
            rl = rhs.lower()
            if " at " in rl:
                k = rl.find(" at ")
                out["designation"] = _clean(rhs[:k])
                out["company"] = _clean(rhs[k + 4:])
                out["name"] = name
                return out
            if " of " in rl:
                k = rl.rfind(" of ")
                out["designation"] = _clean(rhs[:k])
                out["company"] = _clean(rhs[k + 4:])
                out["name"] = name
                return out
            # fallback split
            out["designation"] = _clean(rhs)
            out["name"] = name
            return out

    if " at " in low:
        i = low.find(" at ")
        out["name"] = _strip_possessive(_clean(t[:i]))
        out["company"] = _clean(t[i + 4:])
        return out

    out["name"] = _strip_possessive(_clean(t))
    return out


# ---------- LLM fallback (only if needed) ----------
_LLM_SYS = (
    "Extract name, company, and designation from a single news headline about a people movement. "
    "Return STRICT JSON with keys exactly: name, company, designation."
)
_LLM_SHOTS = [
    {"in": "Abraham Thomas appointed as Radio City's Chief Executive Officer",
     "out": {"name": "Abraham Thomas", "company": "Radio City", "designation": "Chief Executive Officer"}},
    {"in": "Jean Laurent Poitou appointed global Chief Executive Officer of Ipsos",
     "out": {"name": "Jean Laurent Poitou", "company": "Ipsos", "designation": "Global Chief Executive Officer"}},
    {"in": "Goldee Patnaik takes charge as Head of PR at OPPO India",
     "out": {"name": "Goldee Patnaik", "company": "OPPO India", "designation": "Head of PR"}},
    {"in": "Gautam Jain to lead content at Sony SAB",
     "out": {"name": "Gautam Jain", "company": "Sony SAB", "designation": "Lead, Content"}},
    {"in": "Anand Sreenivasan to head Oneindia's monetisation & special projects",
     "out": {"name": "Anand Sreenivasan", "company": "Oneindia", "designation": "Head monetisation & special projects"}},
]

def _extract_json(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        s, e = text.find("{"), text.rfind("}")
        if s != -1 and e != -1 and e > s:
            return json.loads(text[s:e + 1])
    except Exception:
        return None
    return None


def _parse_people_title_llm(title: str) -> Optional[dict]:
    if not (USE_LLM and _openai_client):
        return None
    try:
        shots_text = "\n".join(
            [f"Example:\nInput: {s['in']}\nOutput: {json.dumps(s['out'])}" for s in _LLM_SHOTS]
        )
        resp = _openai_client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            messages=[
                {"role": "system", "content": _LLM_SYS + "\n" + shots_text},
                {"role": "user", "content": f"Headline: {title}\nRespond with only JSON."},
            ],
        )
        txt = resp.choices[0].message.content or ""
        data = _extract_json(txt)
        if not isinstance(data, dict):
            return None
        return {
            "name": _strip_possessive(_clean(data.get("name"))),
            "company": _clean(data.get("company")),
            "designation": _clean(data.get("designation")),
        }
    except Exception:
        return None


def _parse_people_title(title: str) -> dict:
    base = _parse_people_title_rules(title)
    if not (base.get("name") and base.get("company") and base.get("designation")):
        better = _parse_people_title_llm(title)
        if isinstance(better, dict):
            for k in ("name", "company", "designation"):
                if not base.get(k) and better.get(k):
                    base[k] = better[k]
    base["name"] = _strip_possessive(base.get("name"))
    return base


# --------------------------
# override merge helpers
# --------------------------
def _apply_flat_override(flat: "NewsFlatItem", ov) -> "NewsFlatItem":
    if not ov:
        return flat
    if flat.type == "Funding":
        flat.company   = ov.company   or flat.company
        flat.amount    = ov.amount    or flat.amount
        flat.round     = ov.round     or flat.round
        flat.investors = ov.investors or flat.investors
        flat.date      = ov.date      or flat.date
        flat.month     = ov.month     or flat.month
    else:  # People
        flat.name        = ov.name        or flat.name
        flat.company     = ov.company     or flat.company
        flat.designation = ov.designation or flat.designation
        flat.date        = ov.date        or flat.date
        flat.month       = ov.month       or flat.month
    return flat


def _apply_newsitem_override(item: "NewsItem", ov) -> "NewsItem":
    if not ov:
        return item
    if item.category == "Funding":
        item.company = ov.company or item.company
    else:
        item.person_name = ov.name or item.person_name
        item.company     = ov.company or item.company
        item.role        = ov.designation or item.role
    return item


# --------------------------
# default range helper
# --------------------------
def _apply_default_range_if_missing(
    start_dt: Optional[datetime],
    end_dt: Optional[datetime],
    days: int = 30
) -> tuple[Optional[datetime], Optional[datetime]]:
    """
    If both start_dt and end_dt are None, set a default window of the last `days` days.
    end_dt is set to tomorrow (exclusive upper bound).
    """
    if start_dt is None and end_dt is None:
        today_utc = datetime.utcnow()
        start_dt = today_utc - timedelta(days=days)
        end_dt = today_utc + timedelta(days=1)
    return start_dt, end_dt


# ---------- (robust) funding publish date ----------
def _funding_pub_dt(it: dict) -> Optional[datetime]:
    """Try hard to parse a publish date from common keys."""
    for key in ("published_at", "published", "updated", "pubDate", "date", "isoDate", "iso_date", "created", "timestamp"):
        v = it.get(key)
        if isinstance(v, datetime):
            return datetime(v.year, v.month, v.day)
        if isinstance(v, date):
            return datetime(v.year, v.month, v.day)
        if isinstance(v, str):
            try:
                d = dateparse.parse(v)
                return datetime(d.year, d.month, d.day)
            except Exception:
                continue
    return None


# --------------------------
# routes
# --------------------------
@router.get("", response_model=dict)
def list_news(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Return items for UI list.
    - People Spotting: from DB (positive-only)
    - Funding: RSS/feeds (range-aware if available)
    - Default behavior: last 30 days if no from/to are specified.
    """
    begin_funding_parse_request()

    start_dt = _parse_date_only(from_date)
    end_dt = _parse_date_only(to_date)
    if end_dt:
        end_dt = end_dt + timedelta(days=1)

    # ✅ enforce 30-day default
    start_dt, end_dt = _apply_default_range_if_missing(start_dt, end_dt, days=30)

    # Prefetch all overrides once (fast merge by URL)
    ov_map: Dict[str, object] = {o.url: o for o in list_overrides_all(db, limit=10000)}

    rows = list_recent(db, limit=20000)

    items: List[NewsItem] = []

    # ---- People Spotting (DB) ----
    for r in rows:
        if not is_positive_movement(r.title or ""):
            continue

        pub = _as_datetime(getattr(r, "published_at", None))
        cap = _as_datetime(_row_created_like(r))
        basis = pub or cap
        if basis is None:
            continue

        if start_dt and basis < start_dt:
            continue
        if end_dt and basis >= end_dt:
            continue
        if q:
            ql = q.lower()
            if ql not in (r.title or "").lower() and ql not in (r.url or "").lower():
                continue

        month_label = basis.strftime("%b %Y") if basis else None
        parsed = _parse_people_title(r.title or "")
        item = NewsItem(
            person_name=parsed.get("name"),
            role=parsed.get("designation"),
            company=parsed.get("company"),
            email=None,
            url=r.url,
            published_at=pub,
            created_at=cap,
            city=None,
            month_label=month_label,
            category="People Spotting",
            source=r.source,
        )
        ov = ov_map.get(r.url or "")
        items.append(_apply_newsitem_override(item, ov))

    # ---- Funding (feeds) ----
    if USE_FUNDING_CACHE and isinstance(FUNDING_CACHE.get("raw"), list):
        funding = FUNDING_CACHE["raw"]
    else:
        if _fetch_funding_items_range and (start_dt or end_dt):
            funding = _fetch_funding_items_range(start_dt, end_dt)
        else:
            funding = fetch_funding_items()

    for it in funding or []:
        pub_dt = _funding_pub_dt(it)

        # If we have a date, enforce the window; if no date, keep it (don't hide).
        if pub_dt:
            if start_dt and pub_dt < start_dt:
                continue
            if end_dt and pub_dt >= end_dt:
                continue

        if q:
            ql = q.lower()
            if ql not in (it.get("title") or "").lower() and ql not in (it.get("url") or "").lower():
                continue

        parsed = parse_funding_text(it.get("title") or "", (it.get("summary") or it.get("description") or ""))

        item = NewsItem(
            person_name=None,
            role=None,
            company=parsed.company or _clean(it.get("company")),
            email=None,
            url=it.get("url"),
            published_at=pub_dt,  # may be None
            created_at=None,
            city=None,
            month_label=(pub_dt.strftime("%b %Y") if pub_dt else None),
            category="Funding",
            source=it.get("source") or "yourstory",
        )
        ov = ov_map.get(it.get("url") or "")
        items.append(_apply_newsitem_override(item, ov))

    # Newest → oldest using datetime
    items.sort(key=lambda x: (x.published_at is None, x.published_at or datetime.min), reverse=True)
    stats = get_funding_parse_stats(reset=True)
    # include window for debugging
    window = {
        "from": (start_dt.date().isoformat() if start_dt else None),
        "to": ( (end_dt - timedelta(days=1)).date().isoformat() if end_dt else None ),
    }
    return {"items": [i.dict() for i in items], "fallback_used": USE_LLM, "funding_parse_stats": stats, "window": window}


@router.get("/auto_sync_status", response_model=dict)
def auto_sync_status(db: Session = Depends(get_db)):
    latest_pub = _max_col(db, "published_at")
    latest_cap = (
        _max_col(db, "captured_at")
        or _max_col(db, "created_at")
        or _max_col(db, "created")
    )
    latest = None
    lp = _as_datetime(latest_pub)
    lc = _as_datetime(latest_cap)
    if lp and lc:
        latest = max(lp, lc)
    else:
        latest = lp or lc
    total = db.query(Movement).count()
    return {
        "latest": latest.isoformat() if latest else None,
        "days_since": ((datetime.utcnow() - latest).days if latest else None),
        "total": total,
    }


@router.post("/auto_sync_now", response_model=dict)
def auto_sync_now(
    backstop_days: int = Query(14, ge=1, le=120, description="If DB is empty, look this many days back."),
    max_pages: int = Query(12, ge=1, le=40),
    start_page: int = Query(1, ge=1),
    db: Session = Depends(get_db),
):
    """
    Catch-up sync: find the newest saved item and fetch anything newer-or-close.
    - If DB empty, goes back `backstop_days`.
    - Always de-dupes by URL.
    """
    latest_pub = _max_col(db, "published_at")
    latest_cap = (
        _max_col(db, "captured_at")
        or _max_col(db, "created_at")
        or _max_col(db, "created")
    )
    latest = None
    lp = _as_datetime(latest_pub)
    lc = _as_datetime(latest_cap)
    if lp and lc:
        latest = max(lp, lc)
    else:
        latest = lp or lc

    cutoff = latest or (datetime.utcnow() - timedelta(days=backstop_days))

    scraped = scrape_paginated(
        start_page=start_page,
        max_pages=max_pages,
        stop_before=(cutoff - timedelta(days=1)),
    )
    fetched = len(scraped)

    added = 0
    considered = 0
    for it in scraped:
        dt = _as_datetime(it.get("published_at"))
        if dt is None or dt >= (cutoff - timedelta(days=1)):
            considered += 1
            if not get_by_url(db, it["url"]):
                create(db, title=it["title"], url=it["url"], source="afaqs", published_at=dt)
                added += 1

    total = db.query(Movement).count()
    return {
        "latest_before": latest.isoformat() if latest else None,
        "cutoff_used": cutoff.isoformat(),
        "fetched": fetched,
        "considered": considered,
        "added": added,
        "total": total,
    }


@router.get("/sync", response_model=dict)
def sync_news(
    days: int = Query(7, description="How many days back to fetch (approx)"),
    max_pages: int = Query(8, description="Max listing pages to scan"),
    start_page: int = Query(1, description="Start from this page number"),
    db: Session = Depends(get_db),
):
    """Legacy manual sync (still available if you keep the button)."""
    cutoff = datetime.utcnow() - timedelta(days=max(1, days))
    scraped = scrape_paginated(start_page=start_page, max_pages=max_pages, stop_before=cutoff)
    fetched = len(scraped)

    added = 0
    for it in scraped:
        dt = _as_datetime(it.get("published_at"))
        if dt and dt < cutoff:
            continue
        if get_by_url(db, it["url"]):
            continue
        create(db, title=it["title"], url=it["url"], source="afaqs", published_at=dt)
        added += 1

    total = db.query(Movement).count()
    return {
        "fetched": fetched,
        "added": added,
        "total": total,
        "scanned_pages": max_pages,
        "cutoff": cutoff.isoformat(),
    }


@router.get("/sync_all", response_model=dict)
def sync_all(
    start_page: int = Query(1, description="First listing page to scan"),
    max_pages: int = Query(400, ge=1, le=5000, description="How many listing pages to scan"),
    db: Session = Depends(get_db),
):
    """
    Fetch & store positive People-Spotting items across many pages (oldest→newest order not guaranteed by source).
    Skips duplicates by URL.
    """
    scraped = scrape_paginated(start_page=start_page, max_pages=max_pages)
    fetched = len(scraped)

    added = 0
    for it in scraped:
        if get_by_url(db, it["url"]):
            continue
        create(db, title=it["title"], url=it["url"], source="afaqs", published_at=_as_datetime(it.get("published_at")))
        added += 1

    total = db.query(Movement).count()
    return {
        "fetched": fetched,
        "added": added,
        "total": total,
        "start_page": start_page,
        "scanned_pages": max_pages,
    }


@router.get("/sync_range", response_model=dict)
def sync_range(
    from_date: str = Query(..., alias="from", description="yyyy-mm-dd"),
    to_date: Optional[str] = Query(None, alias="to", description="yyyy-mm-dd (inclusive)"),
    max_pages: int = Query(600, description="Max pages to scan"),
    start_page: int = Query(1, description="Start page number"),
    db: Session = Depends(get_db),
):
    """Backfill a historical date range (inclusive) for People Spotting."""
    try:
        start_dt = dateparse.parse(from_date)
        end_dt = dateparse.parse(to_date) if to_date else datetime.utcnow()
        end_dt = datetime(end_dt.year, end_dt.month, end_dt.day) + timedelta(days=1)  # inclusive
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid from/to date")

    scraped = scrape_paginated(
        start_page=start_page,
        max_pages=max_pages,
        stop_before=start_dt,  # crawl until we hit items older than the start date
    )
    fetched = len(scraped)

    added = 0
    kept = 0
    for it in scraped:
        dt = _as_datetime(it.get("published_at"))
        if dt and not (start_dt <= dt < end_dt):
            continue

        kept += 1
        if get_by_url(db, it["url"]):
            continue
        create(db, title=it["title"], url=it["url"], source="afaqs", published_at=dt)
        added += 1

    total = db.query(Movement).count()
    return {
        "fetched": fetched,
        "added": added,
        "considered": kept,
        "total": total,
        "from": from_date,
        "to": to_date,
        "scanned_pages": max_pages,
    }


@router.get("/outreach", response_model=dict)
def outreach_stub(
    days: int = 7,
    fake: int = 1,
    dry: int = 1,
    any: int = 1,
    limit: int = 25,
):
    return {
        "processed": 0,
        "emailed": 0,
        "awaiting_apollo": 0,
        "enriched_no_email": 0,
        "days": days,
        "fake": bool(fake),
        "dry": bool(dry),
        "include_all": bool(any),
        "limit": limit,
        "drafts": [],
        "message": "Outreach endpoint is a stub in this starter backend.",
    }


@router.get("/table", response_model=dict)
def get_news_table(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Flat table for the UI (Company, Name, Date, Month, Designation, Type, Link).
    Combines People-Spotting (DB) + Funding (feeds).
    Default behavior: last 30 days if no from/to are specified.
    """
    begin_funding_parse_request()

    start_dt = _parse_date_only(from_date)
    end_dt = _parse_date_only(to_date)
    if end_dt:
        end_dt = end_dt + timedelta(days=1)

    # ✅ enforce 30-day default on the server
    start_dt, end_dt = _apply_default_range_if_missing(start_dt, end_dt, days=30)

    # Prefetch all overrides once (fast merge by URL)
    ov_map: Dict[str, object] = {o.url: o for o in list_overrides_all(db, limit=10000)}

    # We'll collect tuples of (basis_dt, row) so we can sort by real datetime at the end
    table_with_keys: List[Tuple[Optional[datetime], NewsFlatItem]] = []

    # ---- People Spotting (DB) ----
    rows = list_recent(db, limit=20000)
    for r in rows:
        if not is_positive_movement(r.title or ""):
            continue

        pub = _as_datetime(getattr(r, "published_at", None))
        cap = _as_datetime(_row_created_like(r))
        basis = pub or cap
        if basis is None:
            continue

        if start_dt and basis < start_dt:
            continue
        if end_dt and basis >= end_dt:
            continue
        if q:
            ql = q.lower()
            if ql not in (r.title or "").lower() and ql not in (r.url or "").lower():
                continue

        parsed = _parse_people_title(r.title or "")
        row = NewsFlatItem(
            company=parsed.get("company"),
            industry=None,
            promoting=None,
            name=parsed.get("name"),
            designation=parsed.get("designation"),
            email=None,
            link=r.url,
            date=_format_day_mon_year(basis),
            location=None,
            created_by=None,
            ambassador_featuring=parsed.get("ambassador_featuring"),
            month=basis.strftime("%B"),
            type="In the News",
        )
        ov = ov_map.get(r.url or "")
        row = _apply_flat_override(row, ov)
        table_with_keys.append((basis, row))

    # ---- Funding (feeds) ----
    if USE_FUNDING_CACHE and isinstance(FUNDING_CACHE.get("raw"), list):
        funding = FUNDING_CACHE["raw"]
    else:
        if _fetch_funding_items_range and (start_dt or end_dt):
            funding = _fetch_funding_items_range(start_dt, end_dt)
        else:
            funding = fetch_funding_items()

    for it in funding or []:
        pub_dt = _funding_pub_dt(it)

        if pub_dt:
            if start_dt and pub_dt < start_dt:
                continue
            if end_dt and pub_dt >= end_dt:
                continue
        # If no date found, we keep it (so Funding isn't empty)

        if q:
            ql = q.lower()
            if ql not in (it.get("title") or "").lower() and ql not in (it.get("url") or "").lower():
                continue

        parsed = parse_funding_text(
            it.get("title") or "",
            (it.get("summary") or it.get("description") or "")
        )

        row = NewsFlatItem(
            company=parsed.company or _clean(it.get("company")),
            industry=None,
            promoting=None,
            name=None,
            designation=None,
            email=None,
            link=it.get("url"),
            date=_format_day_mon_year(pub_dt) if pub_dt else None,
            location=None,
            created_by=None,
            ambassador_featuring=None,
            month=(pub_dt.strftime("%B") if pub_dt else None),
            type="Funding",
            amount=parsed.amount,
            round=parsed.round,
            investors=parsed.investors,
        )
        ov = ov_map.get(it.get("url") or "")
        row = _apply_flat_override(row, ov)
        table_with_keys.append((pub_dt, row))

    # Newest → oldest using proper datetime key (undated items go last)
    table_with_keys.sort(key=lambda t: (t[0] is None, t[0] or datetime.min), reverse=True)
    out = [row for _, row in table_with_keys]

    stats = get_funding_parse_stats(reset=True)
    window = {
        "from": (start_dt.date().isoformat() if start_dt else None),
        "to": ( (end_dt - timedelta(days=1)).date().isoformat() if end_dt else None ),
    }
    return {"items": [i.dict() for i in out], "funding_parse_stats": stats, "window": window}


@router.post("/purge_negatives", response_model=dict)
def purge_negatives(db: Session = Depends(get_db)):
    """One-time clean-up for any previously saved negative/exit items."""
    rows = db.query(Movement).all()
    removed = 0
    for r in rows:
        if not is_positive_movement(r.title or ""):
            db.delete(r)
            removed += 1
    db.commit()
    return {"removed": removed}


# --------------------------
# Background loops (funding + people)
# --------------------------
def _seconds_until_next_monday(hour: int, minute: int) -> float:
    now = datetime.utcnow()
    days_ahead = (0 - now.weekday()) % 7
    target = datetime(now.year, now.month, now.day, hour, minute)
    if days_ahead == 0 and target <= now:
        days_ahead = 7
    if days_ahead > 0:
        target = target + timedelta(days=days_ahead)
    return max(1.0, (target - now).total_seconds())


async def _rebuild_funding_cache() -> None:
    """
    Rebuilds the raw funding cache for the last 30 days (UTC).
    We don't parse here; the endpoints will parse + filter as usual.
    """
    if not USE_FUNDING_CACHE:
        return
    try:
        start_dt = datetime.utcnow() - timedelta(days=30)
        end_dt   = datetime.utcnow() + timedelta(days=1)
        if _fetch_funding_items_range:
            raw = _fetch_funding_items_range(start_dt, end_dt)
        else:
            raw = fetch_funding_items()
        FUNDING_CACHE["raw"] = raw or []
        FUNDING_CACHE["built_at"] = datetime.utcnow()
        logger.info("[news] funding_cache: rebuilt items=%s", len(FUNDING_CACHE["raw"]))
    except Exception:
        logger.exception("[news] funding_cache: rebuild failed")


async def _funding_refresh_loop() -> None:
    """
    Runs forever: waits until the next Monday hh:mm UTC, rebuilds, repeats weekly.
    Optionally warms the cache at startup if FUNDING_CACHE_WARM_ON_START=1.
    """
    if FUNDING_CACHE_WARM_ON_START:
        await _rebuild_funding_cache()

    while True:
        try:
            to_sleep = _seconds_until_next_monday(FUNDING_CACHE_UTC_HOUR, FUNDING_CACHE_UTC_MIN)
            await asyncio.sleep(to_sleep)
            await _rebuild_funding_cache()
        except asyncio.CancelledError:
            logger.info("[news] funding_cache: background loop cancelled")
            return
        except Exception:
            logger.exception("[news] funding_cache: loop error, continuing...")


async def start_funding_refresh_background(launch_now: bool = False) -> None:
    """
    Called from main.py on startup to launch the Monday auto-refresh loop.
    Safe to call multiple times (noop if already started).

    launch_now=False -> do NOT rebuild immediately (prevents surprise work on cold-start).
    Set FUNDING_CACHE_WARM_ON_START=1 env if you want a warm cache on boot.
    """
    if not USE_FUNDING_CACHE:
        logger.info("[news] funding_cache: disabled by env")
        return
    global _funding_task
    if _funding_task and not _funding_task.done():
        return
    _funding_task = asyncio.create_task(_funding_refresh_loop())
    logger.info(
        "[news] funding_cache: loop started (Mon %02d:%02d UTC) warm_on_start=%s",
        FUNDING_CACHE_UTC_HOUR, FUNDING_CACHE_UTC_MIN, FUNDING_CACHE_WARM_ON_START
    )
    # Optional explicit warm trigger
    if launch_now and not FUNDING_CACHE_WARM_ON_START:
        await _rebuild_funding_cache()


async def stop_funding_refresh_background() -> None:
    """Cancel and await the background task on shutdown to avoid CancelledError surfacing."""
    global _funding_task
    if _funding_task:
        _funding_task.cancel()
        try:
            await _funding_task
        except asyncio.CancelledError:
            pass
        _funding_task = None


async def _people_refresh_loop() -> None:
    assert SessionLocal is not None, "SessionLocal not available to run people sync loop."
    if PEOPLE_BACKFILL_ON_START:
        try:
            db = SessionLocal()
            now = datetime.utcnow()
            start_dt = now - timedelta(days=PEOPLE_BACKFILL_DAYS)
            scraped = scrape_paginated(start_page=1, max_pages=PEOPLE_BACKFILL_MAX_PAGES, stop_before=start_dt)
            added = 0
            for it in scraped:
                dt = _as_datetime(it.get("published_at"))
                if dt and not (start_dt <= dt < now + timedelta(days=1)):
                    continue
                if not get_by_url(db, it["url"]):
                    create(db, title=it["title"], url=it["url"], source="afaqs", published_at=dt)
                    added += 1
            db.commit()
            db.close()
            logger.info("[news] people backfill on start done (added=%s)", added)
        except Exception:
            logger.exception("[news] people backfill on start failed")

    while True:
        try:
            await asyncio.sleep(max(5, PEOPLE_SYNC_INTERVAL_MIN * 60))
            db = SessionLocal()
            # one-shot catch-up sync
            latest_pub = _max_col(db, "published_at")
            latest_cap = (
                _max_col(db, "captured_at")
                or _max_col(db, "created_at")
                or _max_col(db, "created")
            )
            latest = None
            lp = _as_datetime(latest_pub)
            lc = _as_datetime(latest_cap)
            if lp and lc:
                latest = max(lp, lc)
            else:
                latest = lp or lc
            cutoff = latest or (datetime.utcnow() - timedelta(days=PEOPLE_SYNC_BACKSTOP_DAYS))
            scraped = scrape_paginated(start_page=1, max_pages=12, stop_before=(cutoff - timedelta(days=1)))
            added = 0
            for it in scraped:
                dt = _as_datetime(it.get("published_at"))
                if dt is None or dt >= (cutoff - timedelta(days=1)):
                    if not get_by_url(db, it["url"]):
                        create(db, title=it["title"], url=it["url"], source="afaqs", published_at=dt)
                        added += 1
            db.commit()
            db.close()
            logger.info("[news] people auto-sync added=%s", added)
        except asyncio.CancelledError:
            logger.info("[news] people auto-sync loop cancelled")
            return
        except Exception:
            logger.exception("[news] people auto-sync loop error, continuing...")


async def start_people_refresh_background() -> None:
    if not PEOPLE_SYNC_ENABLED:
        logger.info("[news] people auto-sync disabled by env")
        return
    if SessionLocal is None:
        logger.warning("[news] cannot start people auto-sync: SessionLocal missing")
        return
    global _people_task
    if _people_task and not _people_task.done():
        return
    _people_task = asyncio.create_task(_people_refresh_loop())
    logger.info("[news] people auto-sync started (every %d min)", PEOPLE_SYNC_INTERVAL_MIN)


async def stop_people_refresh_background() -> None:
    global _people_task
    if _people_task:
        _people_task.cancel()
        try:
            await _people_task
        except asyncio.CancelledError:
            pass
        _people_task = None
