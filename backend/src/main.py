from fastapi import FastAPI

from features.academic_profile.presentation.router import (
    router as academic_profile_router,
)

app = FastAPI(title="LearnSprint API")

app.include_router(academic_profile_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
