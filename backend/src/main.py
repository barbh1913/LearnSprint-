"""FastAPI entry point.

Locally every feature router is mounted on one app. In the AWS phase each
feature becomes its own Lambda behind API Gateway, reusing the same application
layer - only this file changes (ADR 0002, ADR 0004).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from features.academic_profile.presentation.router import router as academic_profile_router
from features.content_topics.presentation.router import router as content_topics_router
from features.progress.presentation.router import router as progress_router
from features.scheduling.presentation.router import router as scheduling_router
from shared.auth.router import router as auth_router

app = FastAPI(
    title="LearnSprint API",
    description="Exam-prep study planner: courses, topic extraction, mastery-weighted scheduling.",
    version="1.0.0",
)

# The Vite dev server proxies /api, but allowing its origin directly keeps
# things working if the frontend is ever served from somewhere else.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(academic_profile_router)
app.include_router(content_topics_router)
app.include_router(scheduling_router)
app.include_router(progress_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
