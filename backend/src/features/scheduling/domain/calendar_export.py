"""Turn a generated schedule into an iCalendar (.ics) file.

Exporting a standard .ics rather than talking to the Google Calendar API
directly means the plan imports into Google Calendar, Apple Calendar and
Outlook alike, with no OAuth consent flow and no third-party account linking.
(Google sync exists too - ADR 0010 - and writes the same topic events.)

Pure string building - no I/O, so it's straightforward to test.
"""

from __future__ import annotations

from datetime import datetime

from features.scheduling.domain.models import Schedule
from features.scheduling.domain.topic_events import (
    REVIEW,
    STUDY,
    STUDY_AID,
    TopicEvent,
    group_blocks_into_topic_events,
)

# RFC 5545 wants CRLF line endings.
LINE_END = "\r\n"

KIND_DESCRIPTIONS = {
    STUDY: "Study session from your LearnSprint plan",
    REVIEW: "Review session - time weighted by how well you know this topic",
    STUDY_AID: "Prepare your open-material folder or formula sheet",
}


def event_summary(event: TopicEvent) -> str:
    """What the calendar entry is called: a study session names its topic explicitly."""
    return f"Study: {event.label}" if event.kind == STUDY else event.label


def event_description(event: TopicEvent, course_name: str) -> str:
    """The kind of session, its subtasks with their minutes, and the course."""
    lines = [KIND_DESCRIPTIONS[event.kind]]
    if event.actions:
        lines.append(", ".join(f"{action.title} ({action.minutes} min)" for action in event.actions))
    lines.append(course_name)
    return "\n".join(lines)


def schedule_to_ics(schedule: Schedule, *, course_name: str) -> str:
    """Render one course's schedule as an iCalendar document."""
    return plan_to_ics([(course_name, schedule)], calendar_name=f"{course_name} study plan")


def plan_to_ics(named_schedules: list[tuple[str, Schedule]], *, calendar_name: str) -> str:
    """Render several courses' schedules as one iCalendar document, in time order.

    One VEVENT per topic event (not per action), tagged with its course in
    CATEGORIES so the student can tell courses apart once imported.
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//LearnSprint//Study Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(calendar_name)}",
    ]

    events = sorted(
        (
            (event, course_name)
            for course_name, schedule in named_schedules
            for event in group_blocks_into_topic_events(schedule.blocks)
        ),
        key=lambda item: item[0].start,
    )
    for index, (event, course_name) in enumerate(events):
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:learnsprint-{index}-{_stamp(event.start)}@learnsprint",
                f"DTSTAMP:{_stamp(datetime.now())}",
                f"DTSTART:{_stamp(event.start)}",
                f"DTEND:{_stamp(event.end)}",
                f"SUMMARY:{_escape(event_summary(event))}",
                f"DESCRIPTION:{_escape(event_description(event, course_name))}",
                f"CATEGORIES:{_escape(course_name)}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return LINE_END.join(lines) + LINE_END


def _stamp(value: datetime) -> str:
    """Local floating time - no Z suffix, so events land at the wall-clock hour planned."""
    return value.strftime("%Y%m%dT%H%M%S")


def _escape(text: str) -> str:
    """Commas, semicolons and backslashes are field separators in iCalendar."""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )
