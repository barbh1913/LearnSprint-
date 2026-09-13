"""Turn a generated schedule into Google Calendar event payloads (FR6.2, ADR 0010).

Pure data shaping, no I/O - the sibling of calendar_export.py. Times go out as
the scheduler's naive wall-clock values with an explicit zone attached, which
is the same "floating time" the .ics export uses, made explicit because
Google's API insists on knowing whose clock it is.
"""

from __future__ import annotations

from typing import Any

from features.scheduling.domain.calendar_export import BLOCK_DESCRIPTIONS
from features.scheduling.domain.models import Schedule

# Private extended properties are how a sync finds the events it wrote last
# time: every LearnSprint event carries the course it came from, so re-syncing
# one course never touches another course's sessions in the same calendar.
COURSE_PROPERTY = "learnsprintCourseId"


def schedule_to_google_events(
    schedule: Schedule, *, course_id: str, course_name: str, time_zone: str
) -> list[dict[str, Any]]:
    return [
        {
            "summary": block.label,
            "description": f"{BLOCK_DESCRIPTIONS[block.block_type]}\n{course_name}",
            "start": {"dateTime": block.start.isoformat(timespec="seconds"), "timeZone": time_zone},
            "end": {"dateTime": block.end.isoformat(timespec="seconds"), "timeZone": time_zone},
            "extendedProperties": {"private": {COURSE_PROPERTY: course_id}},
        }
        for block in schedule.blocks
    ]


def course_filter(course_id: str) -> str:
    """The `privateExtendedProperty` query value that selects one course's events."""
    return f"{COURSE_PROPERTY}={course_id}"
