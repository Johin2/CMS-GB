from sqlalchemy.engine import Engine
from app.models.base import Base


def _import_models() -> None:
    """Import all models so their metadata is registered on Base."""
    import app.models.movement           # noqa: F401
    import app.models.title_cache        # noqa: F401
    import app.models.contact            # noqa: F401
    import app.models.company            # noqa: F401
    import app.models.interaction        # noqa: F401
    import app.models.override           # noqa: F401


def create_all(engine: Engine) -> None:
    """Create all tables for the registered models (SYNC)."""
    _import_models()
    Base.metadata.create_all(bind=engine)
