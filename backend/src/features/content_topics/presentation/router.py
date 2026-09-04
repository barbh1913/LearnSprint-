"""Topic endpoints: upload and extract, then edit by hand (FR2.1, FR2.2, FR2.6)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.domain.extraction import extract_topics
from features.content_topics.infrastructure import ai_extractor
from features.content_topics.infrastructure import file_parser
from features.content_topics.infrastructure import repository
from features.progress.infrastructure import repository as progress_repo
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["content-topics"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_FILES_PER_UPLOAD = 15


class TopicCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    isPriority: bool = False


class TopicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    isPriority: bool | None = None


class TopicOut(BaseModel):
    id: str
    courseId: str
    name: str
    isPriority: bool = False


class ExtractionResult(BaseModel):
    created: list[TopicOut]
    detectedLanguage: str
    sourceFilenames: list[str]
    analysedBy: str  # "ai" or "heuristic"
    totalEstimatedMinutes: int
    note: str | None = None


@router.post(
    "/courses/{course_id}/topics/extract",
    response_model=ExtractionResult,
    status_code=status.HTTP_201_CREATED,
)
async def extract_from_files(
    course_id: str,
    files: list[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
) -> ExtractionResult:
    """Analyse a batch of course files into topics with study-time estimates.

    Accepts up to 15 PDF/PPTX files at once and treats them as one corpus, so a
    whole semester of lecture decks produces a single de-duplicated topic list
    rather than one per file.

    If the student enabled AI analysis and stored their API key, Claude reads the
    material and estimates how long each topic takes to learn. Otherwise - or if
    the AI call fails for any reason - the keyword heuristic runs instead and the
    default per-action durations apply. Either way the upload succeeds.
    """
    _require_membership(user_id, course_id)

    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=413,
            detail=f"Upload at most {MAX_FILES_PER_UPLOAD} files at a time",
        )

    lines, filenames = await _read_all(files)
    if not lines:
        raise HTTPException(status_code=422, detail="Those files had no readable text")

    ai_settings = course_repo.get_ai_settings(user_id)
    topics, analysed_by, note = _analyse(lines, ai_settings)

    if not topics:
        raise HTTPException(
            status_code=422,
            detail="No topics could be found. Try different files or add topics manually.",
        )

    created = [
        repository.create_topic(course_id, name, total_minutes=minutes)
        for name, minutes, _ in topics
    ]
    languages = {language for _, _, language in topics}

    return ExtractionResult(
        created=[_to_out(topic) for topic in created],
        # Names stay in their source language - we never translate (see CLAUDE.md).
        detectedLanguage="mixed" if len(languages) > 1 else languages.pop(),
        sourceFilenames=filenames,
        analysedBy=analysed_by,
        totalEstimatedMinutes=sum(minutes or 0 for _, minutes, _ in topics),
        note=note,
    )


async def _read_all(files: list[UploadFile]) -> tuple[list[str], list[str]]:
    """Pull the text out of every uploaded file, concatenated in upload order."""
    lines: list[str] = []
    filenames: list[str] = []

    for upload in files:
        content = await upload.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413, detail=f"{upload.filename} is larger than 20 MB"
            )

        try:
            lines.extend(file_parser.read_lines(upload.filename or "", content))
        except file_parser.UnsupportedFileType as exc:
            raise HTTPException(
                status_code=400, detail="Only PDF and PPTX files are supported"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - a corrupt upload shouldn't 500
            raise HTTPException(
                status_code=400, detail=f"Could not read {upload.filename}"
            ) from exc

        filenames.append(upload.filename or "")

    return lines, filenames


def _analyse(
    lines: list[str], ai_settings: dict[str, Any]
) -> tuple[list[tuple[str, int | None, str]], str, str | None]:
    """Run AI analysis when it's enabled, otherwise the heuristic.

    Returns (topics, which analyser ran, an optional note for the student).
    The AI path is never allowed to fail the upload.
    """
    if ai_settings.get("aiEnabled") and ai_settings.get("apiKey"):
        try:
            analysed = ai_extractor.analyse_syllabus(lines, api_key=ai_settings["apiKey"])
            return (
                [(topic.name, topic.estimated_minutes, topic.language) for topic in analysed],
                "ai",
                None,
            )
        except ai_extractor.AiAnalysisUnavailable as exc:
            note = f"AI analysis was unavailable ({exc}), so the built-in analyser ran instead."
            return _heuristic(lines) + (note,)

    return _heuristic(lines) + (None,)


def _heuristic(lines: list[str]) -> tuple[list[tuple[str, int | None, str]], str]:
    extracted = extract_topics(lines)
    return [(topic.name, None, topic.language) for topic in extracted], "heuristic"


@router.post(
    "/courses/{course_id}/topics", response_model=TopicOut, status_code=status.HTTP_201_CREATED
)
def create_topic(
    course_id: str, payload: TopicCreate, user_id: str = Depends(get_current_user_id)
) -> TopicOut:
    _require_membership(user_id, course_id)
    topic = repository.create_topic(course_id, payload.name, is_priority=payload.isPriority)
    return _to_out(topic)


@router.get("/courses/{course_id}/topics", response_model=list[TopicOut])
def list_topics(course_id: str, user_id: str = Depends(get_current_user_id)) -> list[TopicOut]:
    _require_membership(user_id, course_id)
    return [_to_out(topic) for topic in repository.list_topics(course_id)]


@router.patch("/courses/{course_id}/topics/{topic_id}", response_model=TopicOut)
def update_topic(
    course_id: str,
    topic_id: str,
    payload: TopicUpdate,
    user_id: str = Depends(get_current_user_id),
) -> TopicOut:
    _require_membership(user_id, course_id)

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    topic = repository.update_topic(course_id, topic_id, changes)
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")

    return _to_out(topic)


@router.delete(
    "/courses/{course_id}/topics/{topic_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_topic(
    course_id: str, topic_id: str, user_id: str = Depends(get_current_user_id)
) -> None:
    _require_membership(user_id, course_id)

    action_ids = [
        action["id"]
        for action in repository.list_actions(course_id)
        if action["topicId"] == topic_id
    ]
    repository.delete_topic(course_id, topic_id)
    progress_repo.delete_topic_progress(user_id, topic_id, action_ids)


def _require_membership(user_id: str, course_id: str) -> dict[str, Any]:
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")
    return membership


def _to_out(topic: dict[str, Any]) -> TopicOut:
    return TopicOut(
        id=topic["id"],
        courseId=topic["courseId"],
        name=topic["name"],
        isPriority=topic.get("isPriority", False),
    )
