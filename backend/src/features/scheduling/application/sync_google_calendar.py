"""Push the plan into the student's LearnSprint calendar (FR6.2).

Recompute the plan (never read it from storage - ADR 0005), then replace each
synced course's events in the LearnSprint calendar: whatever a previous sync
wrote for that course is removed first, so syncing twice never duplicates and
courses outside this sync are left alone. Follows the Calendar's filter: one
course, or every course with a plan.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from features.scheduling.application.generate_schedule import (
    CourseNotScheduled,
    CoursePlan,
    build_plan_for_student,
)
from features.scheduling.domain.google_events import course_filter, schedule_to_google_events
from features.scheduling.domain.models import InfeasiblePlan
from features.scheduling.infrastructure import google_calendar
from features.scheduling.infrastructure import google_connection_repository as connections
from shared.config import settings

NOTHING_FITS = "This plan doesn't fit, so there is nothing to sync yet"


class SyncRefused(Exception):
    """Nothing sensible to put on a calendar right now; the message says why."""


def sync_courses(user_id: str, course_id: str | None = None) -> dict[str, Any]:
    """Sync one course, or every course with a plan when `course_id` is None.

    Returns the total written, the sync stamp, and a per-course breakdown in
    which a course that couldn't be synced carries the reason. Raises
    SyncRefused when there was nothing to write at all, CourseNotScheduled for
    an unknown or undated course, or GoogleCalendarError.
    """
    connection = connections.get_connection(user_id)
    if connection is None:
        raise SyncRefused("Connect Google Calendar first")

    plan = build_plan_for_student(user_id)
    entries = [
        entry for entry in plan.courses if course_id is None or entry.course_id == course_id
    ]
    if course_id is not None and not entries:
        raise CourseNotScheduled(course_id)
    if not entries:
        raise SyncRefused("Set an exam date on a course to build a plan to sync")

    access_token = google_calendar.refresh_access_token(connection["refreshToken"])
    calendar_id = connection["googleCalendarId"]

    outcomes = [_sync_entry(entry, access_token, calendar_id) for entry in entries]
    total = sum(outcome["synced"] for outcome in outcomes)

    if all(outcome["skipped"] for outcome in outcomes):
        # One course: say exactly why. Several: none of them fit.
        raise SyncRefused(
            outcomes[0]["skipped"] if len(outcomes) == 1 else "None of your plans fit yet, so there is nothing to sync"
        )

    synced_at = datetime.now().isoformat(timespec="seconds")
    connections.mark_synced(user_id, synced_at)
    return {"synced": total, "lastSyncedAt": synced_at, "courses": outcomes}


def _sync_entry(entry: CoursePlan, access_token: str, calendar_id: str) -> dict[str, Any]:
    outcome: dict[str, Any] = {
        "courseId": entry.course_id,
        "courseName": entry.course_name,
        "synced": 0,
        "skipped": None,
    }
    if isinstance(entry.result, InfeasiblePlan):
        outcome["skipped"] = NOTHING_FITS
        return outcome

    events = schedule_to_google_events(
        entry.result,
        course_id=entry.course_id,
        course_name=entry.course_name,
        time_zone=settings.google_calendar_time_zone,
    )
    previous = google_calendar.list_event_ids(access_token, calendar_id, course_filter(entry.course_id))
    google_calendar.delete_events(access_token, calendar_id, previous)
    google_calendar.insert_events(access_token, calendar_id, events)
    outcome["synced"] = len(events)
    return outcome
