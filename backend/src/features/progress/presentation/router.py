"""Board, progress updates and study velocity (FR4, FR7)."""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.application import board_service
from features.progress.domain import sprint
from features.progress.domain import status as status_rules
from features.progress.infrastructure import repository
from features.scheduling.domain.models import BlockedSlot, TimePreference
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["progress"])


class TopicProgressUpdate(BaseModel):
    status: str | None = None
    masteryLevel: int | None = Field(default=None, ge=1, le=5)


class ActionProgressUpdate(BaseModel):
    isDone: bool


class WeeklyCountOut(BaseModel):
    weekStart: str
    completed: int


class VelocityOut(BaseModel):
    actionsCompletedThisWeek: int
    actionsCompletedLastWeek: int
    weeklyAverage: float
    averageMastery: float | None
    trend: str
    history: list[WeeklyCountOut] = []
    masteryDistribution: list[int] = []


class SprintOut(BaseModel):
    """This week's commitment measured against the hours actually available."""

    startsAt: str
    endsAt: str
    daysRemaining: int
    capacityMinutes: int
    committedMinutes: int
    completedMinutes: int
    remainingCapacityMinutes: int
    topicCount: int
    backlogCount: int
    status: str  # empty | healthy | tight | over_committed | no_capacity


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
        # A drag is a manual override (FR4.3) - it sticks as-is until the next
        # automatic trigger (an action completed, a mastery rating given)
        # clears it below or in update_action_progress.
        progress["statusOverride"] = True
    if payload.masteryLevel is not None:
        progress["masteryLevel"] = payload.masteryLevel
        progress["statusOverride"] = False

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

    # A finished (or un-finished) action is the other automatic trigger in
    # FR4.3 - it clears any manual drag so the board goes back to deriving
    # this topic's status from real progress.
    topic_progress = repository.get_topic_progress(user_id, action["topicId"])
    if topic_progress.get("statusOverride"):
        topic_progress["statusOverride"] = False
        repository.save_topic_progress(topic_progress)

    return {"actionId": action_id, "isDone": payload.isDone, "topicId": action["topicId"]}


@router.get("/sprint", response_model=SprintOut)
def get_sprint(user_id: str = Depends(get_current_user_id)) -> SprintOut:
    """This week's sprint: what was committed, and whether it fits the free hours.

    Committed = topics the student pulled into To do / In progress. Everything
    still in Backlog is explicitly *not* part of this week's commitment.
    """
    board = board_service.build_board(user_id)
    constraints = course_repo.get_constraints(user_id)

    committed_cards = [
        card
        for card in board["cards"]
        if card["status"] in (status_rules.TODO, status_rules.IN_PROGRESS)
    ]

    # Only the unfinished actions still cost time this week.
    committed_minutes = sum(
        action["durationMinutes"]
        for card in committed_cards
        for action in card["actions"]
        if not action["isDone"]
    )
    completed_minutes = sum(
        action["durationMinutes"]
        for card in committed_cards
        for action in card["actions"]
        if action["isDone"]
    )

    plan = sprint.build_sprint_plan(
        now=datetime.now(),
        blocked_slots=[_to_blocked_slot(slot) for slot in constraints.get("blockedSlots", [])],
        time_preference=TimePreference(constraints.get("timePreference", "evening")),
        committed_minutes=committed_minutes,
        completed_minutes=completed_minutes,
        topic_count=len(committed_cards),
    )

    return SprintOut(
        startsAt=plan.window.start.isoformat(),
        endsAt=plan.window.end.isoformat(),
        daysRemaining=plan.window.days_remaining,
        capacityMinutes=plan.capacity_minutes,
        committedMinutes=plan.committed_minutes,
        completedMinutes=plan.completed_minutes,
        remainingCapacityMinutes=plan.remaining_capacity_minutes,
        topicCount=plan.topic_count,
        status=plan.status,
        backlogCount=sum(
            1 for card in board["cards"] if card["status"] == status_rules.BACKLOG
        ),
    )


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
        history=[
            WeeklyCountOut(weekStart=week.week_start, completed=week.completed)
            for week in velocity.history
        ],
        masteryDistribution=list(velocity.mastery_distribution),
    )


def _require_membership(user_id: str, course_id: str) -> dict[str, Any]:
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")
    return membership


def _to_blocked_slot(slot: dict[str, Any]) -> BlockedSlot:
    hour, _, minute = str(slot["startTime"]).partition(":")
    end_hour, _, end_minute = str(slot["endTime"]).partition(":")
    return BlockedSlot(
        day_of_week=int(slot["day"]),
        start_time=time(int(hour), int(minute or 0)),
        end_time=time(int(end_hour), int(end_minute or 0)),
    )
