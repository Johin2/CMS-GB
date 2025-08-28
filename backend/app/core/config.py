# backend/app/core/config.py
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ---- Core ----
    PROJECT_NAME: str = "News API"
    ENV: str = "dev"
    DEBUG: bool = False

    # ---- Database / CORS ----
    # Use a SYNC sqlite URL (e.g. sqlite:///./data/app.sqlite3)
    DATABASE_URL: str = "sqlite:///./data/app.sqlite3"
    # Comma-separated allowed origins
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # ---- Scraper defaults ----
    AFAQS_BASE: str = "https://www.afaqs.com"
    USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124 Safari/537.36"
    )
    INCLUDE_ALL_PEOPLE_SPOTTING: bool = True

    # Optional HTTP fine-tuning (used by scraper)
    AFAQS_CONNECT_TIMEOUT: int = 6
    AFAQS_READ_TIMEOUT: int = 20
    AFAQS_POLITE_DELAY: float = 0.25
    AFAQS_JITTER_MAX: float = 0.35

    # ---- LLM / OpenAI toggles ----
    # Use either this pair…
    NEWS_USE_LLM: bool = False
    NEWS_LLM_MODEL: str = "gpt-4o-mini"

    # …or these (if you prefer the names used elsewhere)
    NEWS_PARSE_WITH_LLM: bool = True
    NEWS_PARSE_MODEL: str = "gpt-4.1-mini"

    OPENAI_API_KEY: str = ""

    # ---- Extra keys found in your .env (to prevent 'extra_forbidden') ----
    APOLLO_API_KEY: str | None = None
    RESEND_API_KEY: str | None = None
    RESEND_FROM: str | None = None
    NEWS_API_KEY: str | None = None
    NEWS_OUTREACH_TEST_EMAIL: str | None = None
    NEWS_PARSE_MODEL_FALLBACK: str | None = None

    # pydantic-settings v2 config
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,   # allows APOLLO_API_KEY or apollo_api_key
        extra="ignore",         # <-- IMPORTANT: ignore unknown env vars
    )

    # Convenience: parse CORS list
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


# singleton (import this everywhere)
settings = get_settings()
