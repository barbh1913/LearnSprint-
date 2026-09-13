"""Tests for the .ics export."""

from datetime import datetime

from features.scheduling.domain.calendar_export import plan_to_ics, schedule_to_ics
from features.scheduling.domain.models import BlockType, Schedule, ScheduledBlock


def make_schedule(*blocks: ScheduledBlock) -> Schedule:
    return Schedule(
        blocks=blocks,
        is_emergency_mode=False,
        total_available_minutes=600,
        total_needed_minutes=300,
    )


def make_block(label: str = "Read: Trees") -> ScheduledBlock:
    return ScheduledBlock(
        start=datetime(2026, 9, 10, 18, 0),
        end=datetime(2026, 9, 10, 19, 0),
        block_type=BlockType.ACTION,
        topic_id="t1",
        topic_name="Trees",
        action_type=None,
        label=label,
    )


def test_several_courses_export_as_one_calendar_in_time_order() -> None:
    late = ScheduledBlock(
        start=datetime(2026, 9, 11, 18, 0),
        end=datetime(2026, 9, 11, 19, 0),
        block_type=BlockType.ACTION,
        topic_id="t2",
        topic_name="Classes",
        action_type=None,
        label="Read: Classes",
    )

    ics = plan_to_ics(
        [("OOP", make_schedule(late)), ("Data Structures", make_schedule(make_block()))],
        calendar_name="LearnSprint study plan",
    )

    assert "X-WR-CALNAME:LearnSprint study plan" in ics
    assert ics.count("BEGIN:VEVENT") == 2
    assert ics.index("SUMMARY:Study: Trees") < ics.index("SUMMARY:Study: Classes")
    assert "CATEGORIES:Data Structures" in ics
    assert "CATEGORIES:OOP" in ics


def test_produces_a_valid_calendar_envelope() -> None:
    ics = schedule_to_ics(make_schedule(make_block()), course_name="Data Structures")

    assert ics.startswith("BEGIN:VCALENDAR")
    assert ics.rstrip().endswith("END:VCALENDAR")


def test_one_event_per_block() -> None:
    ics = schedule_to_ics(make_schedule(make_block(), make_block()), course_name="DS")

    assert ics.count("BEGIN:VEVENT") == 2


def test_event_carries_the_block_times() -> None:
    ics = schedule_to_ics(make_schedule(make_block()), course_name="DS")

    assert "DTSTART:20260910T180000" in ics
    assert "DTEND:20260910T190000" in ics


def test_commas_in_names_are_escaped() -> None:
    # An unescaped comma would split the field and corrupt the import.
    ics = schedule_to_ics(make_schedule(make_block()), course_name="Data Structures, Algorithms")

    assert "CATEGORIES:Data Structures\\, Algorithms" in ics
    assert "X-WR-CALNAME:Data Structures\\, Algorithms study plan" in ics


def test_uses_crlf_line_endings() -> None:
    ics = schedule_to_ics(make_schedule(make_block()), course_name="DS")

    assert "\r\n" in ics


def test_empty_schedule_still_produces_a_valid_file() -> None:
    ics = schedule_to_ics(make_schedule(), course_name="DS")

    assert "BEGIN:VCALENDAR" in ics
    assert "BEGIN:VEVENT" not in ics
