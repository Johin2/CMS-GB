from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional, Dict, Union
import random
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
from dateutil import parser as dateparse

# Keep import for compatibility with places that catch HTTPException
from fastapi import HTTPException
from app.core.config import settings

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DEFAULT_HEADERS = {
    "User-Agent": getattr(
        settings,
        "USER_AGENT",
        # sensible default UA
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

AFAQS_BASE = getattr(settings, "AFAQS_BASE", "https://www.afaqs.com")

CONNECT_TIMEOUT = getattr(settings, "AFAQS_CONNECT_TIMEOUT", 6)   # seconds
READ_TIMEOUT    = getattr(settings, "AFAQS_READ_TIMEOUT", 20)     # seconds
POLITE_DELAY    = getattr(settings, "AFAQS_POLITE_DELAY", 0.25)   # seconds between pages
JITTER_MAX      = getattr(settings, "AFAQS_JITTER_MAX", 0.35)     # add 0..JITTER_MAX sec jitter

# -----------------------------------------------------------------------------
# Sentiment keywords (exported)
#  - Strict positive: require a positive token and NO negative token
# -----------------------------------------------------------------------------
POSITIVE_KEYWORDS = [
    # verbs
    "promoted", "promotes", "promotion",
    "elevated", "elevates", "elevation",
    "appointed", "appoints",
    "joins as", "joins",
    "named", "names",
    "elected",
    "takes charge", "assumes role",
    "expands", "expanded", "expands role", "expanded role",
    "given additional charge", "additional responsibility", "new role",
    "to head", "to lead",

    # NEW: commonly seen verbs/phrases in your examples
    "hires", "hired", "onboards", "onboarded", "brings on", "ropes in",
    "returns to", "rejoins",

    # common role phrasing (covers headlines without an explicit verb)
    "as chief", "as ceo", "as cmo", "as cto", "as coo", "as md",
    "as cfo", "as cio", "as chro", "as president",
    "vice chair", "managing director",

    # NEW: board/advisory/ambassador signals
    "advisory board", "board of directors", "board of advisors", "advisory council",
    "brand ambassador", "ambassador",
]

NEGATIVE_KEYWORDS = [
    "resigns", "resignation", "steps down", "step down", "moves on", "quits",
    "exit", "exits", "leaves", "retire", "retires", "retirement",
    "fired", "sacked", "ousted", "removed", "demoted", "demotion",
]

# Obvious junk/section titles we never want to keep
SKIP_TITLES_EXACT = {"people spotting", "people-spotting", "people spotting"}  # NBSP variations


def is_positive_movement(text: str) -> bool:
    """
    Strict positive check:
      - If any NEGATIVE token appears → False
      - Otherwise require at least one POSITIVE token → True
      - Else False (no optimistic default)
    """
    t = (text or "").strip().lower()
    if not t:
        return False
    if t in SKIP_TITLES_EXACT:
        return False
    if any(bad in t for bad in NEGATIVE_KEYWORDS):
        return False
    return any(good in t for good in POSITIVE_KEYWORDS)

# -----------------------------------------------------------------------------
# HTTP session with retries/backoff
# -----------------------------------------------------------------------------
_session = requests.Session()
_retry = Retry(
    total=3,
    connect=3,
    read=3,
    backoff_factor=0.6,  # 0.6, 1.2, 1.8...
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=frozenset(["GET"]),
    raise_on_status=False,
)
_adapter = HTTPAdapter(max_retries=_retry)
_session.mount("https://", _adapter)
_session.mount("http://", _adapter)

def _get_html(url: str) -> Optional[str]:
    """
    Fetch URL with retries and timeouts. On failure, return None (don't raise).
    """
    try:
        resp = _session.get(
            url,
            headers=DEFAULT_HEADERS,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
        )
        if resp.status_code != 200:
            return None
        return resp.text
    except requests.exceptions.RequestException:
        return None

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _parse_date(text: str) -> Optional[date]:
    if not text:
        return None
    try:
        dt = dateparse.parse(text, fuzzy=True)
        return dt.date()
    except Exception:
        return None

def _nearby_date(node) -> Optional[date]:
    # climb a few ancestors and sniff time/small/span/p tags for a date-ish string
    hops = 0
    cur = node
    while cur is not None and hops < 4:
        t = cur.find("time")
        if t:
            d = _parse_date(t.get_text(" ", strip=True))
            if d:
                return d
        for tag in cur.find_all(["small", "span", "p"], limit=6):
            d = _parse_date(tag.get_text(" ", strip=True))
            if d:
                return d
        cur = cur.parent
        hops += 1
    return None

def _is_article_href(href: str) -> bool:
    # Real article slugs have digits (e.g., ...-9688342); category pages do not.
    if not href or "?" in href:
        return False
    if not href.startswith("/people-spotting/"):
        return False
    return any(ch.isdigit() for ch in href)

def _absolutize(h: str) -> str:
    return h if h.startswith("http") else f"{AFAQS_BASE}{h}"

# -----------------------------------------------------------------------------
# Scraping
# -----------------------------------------------------------------------------
def scrape_listing_page(page: int = 1, *, positives_only: bool = True) -> List[dict]:
    """
    Return People-Spotting article cards as:
      { "title": str, "url": str, "published_at": date|None }

    On fetch failure or non-200, returns [] instead of raising.
    """
    url = f"{AFAQS_BASE}/people-spotting?page={page}"
    html = _get_html(url)
    if not html:
        # treat as empty page (prevents API from crashing)
        return []

    soup = BeautifulSoup(html, "html.parser")

    # Be generous with selectors — pick anchors that link into /people-spotting/ slugs.
    anchors = soup.select(
        "a[href^='/people-spotting/'], h2 a[href^='/people-spotting/'], h3 a[href^='/people-spotting/']"
    )

    picked: Dict[str, dict] = {}
    for a in anchors:
        href = (a.get("href") or "").strip()
        if not _is_article_href(href):
            continue

        # title: prefer anchor text, fallback to nearby h2/h3/h4
        title = (a.get_text(strip=True) or "").strip()
        if not title:
            parent = a.parent
            htag = (parent.find("h2") or parent.find("h3") or parent.find("h4")) if parent else None
            if htag:
                title = (htag.get_text(strip=True) or "").strip()

        # Basic sanity: skip tiny/junky or the section label
        if not title or len(title) < 8 or title.strip().lower() in SKIP_TITLES_EXACT:
            continue

        if positives_only and not is_positive_movement(title):
            continue

        url_abs = _absolutize(href)
        pub = _nearby_date(a)

        prev = picked.get(url_abs)
        if prev is None or len(title) > len(prev["title"]):
            picked[url_abs] = {"title": title, "url": url_abs, "published_at": pub}

    return list(picked.values())

def scrape_paginated(
    start_page: int = 1,
    max_pages: int = 10,
    *,
    stop_before: Optional[Union[datetime, date]] = None,
    positives_only: bool = True,
    polite_delay_sec: float = POLITE_DELAY,
) -> List[dict]:
    """
    Walk listing pages and collect items (defaults to *positive* items only).

    Args:
      start_page: first listing page (1-based)
      max_pages: hard cap on pages to scan
      stop_before: if provided, skip/break once items are strictly older than this
                   (accepts datetime or date; we compare by *date*)
      positives_only: keep only positive people movements
      polite_delay_sec: sleep between pages to avoid hammering the site

    Stops when it sees two consecutive empty pages or hits the page cap.
    """
    # Normalize cutoff to a date
    cutoff: Optional[date] = None
    if isinstance(stop_before, datetime):
        cutoff = stop_before.date()
    elif isinstance(stop_before, date):
        cutoff = stop_before

    collected: List[dict] = []
    empties = 0

    for p in range(start_page, start_page + max_pages):
        items = scrape_listing_page(p, positives_only=positives_only)

        if not items:
            # If the page failed to load or was empty, try the next one but stop after 2 empties
            empties += 1
            if empties >= 2:
                break
            time.sleep(polite_delay_sec + random.uniform(0, JITTER_MAX))
            continue

        empties = 0

        # Keep only items that meet the cutoff (if any)
        if cutoff:
            filtered = [
                it for it in items
                if (it.get("published_at") is None) or (it["published_at"] >= cutoff)
            ]
        else:
            filtered = items

        collected.extend(filtered)

        # If the oldest dated item on this page is older than the cutoff, we can stop
        if cutoff:
            dated = [it["published_at"] for it in items if it.get("published_at")]
            if dated and min(dated) < cutoff:
                break

        time.sleep(polite_delay_sec + random.uniform(0, JITTER_MAX))

    return collected
