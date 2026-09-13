"""Per-action blocks -> topic-level calendar events (FR6.1, ADR 0012)."""

from datetime import datetime

from features.scheduling.domain.models import ActionType, BlockType, ScheduledBlock
from features.scheduling.domain.topic_events import group_blocks_into_topic_events


def block(
    start: str,
    end: str,
    *,
    topic: str = "Trees",
    topic_id: str = "t1",
    block_type: BlockType = BlockType.ACTION,
    action_id: str | None = "a1",
    title: str = "Read",
) -> ScheduledBlock:
    is_action = block_type == BlockType.ACTION
    label = f"{title}: {topic}" if is_action else f"Review: {topic}"
    return ScheduledBlock(
        start=datetime.fromisoformat(start),
        end=datetime.fromisoformat(end),
        block_type=block_type,
        topic_id=topic_id,
        topic_name=topic,
        action_type=ActionType.READ if is_action else None,
        label=label if block_type != BlockType.STUDY_AID else "Prepare exam study aids",
        action_id=action_id if is_action else None,
        action_title=title if is_action else None,
    )


def test_consecutive_subtasks_of_one_topic_become_one_event() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-14T18:00", "2026-09-14T19:00", action_id="a1", title="Read"),
            block("2026-09-14T19:00", "2026-09-14T19:45", action_id="a2", title="Summarize"),
            block("2026-09-14T19:45", "2026-09-14T20:15", action_id="a3", title="Quiz"),
        ]
    )

    [event] = events
    assert (event.kind, event.label) == ("study", "Trees")
    assert (event.start.hour, event.end.hour, event.end.minute) == (18, 20, 15)
    assert event.duration_minutes == 135
    assert [(a.title, a.minutes) for a in event.actions] == [("Read", 60), ("Summarize", 45), ("Quiz", 30)]


def test_a_gap_keeps_sessions_apart() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-14T18:00", "2026-09-14T19:00", action_id="a1"),
            # A blocked hour in between.
            block("2026-09-14T20:00", "2026-09-14T20:45", action_id="a2", title="Summarize"),
        ]
    )

    assert len(events) == 2
    assert [e.actions[0].title for e in events] == ["Read", "Summarize"]


def test_a_day_boundary_keeps_sessions_apart() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-14T22:00", "2026-09-14T23:00", action_id="a1"),
            block("2026-09-15T15:00", "2026-09-15T15:45", action_id="a2", title="Summarize"),
        ]
    )

    assert len(events) == 2


def test_different_topics_never_merge_even_back_to_back() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-14T18:00", "2026-09-14T19:00", topic="Trees", topic_id="t1"),
            block("2026-09-14T19:00", "2026-09-14T20:00", topic="Graphs", topic_id="t2", action_id="b1"),
        ]
    )

    assert [e.label for e in events] == ["Trees", "Graphs"]


def test_the_review_session_is_its_own_event() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-14T18:00", "2026-09-14T19:00", action_id="a1"),
            block("2026-09-14T19:00", "2026-09-14T19:30", block_type=BlockType.REVIEW),
        ]
    )

    assert [(e.kind, e.label) for e in events] == [("study", "Trees"), ("review", "Review: Trees")]
    assert events[1].actions == ()


def test_study_aid_preparation_keeps_its_label() -> None:
    [event] = group_blocks_into_topic_events(
        [block("2026-09-14T18:00", "2026-09-14T19:00", block_type=BlockType.STUDY_AID, topic_id=None, topic="")]
    )

    assert (event.kind, event.label, event.topic_id) == ("study_aid", "Prepare exam study aids", None)


def test_one_subtask_split_across_contiguous_windows_counts_once() -> None:
    [event] = group_blocks_into_topic_events(
        [
            block("2026-09-14T18:00", "2026-09-14T18:30", action_id="a1"),
            block("2026-09-14T18:30", "2026-09-14T19:00", action_id="a1"),
        ]
    )

    assert [(a.action_id, a.minutes) for a in event.actions] == [("a1", 60)]


def test_events_come_out_in_time_order_whatever_the_input_order() -> None:
    events = group_blocks_into_topic_events(
        [
            block("2026-09-15T18:00", "2026-09-15T19:00", topic="Graphs", topic_id="t2", action_id="b1"),
            block("2026-09-14T18:00", "2026-09-14T19:00"),
        ]
    )

    assert [e.label for e in events] == ["Trees", "Graphs"]


def test_no_blocks_no_events() -> None:
    assert group_blocks_into_topic_events([]) == []
