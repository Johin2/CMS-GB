from fastapi import APIRouter, Query
import requests
from bs4 import BeautifulSoup

from app.core.config import settings
from app.services.scraper.afaqs import DEFAULT_HEADERS, _is_article_href

router = APIRouter()

@router.get("/afaqs", response_model=dict)
def debug_afaqs(page: int = Query(1, ge=1)):
    """
    Probe showing People-Spotting anchors + whether we'll keep them.
    """
    url = f"{settings.AFAQS_BASE}/people-spotting?page={page}"
    r = requests.get(url, headers=DEFAULT_HEADERS, timeout=30)
    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select(
        "a[href^='/people-spotting/'], h2 a[href^='/people-spotting/'], h3 a[href^='/people-spotting/']"
    )

    rows = []
    seen = set()
    for a in anchors:
        href = (a.get("href") or "").strip()
        title = (a.get_text(strip=True) or a.get("title") or "").strip()
        if not title:
            parent = a.parent
            h = (parent.find("h2") or parent.find("h3")) if parent else None
            if h:
                title = h.get_text(strip=True)
        key = (href, title)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "href": href,
            "title": title,
            "article_like": _is_article_href(href),
            "kept": bool(_is_article_href(href)),
        })
        if len(rows) >= 25:
            break

    return {
        "status_code": r.status_code,
        "page": page,
        "url": url,
        "html_len": len(html),
        "candidates": rows,
    }
