"""Per-feature Lambda entry points (ADR 0002, ADR 0004, ADR 0009).

Six Lambda functions share this one module and this one deployment package -
each AWS Lambda function config just points its `Handler` setting at a
different name below. Every handler wraps a *slim* FastAPI app that mounts
only its own feature's router, so the six functions genuinely run different
code paths rather than the same monolith six times over.

`main.py` (the full app, every router mounted) still exists for local
development, where one process serving everything is simpler than juggling
six. Splitting only changes the Presentation-layer entry point - every
router, service, and domain function underneath is the exact same code,
imported unchanged, which is the point of keeping business logic out of
`main.py` in the first place.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from features.academic_profile.presentation.router import router as academic_profile_router
from features.content_topics.presentation.router import router as content_topics_router
from features.progress.presentation.router import router as progress_router
from features.scheduling.presentation.router import router as scheduling_router
from features.study_groups.presentation.router import router as study_groups_router
from shared.auth.router import router as auth_router

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://d6dbklbpa5amn.cloudfront.net",
]


def _feature_app(*routers, with_health: bool = False) -> FastAPI:
    """A minimal FastAPI app mounting just the routers this Lambda owns."""
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for router in routers:
        app.include_router(router)

    if with_health:

        @app.get("/health", tags=["health"])
        def health() -> dict[str, str]:
            return {"status": "ok"}

    return app


auth_handler = Mangum(_feature_app(auth_router, with_health=True), api_gateway_base_path="/prod")
academic_profile_handler = Mangum(
    _feature_app(academic_profile_router), api_gateway_base_path="/prod"
)
content_topics_handler = Mangum(
    _feature_app(content_topics_router), api_gateway_base_path="/prod"
)
scheduling_handler = Mangum(_feature_app(scheduling_router), api_gateway_base_path="/prod")
progress_handler = Mangum(_feature_app(progress_router), api_gateway_base_path="/prod")
study_groups_handler = Mangum(_feature_app(study_groups_router), api_gateway_base_path="/prod")
