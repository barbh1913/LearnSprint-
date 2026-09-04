"""Topic endpoints: upload and extract, then edit by hand (FR2.1, FR2.2, FR2.6)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.domain.extraction import extract_topics
from features.content_topics.infrastructure import file_parser
from features.content_topics.infrastructure import repository
from features.progress.infrastructure import repository as progress_repo
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["content-topics"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


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
    sourceFilename: str


@router.post(
    "/courses/{course_id}/topics/extract",
    response_model=ExtractionResult,
    status_code=status.HTTP_201_CREATED,
)
async def extract_from_file(
    course_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
) -> ExtractionResult:
    """Read a PDF/PPTX, pick out the topics, and create them with their actions."""
    _require_membership(user_id, course_id)

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 20 MB")

    try:
        lines = file_parser.read_lines(file.filename or "", content)
    except file_parser.UnsupportedFileType as exc:
        raise HTTPException(status_code=400, detail="Only PDF and PPTX files are supported") from exc
    except Exception as exc:  # noqa: BLE001 - a corrupt upload shouldn't 500
        raise HTTPException(status_code=400, detail="Could not read that file") from exc

    extracted = extract_topics(lines)
    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No topics could be found in that file. Try another file or add topics manually.",
        )

    created = [repository.create_topic(course_id, topic.name) for topic in extracted]
    languages = {topic.language for topic in extracted}

    return ExtractionResult(
        created=[_to_out(topic) for topic in created],
        # Names stay in their source language - we never translate (see CLAUDE.md).
        detectedLanguage="mixed" if len(languages) > 1 else languages.pop(),
        sourceFilename=file.filename or "",
    )


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
