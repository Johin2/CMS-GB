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
    import feedparser  # type: ignore
except Exception:
    feedparser = None

_DEFAULT_FEEDS = [
    "https://yourstory.com/category/funding/feed",
    "https://techcrunch.com/tag/funding/feed/",
    "https://inc42.com/startups/funding/feed/",
]

def _normalize_list(raw: str) -> List[str]:
    if not raw:
        return []
    # accept comma, newline, and spaces
    parts = re.split(r"[,\n\r\s]+", raw.strip())
    out: List[str] = []
    for u in parts:
        if not u:
            continue
        u = u.strip()
        if u and u not in out:
            out.append(u)
    return out

def _env_feeds() -> List[str]:
    """
    Merge FUNDING_RSS_URLS (if present) with defaults (do NOT replace).
    Accept comma/newline/space separated lists.
    De-duplicate while preserving order.
    """
    configured = _normalize_list(os.getenv("FUNDING_RSS_URLS", ""))
    urls: List[str] = []
    for u in configured + _DEFAULT_FEEDS:
        if u and u not in urls:
            urls.append(u)
    return urls

def _clean_text(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    t = re.sub(r"\s+", " ", s).strip()
    return t or None

def _parse_pubdate(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        from dateutil import parser as dateparse  # type: ignore
        dt = dateparse.parse(s)
        return datetime(dt.year, dt.month, dt.day)
    except Exception:
        pass
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
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
        # prefer published/updated/created
        pub = getattr(e, "published", None) or getattr(e, "updated", None) or getattr(e, "created", None)
        pub_dt = _parse_pubdate(pub)
        out.append(
            {
                "title": title,
                "url": link,
                "summary": summ,
                "published_at": pub_dt.date() if pub_dt else None,  # date
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

    channel = root.find("channel")
    if channel is not None:
        for item in channel.findall("item"):
            title = _clean_text((item.findtext("title") or ""))
            link = _clean_text((item.findtext("link") or "")) or _clean_text((item.findtext("guid") or ""))
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

def _is_funding_feed(url: str) -> bool:
    u = url.lower()
    return any(k in u for k in ["tag/funding", "/funding/", "/fundings/", "/category/funding"])

def _likely_funding(title: Optional[str], summary: Optional[str]) -> bool:
    txt = f"{title or ''} {summary or ''}".lower()
    keywords = [
        # very common
        "raises", "raised", "raise", "secures", "secured", "bags", "lands", "closes",
        "funding", "fundraise", "fund-raise", "investment round", "financing",
        "led by", "co-led", "participation from",
        # rounds
        "seed round", "pre-seed", "angel round", "series a", "series b", "series c",
        "series d", "series e", "series f", "pre-series", "bridge round",
        "venture debt", "debt round",
        # misc verbs seen in headlines
        "snags", "obtains", "picks up", "rakes in", "attracts", "backs",
    ]
    return any(k in txt for k in keywords)

def _hostname(url: str) -> str:
    m = re.match(r"^(?:https?://)?([^/]+)", url.strip(), flags=re.IGNORECASE)
    return (m.group(1) if m else url).lower()

def fetch_funding_items() -> List[Dict]:
    """
    Return items: {title, url, summary, published_at (date), source}
    We trust funding-tag/section feeds and include all their items.
    For other feeds we keep only items that look like funding news.
    """
    items: List[Dict] = []
    urls = _env_feeds()

    for url in urls:
        source_name = _hostname(url)
        try:
            chunk = _items_from_feedparser(url, source_name) if feedparser is not None else _items_from_xml(url, source_name)
        except Exception:
            chunk = []

        trust = _is_funding_feed(url)
        for it in chunk:
            if trust or _likely_funding(it.get("title"), it.get("summary")):
                items.append(it)

    # De-dupe by URL, keep latest occurrence
    seen: Dict[str, Dict] = {}
    for it in items:
        u = it.get("url") or ""
        if not u:
            continue
        seen[u] = it
    return list(seen.values())
