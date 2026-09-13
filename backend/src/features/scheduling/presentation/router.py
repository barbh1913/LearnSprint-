"""Schedule endpoint (FR3.1-FR3.3, and the data behind the Calendar view FR6.1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from features.academic_profile.infrastructure import repository as course_repo
from features.scheduling.application import google_calendar_connection, sync_google_calendar
from features.scheduling.application.generate_schedule import (
    CourseNotScheduled,
    CoursePlan,
    build_plan_for_student,
    build_schedule_for_course,
)
from features.scheduling.domain.calendar_export import plan_to_ics, schedule_to_ics
from features.scheduling.domain.models import InfeasiblePlan, Schedule, SchedulingResult
from features.scheduling.domain.topic_events import group_blocks_into_topic_events
from features.scheduling.infrastructure.google_calendar import GoogleCalendarError
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
    actionId: str | None = None
    label: str
    # Which course the session belongs to - what lets the all-courses calendar label it.
    courseId: str | None = None
    courseName: str | None = None


class EventActionOut(BaseModel):
    actionId: str
    title: str
    minutes: int


class EventOut(BaseModel):
    """A topic on the calendar: its consecutive scheduled subtasks as one entry (ADR 0012)."""

    topicId: str | None
    topicName: str | None
    kind: str  # "study" | "review" | "study_aid"
    start: str
    end: str
    durationMinutes: int
    label: str
    actions: list[EventActionOut]
    courseId: str | None = None
    courseName: str | None = None


class ScheduleOut(BaseModel):
    feasible: bool
    isEmergencyMode: bool = False
    # Per learning action - what the scheduler placed.
    blocks: list[BlockOut] = []
    # Per topic - what the Calendar, the .ics and Google show.
    events: list[EventOut] = []
    totalAvailableMinutes: int = 0
    totalNeededMinutes: int = 0
    # Only set when the plan doesn't fit.
    reason: str | None = None
    shortfallMinutes: int | None = None


class CourseScheduleOut(ScheduleOut):
    courseId: str
    courseName: str
    examDate: str


class StudentPlanOut(BaseModel):
    """Every course's slice of the one combined plan (FR3.1), nearest exam first."""

    courses: list[CourseScheduleOut]
    # All courses' blocks and topic events in time order - the all-courses calendar.
    blocks: list[BlockOut]
    events: list[EventOut]
    totalAvailableMinutes: int
    totalNeededMinutes: int
    # Number of topic events - what the student sees as "sessions".
    sessions: int


@router.get("/schedule", response_model=StudentPlanOut)
def get_student_plan(user_id: str = Depends(get_current_user_id)) -> StudentPlanOut:
    plan = build_plan_for_student(user_id)
    courses = [_course_schedule_out(entry) for entry in plan.courses]
    blocks = sorted((block for course in courses for block in course.blocks), key=lambda b: b.start)
    events = sorted((event for course in courses for event in course.events), key=lambda e: e.start)
    return StudentPlanOut(
        courses=courses,
        blocks=blocks,
        events=events,
        totalAvailableMinutes=plan.total_available_minutes,
        totalNeededMinutes=sum(course.totalNeededMinutes for course in courses),
        sessions=len(events),
    )


@router.get("/courses/{course_id}/schedule", response_model=ScheduleOut)
def get_schedule(course_id: str, user_id: str = Depends(get_current_user_id)) -> ScheduleOut:
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")

    try:
        result = build_schedule_for_course(user_id, course_id)
    except CourseNotScheduled as exc:
        raise HTTPException(
            status_code=400, detail="Set an exam date for this course to build a schedule"
        ) from exc

    return _schedule_out(result, course_id=course_id, course_name=membership.get("courseName", "Course"))


@router.get("/schedule.ics")
def download_student_plan_ics(user_id: str = Depends(get_current_user_id)) -> Response:
    """Every course with a plan that fits, as one .ics - the all-courses calendar, exported."""
    plan = build_plan_for_student(user_id)
    feasible = [
        (entry.course_name, entry.result)
        for entry in plan.courses
        if isinstance(entry.result, Schedule)
    ]
    if not feasible:
        raise HTTPException(status_code=409, detail="No plan fits yet - nothing to export")

    return _ics_response(
        plan_to_ics(feasible, calendar_name="LearnSprint study plan"), filename="learnsprint-study-plan"
    )


@router.get("/courses/{course_id}/schedule.ics")
def download_schedule_ics(
    course_id: str, user_id: str = Depends(get_current_user_id)
) -> Response:
    """The same plan as an .ics file, importable into Google/Apple/Outlook calendars."""
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")

    try:
        result = build_schedule_for_course(user_id, course_id)
    except CourseNotScheduled as exc:
        raise HTTPException(
            status_code=400, detail="Set an exam date for this course to build a schedule"
        ) from exc

    if isinstance(result, InfeasiblePlan):
        raise HTTPException(status_code=409, detail="This plan doesn't fit - nothing to export")

    course_name = membership.get("courseName", "Course")
    return _ics_response(
        schedule_to_ics(result, course_name=course_name), filename=_safe_filename(course_name)
    )


