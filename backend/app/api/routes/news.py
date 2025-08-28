from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional, Callable, Dict, Tuple
import json
import os
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from dateutil import parser as dateparse
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session

from app.db.session import get_db
# Optional: direct session maker for background jobs
try:
    from app.db.session import SessionLocal  # typical FastAPI pattern
except Exception:
    SessionLocal = None  # pragma: no cover

from app.models.movement import Movement
from app.schemas.news import NewsItem, NewsFlatItem
from app.crud.movement import get_by_url, create, list_recent

# Manual overrides (user edits)
from app.crud.override import (
    get_by_url as get_override_by_url,  # kept for compatibility (unused now)
    list_all as list_overrides_all,     # used to prefetch all overrides (faster)
)

# People-spotting utilities
from app.services.scraper.afaqs import scrape_paginated, is_positive_movement

# Funding (RSS) utilities
from app.services.scraper.funding_rss import fetch_funding_items
# LLM/rules funding parser + stats hooks
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
# Warm the cache on boot so Funding rows appear immediately after deploy
FUNDING_CACHE_WARM_ON_START = str(os.getenv("FUNDING_CACHE_WARM_ON_START", "1")).lower() in {"1", "true", "yes", "on"}
# Monday refresh time (UTC)
FUNDING_CACHE_UTC_HOUR = int(os.getenv("FUNDING_CACHE_UTC_HOUR", "6"))     # 06:00 UTC
FUNDING_CACHE_UTC_MIN  = int(os.getenv("FUNDING_CACHE_UTC_MINUTE", "0"))

# Cache stores raw feed items (so endpoints can still apply their own filters)
FUNDING_CACHE: dict = {"raw": None, "built_at": None}  # type: ignore[assignment]
_funding_task: Optional[asyncio.Task] = None

# =======================
# People hourly sync loop
# =======================
PEOPLE_SYNC_ENABLED = str(os.getenv("PEOPLE_SYNC_ENABLED", "1")).lower() in {"1", "true", "yes", "on"}
PEOPLE_SYNC_INTERVAL_MIN = int(os.getenv("PEOPLE_SYNC_INTERVAL_MIN", "60"))  # every hour
PEOPLE_SYNC_BACKSTOP_DAYS = int(os.getenv("PEOPLE_SYNC_BACKSTOP_DAYS", "30"))

# One-time backfill on boot: make sure we have last N days in DB
PEOPLE_BACKFILL_ON_START = str(os.getenv("PEOPLE_BACKFILL_ON_START", "1")).lower() in {"1", "true", "yes", "on"}
PEOPLE_BACKFILL_DAYS = int(os.getenv("PEOPLE_BACKFILL_DAYS", "30"))
PEOPLE_BACKFILL_MAX_PAGES = int(os.getenv("PEOPLE_BACKFILL_MAX_PAGES", "600"))

_people_task: Optional[asyncio.Task] = None

# =======================
# helpers: date/clean
# =======================
def _seconds_until_next_monday(hour: int, minute: int) -> float:
    now = datetime.utcnow()
    # Monday is 0
    days_ahead = (0 - now.weekday()) % 7
    target = datetime(now.year, now.month, now.day, hour, minute)
    if days_ahead == 0 and target <= now:
        days_ahead = 7
    if days_ahead > 0:
        target = target + timedelta(days=days_ahead)
    return max(1.0, (target - now).total_seconds())


async def _rebuild_funding_cache() -> None:
    """Rebuild raw funding cache for the last 30 days (UTC)."""
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
    Optionally warms the cache at startup.
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
    """Launch weekly funding refresh loop."""
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
    if launch_now and not FUNDING_CACHE_WARM_ON_START:
        await _rebuild_funding_cache()


async def stop_funding_refresh_background() -> None:
    """Cancel funding loop."""
    global _funding_task
    if _funding_task:
        _funding_task.cancel()
        try:
            await _funding_task
        except asyncio.CancelledError:
            pass
        _funding_task = None

# --------------------------
# People auto-sync helpers
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
    return db.query(func.max(col)).scalar()


def _row_created_like(r) -> Optional[datetime]:
    """Prefer captured_at, else created_at, else created (whichever exists)."""
    return (
        getattr(r, "captured_at", None)
        or getattr(r, "created_at", None)
        or getattr(r, "created", None)
    )

# ---------- rules-only people-title parser (unchanged) ----------
# (… unchanged functions _strip_descriptor_prefix, _parse_people_title_rules, etc …)
# To keep the answer short, these are identical to your last message.
# ---- START of unchanged parsing helpers ----
def _strip_descriptor_prefix(s: str) -> str:
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
    # (exact same implementation as your message)
    # … SNIP …
    # For brevity, keep your existing implementation here unchanged.
    # (No functional edits in this block.)
    out = {"name": None, "company": None, "designation": None, "ambassador_featuring": None}
    # full body omitted here for compactness — keep your version
    return out

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

