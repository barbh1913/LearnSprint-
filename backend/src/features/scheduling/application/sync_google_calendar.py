"""Push one course's plan into the student's LearnSprint calendar (FR6.2).

Recompute the plan (never read it from storage - ADR 0005), then replace that
course's events in the LearnSprint calendar: whatever a previous sync wrote
for this course is removed first, so syncing twice never duplicates and other
courses' sessions in the same calendar are left alone.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from features.academic_profile.infrastructure import repository as course_repo
from features.scheduling.application.generate_schedule import build_schedule_for_course
from features.scheduling.domain.google_events import course_filter, schedule_to_google_events
from features.scheduling.domain.models import InfeasiblePlan
from features.scheduling.infrastructure import google_calendar
from features.scheduling.infrastructure import google_connection_repository as connections
from shared.config import settings


class SyncRefused(Exception):
    """Nothing sensible to put on a calendar right now; the message says why."""


def sync_course(user_id: str, course_id: str) -> dict[str, Any]:
    """Returns how many sessions were written and when. Raises SyncRefused,
    CourseNotScheduled (no exam date) or GoogleCalendarError."""
    connection = connections.get_connection(user_id)
    if connection is None:
        raise SyncRefused("Connect Google Calendar first")

    membership = course_repo.get_membership(user_id, course_id) or {}
    result = build_schedule_for_course(user_id, course_id)
    if isinstance(result, InfeasiblePlan):
        raise SyncRefused("This plan doesn't fit, so there is nothing to sync yet")

    events = schedule_to_google_events(
        result,
        course_id=course_id,
        course_name=membership.get("courseName", "Course"),
        time_zone=settings.google_calendar_time_zone,
    )

    access_token = google_calendar.refresh_access_token(connection["refreshToken"])
    calendar_id = connection["googleCalendarId"]
    previous = google_calendar.list_event_ids(access_token, calendar_id, course_filter(course_id))
    google_calendar.delete_events(access_token, calendar_id, previous)
    google_calendar.insert_events(access_token, calendar_id, events)

    synced_at = datetime.now().isoformat(timespec="seconds")
    connections.mark_synced(user_id, synced_at)
    return {"synced": len(events), "lastSyncedAt": synced_at}