def _course_schedule_out(entry: CoursePlan) -> CourseScheduleOut:
    base = _schedule_out(entry.result, course_id=entry.course_id, course_name=entry.course_name)
    return CourseScheduleOut(
        **base.model_dump(),
        courseId=entry.course_id,
        courseName=entry.course_name,
        examDate=entry.exam_date.isoformat(),
    )


def _schedule_out(result: SchedulingResult, *, course_id: str, course_name: str) -> ScheduleOut:
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
        events=[
            EventOut(
                topicId=event.topic_id,
                topicName=event.topic_name,
                kind=event.kind,
                start=event.start.isoformat(),
                end=event.end.isoformat(),
                durationMinutes=event.duration_minutes,
                label=event.label,
                actions=[
                    EventActionOut(actionId=action.action_id, title=action.title, minutes=action.minutes)
                    for action in event.actions
                ],
                courseId=course_id,
                courseName=course_name,
            )
            for event in group_blocks_into_topic_events(result.blocks)
        ],
        blocks=[
            BlockOut(
                start=block.start.isoformat(),
                end=block.end.isoformat(),
                durationMinutes=block.duration_minutes,
                blockType=block.block_type.value,
                topicId=block.topic_id,
                topicName=block.topic_name,
                actionType=block.action_type.value if block.action_type else None,
                actionId=block.action_id,
                label=block.label,
                courseId=course_id,
                courseName=course_name,
            )
            for block in result.blocks
        ],
    )


def _ics_response(content: str, *, filename: str) -> Response:
    return Response(
        content=content,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}.ics"'},
    )


# --- Google Calendar sync (FR6.2) ------------------------------------------
#
# The refresh token never appears in any of these responses; the status only
# says whether a connection exists and when it was last used.


class GoogleCalendarStatusOut(BaseModel):
    configured: bool
    connected: bool
    connectedAt: str | None = None
    lastSyncedAt: str | None = None


class GoogleAuthorizeOut(BaseModel):
    authorizeUrl: str
    state: str


class GoogleCallbackIn(BaseModel):
    code: str = Field(min_length=1)


@router.get("/integrations/google-calendar/status", response_model=GoogleCalendarStatusOut)
def google_calendar_status(user_id: str = Depends(get_current_user_id)) -> GoogleCalendarStatusOut:
    return GoogleCalendarStatusOut(**google_calendar_connection.connection_status(user_id))


@router.get("/integrations/google-calendar/authorize", response_model=GoogleAuthorizeOut)
def google_calendar_authorize(_: str = Depends(get_current_user_id)) -> GoogleAuthorizeOut:
    try:
        url, state = google_calendar_connection.start_connection()
    except google_calendar_connection.GoogleCalendarNotConfigured:
        raise _not_configured()
    return GoogleAuthorizeOut(authorizeUrl=url, state=state)


@router.post("/integrations/google-calendar/callback", response_model=GoogleCalendarStatusOut)
def google_calendar_callback(
    payload: GoogleCallbackIn, user_id: str = Depends(get_current_user_id)
) -> GoogleCalendarStatusOut:
    try:
        status = google_calendar_connection.complete_connection(user_id, payload.code)
    except google_calendar_connection.GoogleCalendarNotConfigured:
        raise _not_configured()
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GoogleCalendarStatusOut(**status)


@router.delete("/integrations/google-calendar/connection", status_code=204)
def google_calendar_disconnect(user_id: str = Depends(get_current_user_id)) -> Response:
    google_calendar_connection.disconnect(user_id)
    return Response(status_code=204)


class GoogleSyncCourseOut(BaseModel):
    courseId: str
    courseName: str
    synced: int
    # Why this course was left out of the sync, e.g. its plan doesn't fit. None when it was written.
    skipped: str | None = None


class GoogleSyncOut(BaseModel):
    synced: int
    lastSyncedAt: str
    courses: list[GoogleSyncCourseOut]


@router.post("/integrations/google-calendar/sync", response_model=GoogleSyncOut)
def google_calendar_sync(
    courseId: str | None = None, user_id: str = Depends(get_current_user_id)
) -> GoogleSyncOut:
    """Sync the course given, or every course with a plan - the same filter the Calendar shows."""
    if courseId is not None and course_repo.get_membership(user_id, courseId) is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")

    try:
        result = sync_google_calendar.sync_courses(user_id, courseId)
    except CourseNotScheduled as exc:
        raise HTTPException(
            status_code=400, detail="Set an exam date for this course to build a schedule"
        ) from exc
    except sync_google_calendar.SyncRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except GoogleCalendarError as exc:
        # Includes GoogleReconnectRequired: the message tells the student to connect again.
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return GoogleSyncOut(**result)


def _not_configured() -> HTTPException:
    return HTTPException(status_code=503, detail="Google Calendar sync is not set up on this server")


def _safe_filename(name: str) -> str:
    """Keep the download name to characters that survive every OS and browser."""
    cleaned = "".join(char if char.isalnum() or char in " -_" else "" for char in name)
    return cleaned.strip().replace(" ", "-").lower() or "study-plan"
