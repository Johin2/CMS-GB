# backend/app/scheduler.py
from datetime import datetime, timedelta
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.movement import Movement
from app.services.scraper.afaqs import scrape_paginated


scheduler = BackgroundScheduler(timezone="UTC")


def _hourly_sync_job(start_page: int = 1, max_pages: int = 12, backstop_days: int = 14) -> dict:
    """
    Server-driven sync that runs hourly.
    Keeps only positive movements (scraper already filters).
    De-dupes by URL.
    """
    with SessionLocal() as db:  # type: Session
        # If DB is empty, look back `backstop_days`
        cutoff: Optional[datetime] = None
        latest_pub = db.query(Movement.published_at).order_by(Movement.published_at.desc().nullslast()).first()
        if latest_pub and latest_pub[0]:
            cutoff = latest_pub[0]
        else:
            cutoff = datetime.utcnow() - timedelta(days=backstop_days)

        scraped = scrape_paginated(start_page=start_page, max_pages=max_pages, stop_before=(cutoff - timedelta(days=1)))

        added = 0
        for it in scraped:
            if db.query(Movement).filter(Movement.url == it["url"]).first():
                continue
            db.add(Movement(
                title=it["title"],
                url=it["url"],
                source="afaqs",
                published_at=it.get("published_at"),
            ))
            added += 1
        db.commit()
        return {"fetched": len(scraped), "added": added}


def init_scheduler(app: FastAPI) -> None:
    """Attach scheduler start/stop to FastAPI lifecycle."""
    @app.on_event("startup")
    def _start_scheduler():
        # coalesce to run once if missed, and avoid overlap
        scheduler.add_job(_hourly_sync_job, "interval", hours=1, max_instances=1, coalesce=True)
        try:
            scheduler.start()
        except Exception:
            # If scheduler cannot start, keep the API running
            pass

    @app.on_event("shutdown")
    def _stop_scheduler():
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
