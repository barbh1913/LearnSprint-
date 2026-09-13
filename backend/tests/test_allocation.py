"""Tests for the scheduling algorithm (FR3.1-FR3.3).

Covers the three regimes (normal / emergency / infeasible) plus the edge cases
that are easy to get wrong: unrated mastery, all-equal mastery, rounding, and
blocked slots.
"""

from datetime import datetime, time

import pytest

from features.scheduling.domain.allocation import (
    compute_review_weights,
    find_available_windows,
    generate_schedule,
    split_minutes_by_weight,
)
from features.scheduling.domain.models import (
    ActionType,
    BlockedSlot,
    BlockType,
    ExamType,
    InfeasiblePlan,
    PendingAction,
    Schedule,
    TimePreference,
    TopicToSchedule,
)

NOW = datetime(2026, 9, 7, 8, 0)  # Monday morning


def make_topic(
    topic_id: str,
    *,
    mastery: int | None = 3,
    is_priority: bool = False,
    action_minutes: int = 60,
    action_count: int = 3,
) -> TopicToSchedule:
    """Topic with `action_count` pending actions of `action_minutes` each."""
    types = [ActionType.READ, ActionType.SUMMARIZE, ActionType.QUIZ]
    actions = tuple(
        PendingAction(
            action_id=f"{topic_id}-a{i}",
            topic_id=topic_id,
            action_type=types[i % len(types)],
            duration_minutes=action_minutes,
        )
        for i in range(action_count)
    )
    return TopicToSchedule(
        topic_id=topic_id,
        name=f"Topic {topic_id}",
        mastery_level=mastery,
        is_priority=is_priority,
        pending_actions=actions,
    )


class TestBlockIdentity:
    """The calendar opens the exact action behind an event (FR6.1), so action blocks must say which one."""

    def test_action_blocks_carry_their_action_id(self) -> None:
        topic = make_topic("t1")
        schedule = generate_schedule(
            now=NOW,
            exam_date=NOW.replace(day=NOW.day + 14),
            topics=[topic],
            blocked_slots=[],
            time_preference=TimePreference.EVENING,
        )

        assert isinstance(schedule, Schedule)
        action_blocks = [b for b in schedule.blocks if b.block_type == BlockType.ACTION]
        assert action_blocks
        assert {b.action_id for b in action_blocks} == {a.action_id for a in topic.pending_actions}

    def test_review_blocks_belong_to_no_single_action(self) -> None:
        schedule = generate_schedule(
            now=NOW,
            exam_date=NOW.replace(day=NOW.day + 14),
            topics=[make_topic("t1")],
            blocked_slots=[],
            time_preference=TimePreference.EVENING,
        )

        assert isinstance(schedule, Schedule)
        review_blocks = [b for b in schedule.blocks if b.block_type == BlockType.REVIEW]
        assert review_blocks
        assert all(b.action_id is None for b in review_blocks)


class TestReviewWeights:
    def test_lower_mastery_gets_more_weight(self) -> None:
        weights = compute_review_weights([make_topic("weak", mastery=1), make_topic("strong", mastery=5)])

        assert weights["weak"] > weights["strong"]

    def test_mastered_topic_still_gets_some_weight(self) -> None:
        weights = compute_review_weights([make_topic("t", mastery=5)])

        assert weights["t"] > 0

    def test_unrated_topics_all_weigh_the_same(self) -> None:
        weights = compute_review_weights([make_topic("a", mastery=None), make_topic("b", mastery=None)])

        assert weights["a"] == weights["b"]

    def test_priority_topic_outweighs_equal_mastery_peer(self) -> None:
        weights = compute_review_weights(
            [make_topic("core", mastery=3, is_priority=True), make_topic("side", mastery=3)]
        )

        assert weights["core"] > weights["side"]


class TestSplitByWeight:
    def test_split_is_proportional_to_weight(self) -> None:
        split = split_minutes_by_weight(300, {"weak": 5.0, "strong": 1.0})

        assert split["weak"] == 250
        assert split["strong"] == 50

    def test_equal_weights_split_evenly(self) -> None:
        split = split_minutes_by_weight(90, {"a": 3.0, "b": 3.0, "c": 3.0})

        assert split == {"a": 30, "b": 30, "c": 30}

    def test_no_minutes_lost_to_rounding(self) -> None:
        # 100 / 3 doesn't divide evenly - naive rounding would lose or invent a minute.
        split = split_minutes_by_weight(100, {"a": 1.0, "b": 1.0, "c": 1.0})

        assert sum(split.values()) == 100

    def test_zero_budget_gives_everyone_nothing(self) -> None:
        assert split_minutes_by_weight(0, {"a": 1.0}) == {"a": 0}


