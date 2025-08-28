from sqlalchemy.engine import Engine
from app.models.base import Base


def _import_models() -> None:
    # Ensure all models are imported before create_all
    import app.models.movement           # noqa: F401
    import app.models.title_cache        # noqa: F401
    import app.models.contact            # noqa: F401
    import app.models.company            # noqa: F401
    import app.models.interaction        # noqa: F401
    import app.models.override           # noqa: F401  # <-- make sure Override is imported


def create_all(engine: Engine) -> None:
    _import_models()
    Base.metadata.create_all(bind=engine)
