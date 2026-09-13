"""Topic endpoints: upload and extract, then edit by hand (FR2.1, FR2.2, FR2.3, FR2.6, FR2.9)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.domain.estimates import split_total_minutes
from features.content_topics.domain.extraction import extract_topics
from features.content_topics.infrastructure import ai_extractor
from features.content_topics.infrastructure import file_parser
from features.content_topics.infrastructure import repository
from features.progress.infrastructure import repository as progress_repo
from shared import storage
from shared.auth.dependencies import get_current_user_id
from shared.config import settings

router = APIRouter(tags=["content-topics"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_FILES_PER_UPLOAD = 15
DOWNLOAD_LINK_SECONDS = 5 * 60

Priority = Literal["low", "medium", "high"]


class TopicCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    priority: Priority | None = None
    description: str | None = Field(default=None, max_length=2000)
    # The pre-levels flag, still accepted: true means high.
    isPriority: bool | None = None


class TopicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    priority: Priority | None = None
    isPriority: bool | None = None
    # A topic-level estimate; re-split across the subtasks in proportion (FR2.2).
    estimatedMinutes: int | None = Field(default=None, ge=10, le=3000)


def _priority_from(priority: str | None, is_priority: bool | None) -> str | None:
    """Levels win; the old boolean maps to high/medium so existing callers keep working."""
    if priority is not None:
        return priority
    if is_priority is not None:
        return "high" if is_priority else "medium"
    return None


class TopicOut(BaseModel):
    id: str
    courseId: str
    name: str
    description: str | None = None
    priority: Priority = "medium"
    # Derived from priority; kept so older readers of the API see nothing change.
    isPriority: bool = False


class ActionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    durationMinutes: int = Field(default=30, ge=10, le=300)


class ActionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    durationMinutes: int | None = Field(default=None, ge=10, le=300)


class ActionOut(BaseModel):
    id: str
    topicId: str
    type: str
    title: str
    order: int
    durationMinutes: int


class MaterialOut(BaseModel):
    id: str
    topicId: str
    fileName: str
    fileType: str
    sizeBytes: int
    uploadedAt: str


class DownloadLinkOut(BaseModel):
    url: str
    expiresInSeconds: int


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

    When the backend has an Anthropic key configured (FR2.7), Claude reads the
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

    lines, filenames = await _read_all(files, user_id=user_id, course_id=course_id)
    if not lines:
        raise HTTPException(status_code=422, detail="Those files had no readable text")

    topics, analysed_by, note = _analyse(lines)

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


async def _read_all(
    files: list[UploadFile], *, user_id: str, course_id: str
) -> tuple[list[str], list[str]]:
    """Save every uploaded file under the student's own S3 prefix, then read
    the text back out of the stored copy - not the request body - so what
    gets analysed is provably what's on record for this student (FR2.1).

    Concatenated in upload order.
    """
    lines: list[str] = []
    filenames: list[str] = []

    for upload in files:
        content = await upload.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413, detail=f"{upload.filename} is larger than 20 MB"
            )

        filename = upload.filename or ""
        key = storage.upload_key(user_id, course_id, filename)
        storage.put_object(key, content)
        stored = storage.get_object(key)

        try:
            lines.extend(file_parser.read_lines(filename, stored))
        except file_parser.UnsupportedFileType as exc:
            raise HTTPException(
                status_code=400, detail="Only PDF and PPTX files are supported"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - a corrupt upload shouldn't 500
            raise HTTPException(
                status_code=400, detail=f"Could not read {upload.filename}"
            ) from exc

        filenames.append(filename)

    return lines, filenames


def _analyse(lines: list[str]) -> tuple[list[tuple[str, int | None, str]], str, str | None]:
    """Run AI analysis when the backend has a key, otherwise the heuristic.

    Returns (topics, which analyser ran, an optional note for the student).
    The AI path is never allowed to fail the upload.
    """
    if settings.system_anthropic_api_key:
        try:
            analysed = ai_extractor.analyse_syllabus(lines, api_key=settings.system_anthropic_api_key)
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
    topic = repository.create_topic(
        course_id,
        payload.name,
        priority=_priority_from(payload.priority, payload.isPriority) or "medium",
        description=payload.description,
    )
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

    # `description: null` is a real change (clearing it); an absent field is not.
    changes = payload.model_dump(exclude_unset=True)
    estimated_minutes = changes.pop("estimatedMinutes", None)
    priority = _priority_from(changes.pop("priority", None), changes.pop("isPriority", None))
    if priority is not None:
        changes["priority"] = priority
    changes = {key: value for key, value in changes.items() if key == "description" or value is not None}

    topic = repository.update_topic(course_id, topic_id, changes)
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")

    if estimated_minutes is not None:
        _respread_estimate(course_id, topic_id, estimated_minutes)

    return _to_out(topic)


def _respread_estimate(course_id: str, topic_id: str, total_minutes: int) -> None:
    """A topic-level estimate becomes new subtask minutes, in proportion to the old ones (FR2.2)."""
    actions = [action for action in repository.list_actions(course_id) if action["topicId"] == topic_id]
    try:
        minutes = split_total_minutes(total_minutes, [action["defaultDurationMinutes"] for action in actions])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    repository.set_action_minutes(
        course_id, topic_id, {action["id"]: value for action, value in zip(actions, minutes)}
    )


@router.post(
    "/courses/{course_id}/topics/{topic_id}/actions",
    response_model=ActionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_action(
    course_id: str,
    topic_id: str,
    payload: ActionCreate,
    user_id: str = Depends(get_current_user_id),
) -> ActionOut:
    """Add a subtask of the student's own to a topic (FR2.3)."""
    _require_membership(user_id, course_id)
    if repository.get_topic(course_id, topic_id) is None:
        raise HTTPException(status_code=404, detail="Topic not found")

    action = repository.create_action(
        course_id, topic_id, title=payload.title.strip(), duration_minutes=payload.durationMinutes
    )
    return _action_out(action)


