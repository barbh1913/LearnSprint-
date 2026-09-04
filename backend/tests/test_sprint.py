"""Tests for weekly sprint planning - capacity vs. commitment."""

from datetime import datetime, time

from features.progress.domain.sprint import (
    build_sprint_plan,
    compute_capacity_minutes,
    current_sprint_window,
)
from features.scheduling.domain.models import BlockedSlot, TimePreference

# Wednesday 2026-09-09, mid-sprint.
MIDWEEK = datetime(2026, 9, 9, 10, 0)
SUNDAY = datetime(2026, 9, 6, 0, 0)


def plan(
    *,
    now: datetime = SUNDAY,
    committed: int = 0,
    completed: int = 0,
    topics: int = 0,
    blocked: list[BlockedSlot] | None = None,
):
    return build_sprint_plan(
        now=now,
        blocked_slots=blocked or [],
        time_preference=TimePreference.EVENING,
        committed_minutes=committed,
        completed_minutes=completed,
        topic_count=topics,
    )


class TestSprintWindow:
    def test_sprint_runs_from_sunday(self) -> None:
        window = current_sprint_window(SUNDAY)

        assert window.start.weekday() == 6  # Sunday

    def test_midweek_sprint_starts_now_not_last_sunday(self) -> None:
        # Capacity should reflect hours actually left, not hours already spent.
        window = current_sprint_window(MIDWEEK)

        assert window.start == MIDWEEK

    def test_sprint_is_one_week_long(self) -> None:
        window = current_sprint_window(SUNDAY)

        assert (window.end - window.start).days == 7


class TestCapacity:
    def test_capacity_is_the_free_evening_hours(self) -> None:
        # Evenings run 15:00-23:00, so a clear week is 7 x 8 hours.
        minutes = compute_capacity_minutes(
            window=current_sprint_window(SUNDAY),
            blocked_slots=[],
            time_preference=TimePreference.EVENING,
        )

        assert minutes == 7 * 8 * 60

    def test_blocked_hours_reduce_capacity(self) -> None:
        window = current_sprint_window(SUNDAY)
        clear = compute_capacity_minutes(
            window=window, blocked_slots=[], time_preference=TimePreference.EVENING
        )

        with_work = compute_capacity_minutes(
            window=window,
            blocked_slots=[
                BlockedSlot(day_of_week=0, start_time=time(15, 0), end_time=time(23, 0))
            ],
            time_preference=TimePreference.EVENING,
        )

        assert with_work == clear - 8 * 60

    def test_fully_blocked_week_has_no_capacity(self) -> None:
        minutes = compute_capacity_minutes(
            window=current_sprint_window(SUNDAY),
            blocked_slots=[
                BlockedSlot(day_of_week=day, start_time=time(0, 0), end_time=time(23, 59))
                for day in range(7)
            ],
            time_preference=TimePreference.EVENING,
        )

        assert minutes == 0


class TestCommitmentStatus:
    def test_nothing_committed_is_empty(self) -> None:
        assert plan().status == "empty"

    def test_light_commitment_is_healthy(self) -> None:
        assert plan(committed=600, topics=3).status == "healthy"

    def test_commitment_beyond_capacity_is_over_committed(self) -> None:
        # A clear evening week is 3360 minutes.
        assert plan(committed=5000, topics=20).status == "over_committed"

    def test_nearly_full_week_is_tight(self) -> None:
        # 90% of 3360 is past the healthy threshold but still fits.
        assert plan(committed=3024, topics=10).status == "tight"

    def test_fully_blocked_week_reports_no_capacity(self) -> None:
        blocked = [
            BlockedSlot(day_of_week=day, start_time=time(0, 0), end_time=time(23, 59))
            for day in range(7)
        ]

        assert plan(committed=300, topics=2, blocked=blocked).status == "no_capacity"


class TestRemainingCapacity:
    def test_remaining_capacity_is_capacity_minus_commitment(self) -> None:
        result = plan(committed=1000)

        assert result.remaining_capacity_minutes == result.capacity_minutes - 1000

    def test_over_commitment_shows_a_negative_remainder(self) -> None:
        assert plan(committed=5000).remaining_capacity_minutes < 0

    def test_commitment_ratio_reflects_the_load(self) -> None:
        result = plan(committed=1680)  # exactly half of 3360

        assert result.commitment_ratio == 0.5

    def test_ratio_is_zero_when_nothing_is_committed(self) -> None:
        assert plan().commitment_ratio == 0.0