def _parse_date_only(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = dateparse.parse(s)
        return datetime(d.year, d.month, d.day)
    except Exception:
        return None
# ---- END of unchanged parsing helpers ----

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
# DB window query for People
# --------------------------
def _people_rows_in_window(db: Session, start_dt: Optional[datetime], end_dt: Optional[datetime], limit: int = 20000):
    """
    Fetch People rows whose published_at/captured_at/created_at/created fall within [start_dt, end_dt).
    This avoids list_recent() limiting the window to ~10 days.
    """
    q = db.query(Movement)
    conds = []

    def _rng(col):
        parts = []
        if start_dt is not None:
            parts.append(col >= start_dt)
        if end_dt is not None:
            parts.append(col < end_dt)
        return and_(*parts) if parts else None

    for col_name in ("published_at", "captured_at", "created_at", "created"):
        col = getattr(Movement, col_name, None)
        if col is not None:
            rc = _rng(col)
            if rc is not None:
                conds.append(rc)

    if conds:
        q = q.filter(or_(*conds))

    # Large limit; final filtering/sorting happens later anyway
    return q.limit(limit).all()

# --------------------------
# auto-sync core + loops
# --------------------------
def _latest_basis_datetime(db: Session) -> Optional[datetime]:
    """Newest of published_at vs (captured_at/created_at/created)."""
    latest_pub = _max_col(db, "published_at")
    latest_cap = (
        _max_col(db, "captured_at")
        or _max_col(db, "created_at")
        or _max_col(db, "created")
    )
    lp = _as_datetime(latest_pub)
    lc = _as_datetime(latest_cap)
    if lp and lc:
        return max(lp, lc)
    return lp or lc

def _auto_sync_once(db: Session, backstop_days: int = 14, max_pages: int = 12, start_page: int = 1) -> dict:
    """
    The same logic used by the /auto_sync_now route, factored so the background loop can reuse it.
    """
    latest = _latest_basis_datetime(db)
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

def _sync_range_core(db: Session, start_dt: datetime, end_dt: datetime, max_pages: int = 600, start_page: int = 1) -> dict:
    """Internal version of /sync_range used for one-time backfill."""
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
    return {"fetched": fetched, "added": added, "considered": kept, "total": total}

async def _people_refresh_loop() -> None:
    """Run auto-sync every N minutes."""
    assert SessionLocal is not None, "SessionLocal not available to run people sync loop."
    # quick warm-up: if DB is thin, backfill last N days once
    if PEOPLE_BACKFILL_ON_START:
        try:
            db = SessionLocal()
            now = datetime.utcnow()
            start_dt = now - timedelta(days=PEOPLE_BACKFILL_DAYS)
            await asyncio.to_thread(_sync_range_core, db, start_dt, now + timedelta(days=1), PEOPLE_BACKFILL_MAX_PAGES, 1)
            db.close()
            logger.info("[news] people backfill on start done (days=%s)", PEOPLE_BACKFILL_DAYS)
        except Exception:
            logger.exception("[news] people backfill on start failed")

    while True:
        try:
            await asyncio.sleep(max(5, PEOPLE_SYNC_INTERVAL_MIN * 60))
            db = SessionLocal()
            res = await asyncio.to_thread(_auto_sync_once, db, PEOPLE_SYNC_BACKSTOP_DAYS, 12, 1)
            db.close()
            logger.info("[news] people auto-sync: %s", res)
        except asyncio.CancelledError:
            logger.info("[news] people auto-sync loop cancelled")
            return
        except Exception:
            logger.exception("[news] people auto-sync loop error, continuing...")

async def start_people_refresh_background() -> None:
    """Launch hourly people sync loop if enabled."""
    if not PEOPLE_SYNC_ENABLED:
        logger.info("[news] people auto-sync disabled by env")
        return
    if SessionLocal is None:  # safety
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

    # Prefetch overrides once
    ov_map: Dict[str, object] = {o.url: o for o in list_overrides_all(db, limit=10000)}

    # ---- People Spotting (DB) ----
    rows = _people_rows_in_window(db, start_dt, end_dt, limit=20000)

    items: List[NewsItem] = []
    for r in rows:
        if not is_positive_movement(r.title or ""):
            continue

        pub = _as_datetime(getattr(r, "published_at", None))
        cap = _as_datetime(_row_created_like(r))
        basis = pub or cap
        if basis is None:
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
    funding = None
    if USE_FUNDING_CACHE and isinstance(FUNDING_CACHE.get("raw"), list):
        funding = FUNDING_CACHE["raw"]
    else:
        if _fetch_funding_items_range and (start_dt or end_dt):
            funding = _fetch_funding_items_range(start_dt, end_dt)
        else:
            funding = fetch_funding_items()

    for it in funding or []:
        pub_d = _as_date(it.get("published_at"))
        pub_dt = _as_datetime(pub_d) if pub_d else None

        if pub_dt:
            if start_dt and pub_dt < start_dt:
                continue
            if end_dt and pub_dt >= end_dt:
                continue
        else:
            if start_dt or end_dt:
                continue

        if q:
            ql = q.lower()
            if ql not in (it.get("title") or "").lower() and ql not in (it.get("url") or "").lower():
                continue

        parsed = parse_funding_text(it.get("title") or "", (it.get("summary") or it.get("description") or ""))

        # 🚫 Skip digests/roundups: only add if parser found at least one meaningful field
        if not (parsed.company or parsed.amount or parsed.round or parsed.investors):
            continue

        item = NewsItem(
            person_name=None,
            role=None,
            company=parsed.company or _clean(it.get("company")),
            email=None,
            url=it.get("url"),
            published_at=pub_dt,
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
    window = {"from": (start_dt.date().isoformat() if start_dt else None),
              "to": ((end_dt - timedelta(days=1)).date().isoformat() if end_dt else None)}
    return {"items": [i.dict() for i in items], "fallback_used": USE_LLM, "funding_parse_stats": stats, "window": window}

@router.get("/auto_sync_status", response_model=dict)
def auto_sync_status(db: Session = Depends(get_db)):
    latest = _latest_basis_datetime(db)
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
    """Run one sync iteration now."""
    return _auto_sync_once(db, backstop_days=backstop_days, max_pages=max_pages, start_page=start_page)

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
    return {"fetched": fetched, "added": added, "total": total, "scanned_pages": max_pages, "cutoff": cutoff.isoformat()}

@router.get("/sync_all", response_model=dict)
def sync_all(
    start_page: int = Query(1, description="First listing page to scan"),
    max_pages: int = Query(400, ge=1, le=5000, description="How many listing pages to scan"),
    db: Session = Depends(get_db),
):
    """Fetch & store positive People-Spotting items across many pages. Skips duplicates by URL."""
    scraped = scrape_paginated(start_page=start_page, max_pages=max_pages)
    fetched = len(scraped)

    added = 0
    for it in scraped:
        if get_by_url(db, it["url"]):
            continue
        create(db, title=it["title"], url=it["url"], source="afaqs", published_at=_as_datetime(it.get("published_at")))
        added += 1

    total = db.query(Movement).count()
    return {"fetched": fetched, "added": added, "total": total, "start_page": start_page, "scanned_pages": max_pages}

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

    stats = _sync_range_core(db, start_dt, end_dt, max_pages=max_pages, start_page=start_page)
    stats.update({"from": from_date, "to": to_date, "scanned_pages": max_pages})
    return stats

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

    # Prefetch overrides once (fast merge by URL)
    ov_map: Dict[str, object] = {o.url: o for o in list_overrides_all(db, limit=10000)}

    # We'll collect tuples of (basis_dt, row) so we can sort by real datetime at the end
    table_with_keys: List[Tuple[Optional[datetime], NewsFlatItem]] = []

    # ---- People Spotting (DB) ----
    rows = _people_rows_in_window(db, start_dt, end_dt, limit=20000)
    for r in rows:
        if not is_positive_movement(r.title or ""):
            continue

        pub = _as_datetime(getattr(r, "published_at", None))
        cap = _as_datetime(_row_created_like(r))
        basis = pub or cap
        if basis is None:
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
    funding = None
    if USE_FUNDING_CACHE and isinstance(FUNDING_CACHE.get("raw"), list):
        funding = FUNDING_CACHE["raw"]
    else:
        if _fetch_funding_items_range and (start_dt or end_dt):
            funding = _fetch_funding_items_range(start_dt, end_dt)
        else:
            funding = fetch_funding_items()

    for it in funding or []:
        pub_d = _as_date(it.get("published_at"))
        pub_dt = _as_datetime(pub_d) if pub_d else None

        if pub_dt:
            if start_dt and pub_dt < start_dt:
                continue
            if end_dt and pub_dt >= end_dt:
                continue
        elif (start_dt or end_dt):
            continue

        if q:
            ql = q.lower()
            if ql not in (it.get("title") or "").lower() and ql not in (it.get("url") or "").lower():
                continue

        parsed = parse_funding_text(
            it.get("title") or "",
            (it.get("summary") or it.get("description") or "")
        )

        # 🚫 Skip digests/roundups: only add if parser found at least one meaningful field
        if not (parsed.company or parsed.amount or parsed.round or parsed.investors):
            continue

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

    # Newest → oldest using proper datetime key
    table_with_keys.sort(key=lambda t: (t[0] is None, t[0] or datetime.min), reverse=True)
    out = [row for _, row in table_with_keys]

    stats = get_funding_parse_stats(reset=True)
    window = {"from": (start_dt.date().isoformat() if start_dt else None),
              "to": ((end_dt - timedelta(days=1)).date().isoformat() if end_dt else None)}
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
