"""Topic status rules and study velocity (FR4.2, FR7.1).

Pure functions - the board's behaviour is decided here, not in the React
component, so the same rules apply however the status is changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

BACKLOG = "backlog"
TODO = "todo"
IN_PROGRESS = "in_progress"
NEEDS_REVIEW = "needs_review"
DONE = "done"

STATUSES = (BACKLOG, TODO, IN_PROGRESS, NEEDS_REVIEW, DONE)

# A topic finished with mastery at or below this goes back for another pass.
NEEDS_REVIEW_MASTERY_THRESHOLD = 2


def derive_status(
    *,
    actions_done: int,
    total_actions: int,
    mastery_level: int | None,
    current_status: str,
) -> str:
    """Work out a topic's status from its actions and mastery rating.

    Manual placement in Backlog or To Do is respected while no action has been
    completed - that's the student planning ahead (FR4.3). Once real work
    happens the derived status takes over again.
    """
    if total_actions > 0 and actions_done >= total_actions:
        if mastery_level is None:
            # Everything is done but the rating hasn't been given yet, so the
            # UI can prompt for it. Until then the topic isn't finished.
            return IN_PROGRESS
        return NEEDS_REVIEW if mastery_level <= NEEDS_REVIEW_MASTERY_THRESHOLD else DONE

    if actions_done > 0:
        return IN_PROGRESS

    return current_status if current_status in (BACKLOG, TODO) else BACKLOG


def needs_mastery_prompt(*, actions_done: int, total_actions: int, mastery_level: int | None) -> bool:
    """True when all actions are done but the student hasn't rated the topic yet."""
    return total_actions > 0 and actions_done >= total_actions and mastery_level is None


@dataclass(frozen=True)
class WeeklyCount:
    """Actions completed in one past week, for the velocity chart."""

    week_start: str  # ISO date of the Sunday that week began
    completed: int


@dataclass(frozen=True)
class Velocity:
    """Study pace over recent weeks (FR7.1)."""

    actions_completed_this_week: int
    actions_completed_last_week: int
    weekly_average: float
    average_mastery: float | None
    trend: str  # "up", "down" or "steady"
    history: tuple[WeeklyCount, ...] = ()
    mastery_distribution: tuple[int, ...] = (0, 0, 0, 0, 0)  # counts for levels 1..5


def compute_velocity(
    completed_at: list[datetime], mastery_levels: list[int], *, now: datetime, weeks: int = 4
) -> Velocity:
    """Completed actions per week plus the average mastery so far.

    `now` is a parameter so the calculation is deterministic in tests.
    """
    week_start = now - timedelta(days=7)
    previous_week_start = now - timedelta(days=14)
    window_start = now - timedelta(weeks=weeks)

    this_week = sum(1 for stamp in completed_at if stamp >= week_start)
    last_week = sum(1 for stamp in completed_at if previous_week_start <= stamp < week_start)
    in_window = sum(1 for stamp in completed_at if stamp >= window_start)

    average_mastery = (
        round(sum(mastery_levels) / len(mastery_levels), 2) if mastery_levels else None
    )

    return Velocity(
        actions_completed_this_week=this_week,
        actions_completed_last_week=last_week,
        weekly_average=round(in_window / weeks, 2),
        average_mastery=average_mastery,
        trend=_trend(this_week, last_week),
        history=weekly_history(completed_at, now=now, weeks=6),
        mastery_distribution=mastery_distribution(mastery_levels),
    )


def weekly_history(
    completed_at: list[datetime], *, now: datetime, weeks: int = 6
) -> tuple[WeeklyCount, ...]:
    """Actions completed in each of the last `weeks` weeks, oldest first.

    Weeks with no activity are included as zero - a gap in the chart is real
    information, and dropping it would distort the shape of the trend.
    """
    buckets: list[WeeklyCount] = []

    for index in range(weeks - 1, -1, -1):
        window_end = now - timedelta(days=7 * index)
        window_start = window_end - timedelta(days=7)
        buckets.append(
            WeeklyCount(
                week_start=window_start.date().isoformat(),
                completed=sum(
                    1 for stamp in completed_at if window_start <= stamp < window_end
                ),
            )
        )

    return tuple(buckets)


def mastery_distribution(mastery_levels: list[int]) -> tuple[int, ...]:
    """How many topics sit at each mastery level 1..5.

    Shows the student where their weak spots are concentrated, which is what the
    FR3.2 review split acts on.
    """
    counts = [0, 0, 0, 0, 0]
    for level in mastery_levels:
        if 1 <= level <= 5:
            counts[level - 1] += 1
    return tuple(counts)


def _trend(this_week: int, last_week: int) -> str:
    if this_week > last_week:
        return "up"
    if this_week < last_week:
        return "down"
    return "steady"


def parse_timestamp(value: str | None) -> datetime | None:
    """Parse a stored ISO timestamp, tolerating missing or malformed values."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
