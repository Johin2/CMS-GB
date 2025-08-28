# backend/app/services/scraper/funding_rss.py
from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Dict, List, Optional
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
import xml.etree.ElementTree as ET

try:
    # If feedparser is available, we'll prefer it (more resilient).
    import feedparser  # type: ignore
except Exception:
    feedparser = None  # fallback to minimal XML parsing

# Default feeds (comma-separated env also supported)
# You can override with FUNDING_RSS_URLS="https://foo.com/feed,https://bar.com/feed"
_DEFAULT_FEEDS = [
    # YourStory Funding: (section feed URL can change; keep multiple candidates)
    "https://yourstory.com/category/funding/feed",
    # Add more funding-specific feeds here if you like:
    "https://techcrunch.com/tag/funding/feed/",
    "https://inc42.com/startups/funding/feed/",
]

def _env_feeds() -> List[str]:
    raw = os.getenv("FUNDING_RSS_URLS", "")
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    return urls or _DEFAULT_FEEDS

def _clean_text(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = re.sub(r"\s+", " ", s).strip()
    return t or None

def _parse_pubdate(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Try python-dateutil if present
        from dateutil import parser as dateparse  # type: ignore
        dt = dateparse.parse(s)
        return datetime(dt.year, dt.month, dt.day)
    except Exception:
        pass
    # Try a few common formats
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
            # return date-only as datetime @ 00:00 for consistency w/ UI
            return datetime(dt.year, dt.month, dt.day)
        except Exception:
            continue
    return None

def _fetch_http(url: str) -> Optional[bytes]:
    try:
        with urlopen(url, timeout=15) as resp:
            return resp.read()
    except (URLError, HTTPError, TimeoutError):
        return None

def _items_from_feedparser(url: str, source_name: str) -> List[Dict]:
    out: List[Dict] = []
    try:
        parsed = feedparser.parse(url)  # type: ignore
    except Exception:
        return out
    for e in parsed.entries or []:
        title = _clean_text(getattr(e, "title", "") or "")
        link = _clean_text(getattr(e, "link", "") or "")
        summ = _clean_text(getattr(e, "summary", "") or getattr(e, "description", "") or "")
        # Try many possible date fields
        pub = (
            getattr(e, "published", None)
            or getattr(e, "updated", None)
            or getattr(e, "created", None)
            or None
        )
        pub_dt = _parse_pubdate(pub)
        out.append(
            {
                "title": title,
                "url": link,
                "summary": summ,
                "published_at": pub_dt.date() if pub_dt else None,  # date (not datetime) for your news.py
                "source": source_name,
            }
        )
    return out

def _items_from_xml(url: str, source_name: str) -> List[Dict]:
    out: List[Dict] = []
    raw = _fetch_http(url)
    if not raw:
        return out
    try:
        root = ET.fromstring(raw)
    except Exception:
        return out

    # Try RSS 2.0
    channel = root.find("channel")
    if channel is not None:
        for item in channel.findall("item"):
            title = _clean_text((item.findtext("title") or ""))
            link = _clean_text((item.findtext("link") or ""))
            summ = _clean_text((item.findtext("description") or ""))
            pub_str = item.findtext("pubDate") or item.findtext("date") or item.findtext("updated")
            pub_dt = _parse_pubdate(pub_str)
            out.append(
                {
                    "title": title,
                    "url": link,
                    "summary": summ,
                    "published_at": pub_dt.date() if pub_dt else None,
                    "source": source_name,
                }
            )
        return out

    # Try Atom
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.findall("a:entry", ns):
        title = _clean_text(entry.findtext("a:title", default="", namespaces=ns))
        link_el = entry.find("a:link", ns)
        link = _clean_text(link_el.get("href") if link_el is not None else "")
        summ = _clean_text(entry.findtext("a:summary", default="", namespaces=ns) or entry.findtext("a:content", default="", namespaces=ns))
        pub_str = entry.findtext("a:updated", default="", namespaces=ns) or entry.findtext("a:published", default="", namespaces=ns)
        pub_dt = _parse_pubdate(pub_str)
        out.append(
            {
                "title": title,
                "url": link,
                "summary": summ,
                "published_at": pub_dt.date() if pub_dt else None,
                "source": source_name,
            }
        )
    return out

def _likely_funding(title: Optional[str], summary: Optional[str]) -> bool:
    txt = f"{title or ''} {summary or ''}".lower()
    # Heuristics to keep only funding-related items
    keywords = [
        "raises", "raised", "secures", "secured", "bags", "snags", "lands",
        "gets", "obtains", "picks up", "closes", "funding", "series a",
        "series b", "series c", "seed round", "pre-seed", "venture debt",
        "investment round", "led by",
    ]
    return any(k in txt for k in keywords)

def fetch_funding_items() -> List[Dict]:
    """
    Return a list of items shaped as:
    {
        "title": str,
        "url": str,
        "summary": Optional[str],
        "published_at": Optional[date],  # date object (NOT datetime)
        "source": str,
    }
    Only funding-like posts are kept via a simple heuristic filter.
    """
    items: List[Dict] = []
    urls = _env_feeds()

    for url in urls:
        source_name = _hostname(url)
        try:
            if feedparser is not None:
                chunk = _items_from_feedparser(url, source_name)
            else:
                chunk = _items_from_xml(url, source_name)
        except Exception:
            chunk = []

        # Keep only likely funding items
        for it in chunk:
            if _likely_funding(it.get("title"), it.get("summary")):
                items.append(it)

    # De-dupe by URL, keep latest occurrence
    seen = {}
    for it in items:
        seen[it.get("url")] = it
    return list(seen.values())

def _hostname(url: str) -> str:
    m = re.match(r"^(?:https?://)?([^/]+)", url.strip(), flags=re.IGNORECASE)
    return (m.group(1) if m else url).lower()
