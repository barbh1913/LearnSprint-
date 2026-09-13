"""Schedule -> Google Calendar event payloads (FR6.2)."""

from datetime import datetime

from features.scheduling.domain.google_events import course_filter, schedule_to_google_events
from features.scheduling.domain.models import ActionType, BlockType, Schedule, ScheduledBlock


def make_block(block_type: BlockType = BlockType.ACTION, label: str = "Read: Trees") -> ScheduledBlock:
    return ScheduledBlock(
        start=datetime(2026, 9, 10, 18, 0),
        end=datetime(2026, 9, 10, 19, 30),
        block_type=block_type,
        topic_id="t1",
        topic_name="Trees",
        action_type=ActionType.READ if block_type == BlockType.ACTION else None,
        label=label,
        action_id="a1" if block_type == BlockType.ACTION else None,
        action_title="Read" if block_type == BlockType.ACTION else None,
    )


def make_schedule(*blocks: ScheduledBlock) -> Schedule:
    return Schedule(blocks=blocks, is_emergency_mode=False, total_available_minutes=600, total_needed_minutes=90)


def test_times_are_wall_clock_with_an_explicit_zone() -> None:
    [event] = schedule_to_google_events(
        make_schedule(make_block()), course_id="c1", course_name="DS", time_zone="Asia/Jerusalem"
    )

    assert event["start"] == {"dateTime": "2026-09-10T18:00:00", "timeZone": "Asia/Jerusalem"}
    assert event["end"] == {"dateTime": "2026-09-10T19:30:00", "timeZone": "Asia/Jerusalem"}
    assert event["summary"] == "Study: Trees"
    assert "Read (90 min)" in event["description"]


def test_every_event_is_tagged_with_its_course() -> None:
    events = schedule_to_google_events(
        make_schedule(make_block(), make_block(BlockType.REVIEW, "Review: Trees")),
        course_id="c1",
        course_name="DS",
        time_zone="Asia/Jerusalem",
    )

    assert all(event["extendedProperties"]["private"]["learnsprintCourseId"] == "c1" for event in events)
    assert course_filter("c1") == "learnsprintCourseId=c1"


def test_description_says_what_kind_of_session_and_which_course() -> None:
    [event] = schedule_to_google_events(
        make_schedule(make_block(BlockType.STUDY_AID, "Prepare exam study aids")),
        course_id="c1",
        course_name="Data Structures",
        time_zone="Asia/Jerusalem",
    )

    assert "formula sheet" in event["description"]
    assert event["description"].endswith("Data Structures")


def test_an_empty_plan_produces_no_events() -> None:
    assert schedule_to_google_events(make_schedule(), course_id="c1", course_name="DS", time_zone="UTC") == []
