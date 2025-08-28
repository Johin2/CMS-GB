import os
from asgiref.wsgi import WsgiToAsgi
from backend.main import app  # import your FastAPI app

# Convert ASGI app (FastAPI) to WSGI for PythonAnywhere
application = WsgiToAsgi(app)
