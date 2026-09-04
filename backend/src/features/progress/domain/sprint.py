"""Weekly sprint planning (the core idea of LearnSprint).

A sprint is one week. The student commits to a set of topics, and the system
says upfront whether that commitment actually fits the hours they have left
after work and lectures - before the week starts, not after it fails.

Capacity comes from the same free-window calculation the scheduler uses, so the
number shown here is the number the schedule will actually be built from.

Pure functions, no I/O - `now` is a parameter so tests can pin the week.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from features.scheduling.domain.allocation import find_available_windows
from features.scheduling.domain.models import BlockedSlot, TimePreference

# A sprint runs Sunday to Saturday - the Israeli academic week.
SPRINT_START_WEEKDAY = 6  # Sunday, in date.weekday() terms

# Committing past this share of capacity is where plans start slipping, so the
# board warns before the student is technically over-committed.
HEALTHY_COMMITMENT_RATIO = 0.85


@dataclass(frozen=True)
class SprintWindow:
    """The calendar week a sprint covers."""

    start: datetime
    end: datetime

    @property
    def days_remaining(self) -> int:
        return max(0, (self.end.date() - self.start.date()).days)


@dataclass(frozen=True)
class SprintPlan:
    """Capacity vs. commitment for the current week."""

    window: SprintWindow
    capacity_minutes: int
    committed_minutes: int
    completed_minutes: int
    topic_count: int

    @property
    def remaining_capacity_minutes(self) -> int:
        """Free time left after what's already committed. Negative means over-committed."""
        return self.capacity_minutes - self.committed_minutes

    @property
    def commitment_ratio(self) -> float:
        """Committed time as a share of capacity. Above 1.0 means it doesn't fit."""
        if self.capacity_minutes <= 0:
            return 0.0 if self.committed_minutes == 0 else float("inf")
        return round(self.committed_minutes / self.capacity_minutes, 2)

    @property
    def status(self) -> str:
        """How healthy this sprint's commitment looks.

        `empty` - nothing committed yet
        `no_capacity` - the week is fully blocked out
        `over_committed` - more work than hours
        `tight` - fits, but with little slack
        `healthy` - comfortable
        """
        if self.capacity_minutes <= 0:
            return "no_capacity"
        if self.committed_minutes == 0:
            return "empty"
        if self.committed_minutes > self.capacity_minutes:
            return "over_committed"
        if self.commitment_ratio > HEALTHY_COMMITMENT_RATIO:
            return "tight"
        return "healthy"


def current_sprint_window(now: datetime) -> SprintWindow:
    """The sprint week containing `now`, clamped so it starts no earlier than now.

    Mid-week the window starts at the current moment rather than last Sunday -
    capacity should reflect the hours actually left, not hours already spent.
    """
    days_since_start = (now.weekday() - SPRINT_START_WEEKDAY) % 7
    week_start = (now - timedelta(days=days_since_start)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    week_end = week_start + timedelta(days=7)

    return SprintWindow(start=max(now, week_start), end=week_end)


def compute_capacity_minutes(
    *,
    window: SprintWindow,
    blocked_slots: list[BlockedSlot],
    time_preference: TimePreference,
) -> int:
    """Free study minutes left in the sprint week.

    Reuses the scheduler's window calculation so the capacity the student is
    planning against is the same capacity the schedule is built from.
    """
    windows = find_available_windows(
        now=window.start,
        exam_date=window.end,
        blocked_slots=blocked_slots,
        time_preference=time_preference,
    )
    return sum(
        int((end - start).total_seconds() // 60) for start, end in windows
    )


def build_sprint_plan(
    *,
    now: datetime,
    blocked_slots: list[BlockedSlot],
    time_preference: TimePreference,
    committed_minutes: int,
    completed_minutes: int,
    topic_count: int,
) -> SprintPlan:
    """Assemble this week's sprint: how much time exists vs. how much was committed."""
    window = current_sprint_window(now)

    return SprintPlan(
        window=window,
        capacity_minutes=compute_capacity_minutes(
            window=window, blocked_slots=blocked_slots, time_preference=time_preference
        ),
        committed_minutes=committed_minutes,
        completed_minutes=completed_minutes,
        topic_count=topic_count,
    )