class TestAvailableWindows:
    def test_blocked_slot_is_carved_out_of_the_day(self) -> None:
        windows = find_available_windows(
            now=NOW,
            exam_date=datetime(2026, 9, 7, 23, 0),
            blocked_slots=[BlockedSlot(day_of_week=0, start_time=time(17, 0), end_time=time(19, 0))],
            time_preference=TimePreference.EVENING,
        )

        # Evening runs 15:00-23:00; work 17:00-19:00 splits it in two.
        assert len(windows) == 2
        assert windows[0] == (datetime(2026, 9, 7, 15, 0), datetime(2026, 9, 7, 17, 0))
        assert windows[1] == (datetime(2026, 9, 7, 19, 0), datetime(2026, 9, 7, 23, 0))

    def test_no_windows_when_exam_already_passed(self) -> None:
        windows = find_available_windows(
            now=NOW,
            exam_date=datetime(2026, 9, 1, 8, 0),
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert windows == []

    def test_windows_never_start_in_the_past(self) -> None:
        windows = find_available_windows(
            now=datetime(2026, 9, 7, 10, 0),
            exam_date=datetime(2026, 9, 7, 14, 0),
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert windows[0][0] == datetime(2026, 9, 7, 10, 0)


class TestGenerateSchedule:
    def test_normal_mode_schedules_actions_and_review(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a", mastery=2), make_topic("b", mastery=4)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert not result.is_emergency_mode
        block_types = {block.block_type for block in result.blocks}
        assert BlockType.ACTION in block_types
        assert BlockType.REVIEW in block_types

    def test_weaker_topic_gets_more_review_time(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("weak", mastery=1), make_topic("strong", mastery=5)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        review_by_topic = _review_minutes_by_topic(result)
        assert review_by_topic["weak"] > review_by_topic["strong"]

    def test_equal_mastery_splits_review_evenly(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a", mastery=3), make_topic("b", mastery=3)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        review_by_topic = _review_minutes_by_topic(result)
        assert abs(review_by_topic["a"] - review_by_topic["b"]) <= 1

    def test_unrated_mastery_does_not_crash_and_splits_evenly(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a", mastery=None), make_topic("b", mastery=None)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        review_by_topic = _review_minutes_by_topic(result)
        assert abs(review_by_topic["a"] - review_by_topic["b"]) <= 1

    def test_exam_tomorrow_switches_to_emergency_mode(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 8, 8, 0),  # one day away
            topics=[make_topic("a"), make_topic("b"), make_topic("c")],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert result.is_emergency_mode
        # Individual read/summarize/quiz blocks are dropped in this mode.
        assert all(block.block_type == BlockType.REVIEW for block in result.blocks)

    def test_emergency_mode_splits_time_equally(self) -> None:
        # Exam this afternoon: 6 hours free, but the full plan needs 7.5.
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 7, 14, 0),
            topics=[make_topic("weak", mastery=1), make_topic("strong", mastery=5)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert result.is_emergency_mode
        review_by_topic = _review_minutes_by_topic(result)
        # Equal split even though mastery differs - that's the point of this mode.
        assert abs(review_by_topic["weak"] - review_by_topic["strong"]) <= 1

    def test_no_free_time_at_all_is_infeasible(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 8, 8, 0),
            # Monday and Tuesday fully blocked across the whole study window.
            blocked_slots=[
                BlockedSlot(day_of_week=day, start_time=time(0, 0), end_time=time(23, 59))
                for day in range(7)
            ],
            topics=[make_topic("a")],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, InfeasiblePlan)
        assert result.shortfall_minutes > 0
        assert "free up" in result.reason.lower()

    def test_open_material_exam_reserves_study_aid_time(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a")],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
            exam_type=ExamType.OPEN_MATERIAL,
        )

        assert isinstance(result, Schedule)
        assert any(block.block_type == BlockType.STUDY_AID for block in result.blocks)

    def test_closed_exam_has_no_study_aid_time(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a")],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
            exam_type=ExamType.CLOSED,
        )

        assert isinstance(result, Schedule)
        assert not any(block.block_type == BlockType.STUDY_AID for block in result.blocks)

    def test_single_topic_gets_the_whole_review_session(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("only", mastery=2)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert _review_minutes_by_topic(result) == {"only": 60}

    def test_nothing_pending_produces_an_empty_plan(self) -> None:
        topic = TopicToSchedule(
            topic_id="done", name="Done", mastery_level=5, is_priority=False, pending_actions=()
        )

        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[topic],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert result.blocks == ()

    def test_blocks_never_overlap(self) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a"), make_topic("b"), make_topic("c")],
            blocked_slots=[BlockedSlot(day_of_week=2, start_time=time(8, 0), end_time=time(12, 0))],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        for earlier, later in zip(result.blocks, result.blocks[1:]):
            assert earlier.end <= later.start

    def test_blocks_never_land_inside_a_blocked_slot(self) -> None:
        blocked = BlockedSlot(day_of_week=0, start_time=time(9, 0), end_time=time(12, 0))

        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a")],
            blocked_slots=[blocked],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        for block in result.blocks:
            if block.start.weekday() == 0:
                assert not (time(9, 0) <= block.start.time() < time(12, 0))

    @pytest.mark.parametrize("mastery", [1, 2, 3, 4, 5])
    def test_every_mastery_level_produces_a_plan(self, mastery: int) -> None:
        result = generate_schedule(
            now=NOW,
            exam_date=datetime(2026, 9, 21, 8, 0),
            topics=[make_topic("a", mastery=mastery)],
            blocked_slots=[],
            time_preference=TimePreference.MORNING,
        )

        assert isinstance(result, Schedule)
        assert result.blocks


def _review_minutes_by_topic(schedule: Schedule) -> dict[str, int]:
    """Total review minutes per topic in a schedule."""
    totals: dict[str, int] = {}
    for block in schedule.blocks:
        if block.block_type is BlockType.REVIEW and block.topic_id:
            totals[block.topic_id] = totals.get(block.topic_id, 0) + block.duration_minutes
    return totals
