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
    """Render the schedule as an iCalendar document."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//LearnSprint//Study Planner//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(course_name)} study plan",
    ]

    for index, block in enumerate(schedule.blocks):
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