@router.patch(
    "/courses/{course_id}/topics/{topic_id}/actions/{action_id}", response_model=ActionOut
)
def update_action(
    course_id: str,
    topic_id: str,
    action_id: str,
    payload: ActionUpdate,
    user_id: str = Depends(get_current_user_id),
) -> ActionOut:
    """Rename a subtask or adjust its time estimate by hand, e.g. from the topic detail view (FR2.2, FR2.3)."""
    _require_membership(user_id, course_id)

    changes: dict[str, Any] = {}
    if payload.title is not None:
        changes["title"] = payload.title.strip()
    if payload.durationMinutes is not None:
        changes["defaultDurationMinutes"] = payload.durationMinutes
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change")

    action = repository.update_action(course_id, topic_id, action_id, changes)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    return _action_out(action)


@router.delete(
    "/courses/{course_id}/topics/{topic_id}/actions/{action_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_action(
    course_id: str,
    topic_id: str,
    action_id: str,
    user_id: str = Depends(get_current_user_id),
) -> None:
    """Delete a shared subtask and every group member's progress on it (FR2.3).

    A topic keeps at least one subtask, so it never silently drops out of the plan.
    """
    _require_membership(user_id, course_id)

    siblings = [action for action in repository.list_actions(course_id) if action["topicId"] == topic_id]
    if not any(action["id"] == action_id for action in siblings):
        raise HTTPException(status_code=404, detail="Action not found")
    if len(siblings) == 1:
        raise HTTPException(status_code=409, detail="A topic needs at least one subtask")

    repository.delete_action(course_id, topic_id, action_id)
    for member in course_repo.list_course_members(course_id):
        progress_repo.delete_action_progress(member["userId"], [action_id])


@router.delete(
    "/courses/{course_id}/topics/{topic_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_topic(
    course_id: str, topic_id: str, user_id: str = Depends(get_current_user_id)
) -> None:
    """Delete a shared topic and every group member's private progress on it.

    A topic can be shared by a whole study group (FR5.2), so deleting it for
    everyone but leaving the other members' UserTopicProgress/UserActionProgress
    rows pointing at now-nonexistent actions would strand orphaned data under
    their partitions forever - the same class of bug already fixed for course
    deletion in academic_profile.
    """
    _require_membership(user_id, course_id)

    action_ids = [
        action["id"]
        for action in repository.list_actions(course_id)
        if action["topicId"] == topic_id
    ]
    repository.delete_topic(course_id, topic_id)

    for member in course_repo.list_course_members(course_id):
        progress_repo.delete_topic_progress(member["userId"], topic_id, action_ids)

    # Every student's materials on the topic go too - the topic they hung off no longer exists.
    for material in repository.list_topic_materials(course_id, topic_id):
        storage.delete_object(material["s3Key"])
        repository.delete_material(course_id, material["id"])


# --- Materials (FR2.9) -------------------------------------------------------
#
# A material is private to whoever uploaded it: every read and delete checks
# the owner, not just course membership, so a group member cannot reach another
# member's files by guessing ids.


@router.post(
    "/courses/{course_id}/topics/{topic_id}/materials",
    response_model=list[MaterialOut],
    status_code=status.HTTP_201_CREATED,
)
async def upload_materials(
    course_id: str,
    topic_id: str,
    files: list[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
) -> list[MaterialOut]:
    """Attach the student's original files to a topic, kept exactly as uploaded."""
    _require_membership(user_id, course_id)
    if repository.get_topic(course_id, topic_id) is None:
        raise HTTPException(status_code=404, detail="Topic not found")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(status_code=413, detail=f"Upload at most {MAX_FILES_PER_UPLOAD} files at a time")

    created = []
    for upload in files:
        content = await upload.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"{upload.filename} is larger than 20 MB")
        if not content:
            raise HTTPException(status_code=400, detail=f"{upload.filename} is empty")

        file_name = upload.filename or "upload"
        key = storage.upload_key(user_id, course_id, file_name)
        storage.put_object(key, content)
        created.append(
            repository.create_material(
                user_id=user_id,
                course_id=course_id,
                topic_id=topic_id,
                file_name=file_name,
                s3_key=key,
                size_bytes=len(content),
            )
        )

    return [_material_out(material) for material in created]


@router.get("/courses/{course_id}/topics/{topic_id}/materials", response_model=list[MaterialOut])
def list_materials(
    course_id: str, topic_id: str, user_id: str = Depends(get_current_user_id)
) -> list[MaterialOut]:
    """The student's own materials on the topic - never another member's."""
    _require_membership(user_id, course_id)
    return [
        _material_out(material)
        for material in repository.list_topic_materials(course_id, topic_id)
        if material["userId"] == user_id
    ]


@router.get(
    "/courses/{course_id}/topics/{topic_id}/materials/{material_id}/download",
    response_model=DownloadLinkOut,
)
def material_download_link(
    course_id: str,
    topic_id: str,
    material_id: str,
    user_id: str = Depends(get_current_user_id),
) -> DownloadLinkOut:
    """A short-lived link straight to the private bucket, for this student's own file."""
    material = _require_own_material(user_id, course_id, topic_id, material_id)
    return DownloadLinkOut(
        url=storage.presigned_get_url(
            material["s3Key"], file_name=material["fileName"], expires_in=DOWNLOAD_LINK_SECONDS
        ),
        expiresInSeconds=DOWNLOAD_LINK_SECONDS,
    )


@router.delete(
    "/courses/{course_id}/topics/{topic_id}/materials/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_material(
    course_id: str,
    topic_id: str,
    material_id: str,
    user_id: str = Depends(get_current_user_id),
) -> None:
    material = _require_own_material(user_id, course_id, topic_id, material_id)
    storage.delete_object(material["s3Key"])
    repository.delete_material(course_id, material_id)


def _require_own_material(
    user_id: str, course_id: str, topic_id: str, material_id: str
) -> dict[str, Any]:
    _require_membership(user_id, course_id)
    material = repository.get_material(course_id, material_id)
    if material is None or material["topicId"] != topic_id:
        raise HTTPException(status_code=404, detail="Material not found")
    if material["userId"] != user_id:
        raise HTTPException(status_code=403, detail="This material belongs to another student")
    return material


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
        description=topic.get("description"),
        priority=topic["priority"],
        isPriority=topic["isPriority"],
    )


def _action_out(action: dict[str, Any]) -> ActionOut:
    return ActionOut(
        id=action["id"],
        topicId=action["topicId"],
        type=action["type"],
        title=action["title"],
        order=action["order"],
        durationMinutes=action["defaultDurationMinutes"],
    )


def _material_out(material: dict[str, Any]) -> MaterialOut:
    return MaterialOut(
        id=material["id"],
        topicId=material["topicId"],
        fileName=material["fileName"],
        fileType=material["fileType"],
        sizeBytes=material["sizeBytes"],
        uploadedAt=material["uploadedAt"],
    )
