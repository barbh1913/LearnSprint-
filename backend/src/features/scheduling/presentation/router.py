"""Schedule endpoint (FR3.1-FR3.3, and the data behind the Gantt view FR6.1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from features.academic_profile.infrastructure import repository as course_repo
from features.scheduling.application.generate_schedule import (
    CourseNotScheduled,
    build_schedule_for_course,
)
from features.scheduling.domain.models import InfeasiblePlan
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["scheduling"])


class BlockOut(BaseModel):
    start: str
    end: str
    durationMinutes: int
    blockType: str
    topicId: str | None
    topicName: str | None
    actionType: str | None
    label: str


class ScheduleOut(BaseModel):
    feasible: bool
    isEmergencyMode: bool = False
    blocks: list[BlockOut] = []
    totalAvailableMinutes: int = 0
    totalNeededMinutes: int = 0
    # Only set when the plan doesn't fit.
    reason: str | None = None
    shortfallMinutes: int | None = None


@router.get("/courses/{course_id}/schedule", response_model=ScheduleOut)
def get_schedule(course_id: str, user_id: str = Depends(get_current_user_id)) -> ScheduleOut:
    if course_repo.get_membership(user_id, course_id) is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")

    try:
        result = build_schedule_for_course(user_id, course_id)
    except CourseNotScheduled as exc:
        raise HTTPException(
            status_code=400, detail="Set an exam date for this course to build a schedule"
        ) from exc

    # An infeasible plan is a valid answer, not an error - the user gets told
    # how much time to free up rather than a silently broken schedule.
    if isinstance(result, InfeasiblePlan):
        return ScheduleOut(
            feasible=False,
            reason=result.reason,
            shortfallMinutes=result.shortfall_minutes,
            totalAvailableMinutes=result.available_minutes,
            totalNeededMinutes=result.required_minutes,
        )

    return ScheduleOut(
        feasible=True,
        isEmergencyMode=result.is_emergency_mode,
        totalAvailableMinutes=result.total_available_minutes,
        totalNeededMinutes=result.total_needed_minutes,
        blocks=[
            BlockOut(
                start=block.start.isoformat(),
                end=block.end.isoformat(),
                durationMinutes=block.duration_minutes,
                blockType=block.block_type.value,
                topicId=block.topic_id,
                topicName=block.topic_name,
                actionType=block.action_type.value if block.action_type else None,
                label=block.label,
            )
            for block in result.blocks
        ],
    )
