"""Turn a generated schedule into an iCalendar (.ics) file.

Exporting a standard .ics rather than talking to the Google Calendar API
directly means the plan imports into Google Calendar, Apple Calendar and
Outlook alike, with no OAuth consent flow and no third-party account linking.

Pure string building - no I/O, so it's straightforward to test.
"""

from __future__ import annotations

from datetime import datetime

from features.scheduling.domain.models import BlockType, Schedule

# RFC 5545 wants CRLF line endings.
LINE_END = "\r\n"

BLOCK_DESCRIPTIONS = {
    BlockType.ACTION: "Learning action from your LearnSprint plan",
    BlockType.REVIEW: "Review session - time weighted by how well you know this topic",
    BlockType.STUDY_AID: "Prepare your open-material folder or formula sheet",
}


def schedule_to_ics(schedule: Schedule, *, course_name: str) -> str:
    """Render one course's schedule as an iCalendar document."""
    return plan_to_ics([(course_name, schedule)], calendar_name=f"{course_name} study plan")


def plan_to_ics(named_schedules: list[tuple[str, Schedule]], *, calendar_name: str) -> str:
    """Render several courses' schedules as one iCalendar document, in time order.

    Each event is tagged with its course in CATEGORIES, which is how the
    student tells them apart once imported.
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
        ((block, course_name) for course_name, schedule in named_schedules for block in schedule.blocks),
        key=lambda item: item[0].start,
    )
    for index, (block, course_name) in enumerate(events):
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:learnsprint-{index}-{_stamp(block.start)}@learnsprint",
                f"DTSTAMP:{_stamp(datetime.now())}",
                f"DTSTART:{_stamp(block.start)}",
                f"DTEND:{_stamp(block.end)}",
                f"SUMMARY:{_escape(block.label)}",
                f"DESCRIPTION:{_escape(BLOCK_DESCRIPTIONS[block.block_type])}",
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
