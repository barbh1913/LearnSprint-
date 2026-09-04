"""Board, progress updates and study velocity (FR4, FR7)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.application import board_service
from features.progress.domain import status as status_rules
from features.progress.infrastructure import repository
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["progress"])


class TopicProgressUpdate(BaseModel):
    status: str | None = None
    masteryLevel: int | None = Field(default=None, ge=1, le=5)


class ActionProgressUpdate(BaseModel):
    isDone: bool


class VelocityOut(BaseModel):
    actionsCompletedThisWeek: int
    actionsCompletedLastWeek: int
    weeklyAverage: float
    averageMastery: float | None
    trend: str


@router.get("/board")
def get_board(
    courseId: str | None = None, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    """Board for one course, or all courses when courseId is omitted."""
    if courseId is not None:
        _require_membership(user_id, courseId)

    return board_service.build_board(user_id, courseId)


@router.patch("/topics/{topic_id}/progress")
def update_topic_progress(
    topic_id: str,
    payload: TopicProgressUpdate,
    courseId: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Rate mastery (FR2.4) or drag the card to another column (FR4.3)."""
    _require_membership(user_id, courseId)

    if payload.status is not None and payload.status not in status_rules.STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status: {payload.status}")

    progress = repository.get_topic_progress(user_id, topic_id)
    if payload.status is not None:
        progress["status"] = payload.status
    if payload.masteryLevel is not None:
        progress["masteryLevel"] = payload.masteryLevel

    repository.save_topic_progress(progress)

    return {"topicId": topic_id, "status": progress["status"], "masteryLevel": progress.get("masteryLevel")}


@router.patch("/actions/{action_id}/progress")
def update_action_progress(
    action_id: str,
    payload: ActionProgressUpdate,
    courseId: str,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Tick a learning action off. The topic's status follows automatically (FR4.2)."""
    _require_membership(user_id, courseId)

    action = next(
        (item for item in topic_repo.list_actions(courseId) if item["id"] == action_id), None
    )
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    repository.set_action_done(user_id, action_id, action["topicId"], payload.isDone)

    return {"actionId": action_id, "isDone": payload.isDone, "topicId": action["topicId"]}


@router.get("/velocity", response_model=VelocityOut)
def get_velocity(user_id: str = Depends(get_current_user_id)) -> VelocityOut:
    completed = [
        stamp
        for stamp in (
            status_rules.parse_timestamp(item.get("completedAt"))
            for item in repository.list_action_progress(user_id)
            if item.get("isDone")
        )
        if stamp is not None
    ]
    mastery_levels = [
        item["masteryLevel"]
        for item in repository.list_topic_progress(user_id)
        if item.get("masteryLevel") is not None
    ]

    velocity = status_rules.compute_velocity(
        completed, mastery_levels, now=datetime.now(timezone.utc)
    )

    return VelocityOut(
        actionsCompletedThisWeek=velocity.actions_completed_this_week,
        actionsCompletedLastWeek=velocity.actions_completed_last_week,
        weeklyAverage=velocity.weekly_average,
        averageMastery=velocity.average_mastery,
        trend=velocity.trend,
    )


def _require_membership(user_id: str, course_id: str) -> dict[str, Any]:
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")
    return membership
