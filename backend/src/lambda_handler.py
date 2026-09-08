"""Entry point for the AWS Lambda deployment (ADR 0002, ADR 0004).

Mangum adapts API Gateway's event/response shape to the ASGI interface FastAPI
already speaks, so `main.py` and every feature module are unchanged - this file
is the only thing that exists because the app runs in Lambda instead of uvicorn.

`api_gateway_base_path` strips the API Gateway stage name ("prod") from the
path before it reaches FastAPI's router, so `/prod/health` here matches the
same `/health` route that answers locally.
"""

from mangum import Mangum

from main import app

handler = Mangum(app, api_gateway_base_path="/prod")
