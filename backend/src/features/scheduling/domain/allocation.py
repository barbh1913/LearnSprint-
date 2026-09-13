"""The mastery-weighted study allocation algorithm (FR3.1-FR3.3).

The main idea: the weaker the student rates a topic, the bigger the slice of the
final review session it gets. That's what makes this a study planner and not
just a calendar.

Three cases, depending on how much free time is left before the exam:
  1. Normal   - every pending action gets a block + a mastery-weighted review session.
  2. Emergency - not enough time for individual actions, so we drop them and do one
                 review session split equally ("the exam is tomorrow").
  3. Infeasible - not even the emergency plan fits; we report the shortfall instead
                 of scheduling something impossible.

No I/O here on purpose - `now` is a parameter, not datetime.now(), so tests can pin it.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime, time, timedelta

from features.scheduling.domain.models import (
    BlockedSlot,
    BlockType,
    ExamType,
    InfeasiblePlan,
    Schedule,
    ScheduledBlock,
    SchedulingResult,
    TimePreference,
    TopicToSchedule,
)

# Nothing gets scheduled outside these hours, even if the slot is technically free -
# a planner that books 03:00 sessions is one nobody follows.
STUDY_DAY_BOUNDS: dict[TimePreference, tuple[time, time]] = {
    TimePreference.MORNING: (time(6, 0), time(14, 0)),
    TimePreference.EVENING: (time(15, 0), time(23, 0)),
}

# weight = 6 - mastery, so mastery 1 -> weight 5 and mastery 5 -> weight 1.
# Never reaches 0, so even mastered topics get a small slice of review.
MASTERY_WEIGHT_BASE = 6

# Unrated topics count as mid-confidence. This is what makes the "nothing rated yet"
# case degrade to an equal split instead of dividing by zero.
DEFAULT_MASTERY = 3

# So that the priority flag (FR2.6) actually affects the plan instead of being decorative.
PRIORITY_WEIGHT_MULTIPLIER = 1.5

REVIEW_SHARE_OF_ACTION_TIME = 0.25
MIN_REVIEW_MINUTES = 60
STUDY_AID_MINUTES = 60
MIN_EMERGENCY_MINUTES_PER_TOPIC = 10

# A window smaller than this isn't worth splitting a session into.
MIN_USABLE_BLOCK_MINUTES = 15

# Plans start on a clean clock boundary, not at the millisecond the request
# arrived: sessions read "16:00", export cleanly, and two requests a second
# apart produce the same plan.
PLAN_SLOT_MINUTES = 5


def round_up_to_slot(moment: datetime, slot_minutes: int = PLAN_SLOT_MINUTES) -> datetime:
    """The next slot boundary at or after `moment`, with seconds and microseconds dropped."""
    floored = moment.replace(second=0, microsecond=0)
    remainder = floored.minute % slot_minutes
    if remainder == 0 and floored == moment:
        return floored
    return floored + timedelta(minutes=slot_minutes - remainder)

# Absolute (start, end) intervals that are already taken - typically the
# sessions of a course with an earlier exam (ADR 0011). Removed from the free
# windows exactly like blocked hours, so plans for different courses never overlap.
Occupied = Sequence[tuple[datetime, datetime]]


def generate_schedule(
    *,
    now: datetime,
    exam_date: datetime,
    topics: list[TopicToSchedule],
    blocked_slots: list[BlockedSlot],
    time_preference: TimePreference,
    exam_type: ExamType = ExamType.CLOSED,
    occupied: Occupied = (),
) -> SchedulingResult:
    """Build a study plan for one course, or explain why none fits."""
    windows = find_available_windows(
        now=now,
        exam_date=exam_date,
        blocked_slots=blocked_slots,
        time_preference=time_preference,
        occupied=occupied,
    )
    available_minutes = sum(_window_minutes(window) for window in windows)

    schedulable_topics = [topic for topic in topics if topic.pending_actions]
    if not schedulable_topics:
        return Schedule(
            blocks=(),
            is_emergency_mode=False,
            total_available_minutes=available_minutes,
            total_needed_minutes=0,
        )

    action_minutes = sum(
        action.duration_minutes
        for topic in schedulable_topics
        for action in topic.pending_actions
    )
    study_aid_minutes = STUDY_AID_MINUTES if _needs_study_aid(exam_type) else 0
    review_minutes = _review_session_minutes(action_minutes)
    needed_minutes = action_minutes + study_aid_minutes + review_minutes

    if available_minutes >= needed_minutes:
        return _build_full_schedule(
            windows=windows,
            topics=schedulable_topics,
            review_minutes=review_minutes,
            study_aid_minutes=study_aid_minutes,
            available_minutes=available_minutes,
            needed_minutes=needed_minutes,
        )

    emergency_minimum = MIN_EMERGENCY_MINUTES_PER_TOPIC * len(schedulable_topics)
    if available_minutes >= emergency_minimum:
        return _build_emergency_schedule(
            windows=windows,
            topics=schedulable_topics,
            available_minutes=available_minutes,
            needed_minutes=needed_minutes,
        )

    return InfeasiblePlan(
        reason=(
            "Not enough free time before the exam to cover all topics, even as a "
            "single condensed review session. Free up blocked hours or move the date."
        ),
        available_minutes=available_minutes,
        required_minutes=emergency_minimum,
    )


def compute_review_weights(topics: list[TopicToSchedule]) -> dict[str, float]:
    """Score each topic by how much review time it deserves (FR3.2).

    Lower mastery -> higher weight. Priority topics get a boost.
    """
    weights: dict[str, float] = {}
    for topic in topics:
        mastery = topic.mastery_level if topic.mastery_level is not None else DEFAULT_MASTERY
        weight = float(MASTERY_WEIGHT_BASE - mastery)
        if topic.is_priority:
            weight *= PRIORITY_WEIGHT_MULTIPLIER
        weights[topic.topic_id] = weight
    return weights


def split_minutes_by_weight(
    total_minutes: int, weights: dict[str, float]
) -> dict[str, int]:
    """Divide minutes proportionally to weights, without losing any to rounding.

    Uses largest-remainder so the result always sums to exactly total_minutes.
    """
    if total_minutes <= 0 or not weights:
        return {topic_id: 0 for topic_id in weights}

    total_weight = sum(weights.values())
    if total_weight <= 0:
        return _split_evenly(total_minutes, list(weights))

    exact_shares = {
        topic_id: total_minutes * weight / total_weight
        for topic_id, weight in weights.items()
    }
    allocation = {topic_id: int(share) for topic_id, share in exact_shares.items()}

    # Give back the minutes lost to truncation, biggest fraction first.
    remaining = total_minutes - sum(allocation.values())
    by_remainder = sorted(
        exact_shares,
        key=lambda topic_id: exact_shares[topic_id] - allocation[topic_id],
        reverse=True,
    )
    for topic_id in by_remainder[:remaining]:
        allocation[topic_id] += 1

    return allocation


def find_available_windows(
    *,
    now: datetime,
    exam_date: datetime,
    blocked_slots: list[BlockedSlot],
    time_preference: TimePreference,
    occupied: Occupied = (),
) -> list[tuple[datetime, datetime]]:
    """Free study windows between now and the exam, with blocked slots and occupied time removed."""
    if exam_date <= now:
        return []

    day_start_time, day_end_time = STUDY_DAY_BOUNDS[time_preference]
    slots_by_day = _group_slots_by_day(blocked_slots)

    windows: list[tuple[datetime, datetime]] = []
    current_day = now.date()
    while current_day <= exam_date.date():
        day_window = _clamp_day_window(
            day=current_day,
            day_start_time=day_start_time,
            day_end_time=day_end_time,
            earliest=now,
            latest=exam_date,
        )
        if day_window is not None:
            free_ranges = _subtract_blocked_slots(
                day_window, slots_by_day.get(current_day.weekday(), []), current_day
            )
            free_ranges = _subtract_intervals(free_ranges, occupied)
            windows.extend(
                window
                for window in free_ranges
                if _window_minutes(window) >= MIN_USABLE_BLOCK_MINUTES
            )
        current_day += timedelta(days=1)

    return windows


def _build_full_schedule(
    *,
    windows: list[tuple[datetime, datetime]],
    topics: list[TopicToSchedule],
    review_minutes: int,
    study_aid_minutes: int,
    available_minutes: int,
    needed_minutes: int,
) -> Schedule:
    """Schedule all pending actions, then the weighted review session."""
    weights = compute_review_weights(topics)

    # Weakest topics first, so if the student falls behind it's the material
    # they already know that slips.
    topics_weakest_first = sorted(
        topics, key=lambda topic: weights[topic.topic_id], reverse=True
    )

    requests: list[_BlockRequest] = []
    for topic in topics_weakest_first:
        for action in topic.pending_actions:
            requests.append(
                _BlockRequest(
                    minutes=action.duration_minutes,
                    block_type=BlockType.ACTION,
                    topic_id=topic.topic_id,
                    topic_name=topic.name,
                    action_type=action.action_type,
                    label=f"{action.action_type.value.capitalize()}: {topic.name}",
                    action_id=action.action_id,
                )
            )

    if study_aid_minutes:
        requests.append(
            _BlockRequest(
                minutes=study_aid_minutes,
                block_type=BlockType.STUDY_AID,
                topic_id=None,
                topic_name=None,
                action_type=None,
                label="Prepare exam study aids",
            )
        )

    # Review goes last, closest to the exam - that's where a recap belongs.
    review_split = split_minutes_by_weight(review_minutes, weights)
    for topic in topics_weakest_first:
        minutes = review_split[topic.topic_id]
        if minutes <= 0:
            continue
        requests.append(
            _BlockRequest(
                minutes=minutes,
                block_type=BlockType.REVIEW,
                topic_id=topic.topic_id,
                topic_name=topic.name,
                action_type=None,
                label=f"Review: {topic.name}",
            )
        )

    return Schedule(
        blocks=tuple(_place_blocks(windows, requests)),
        is_emergency_mode=False,
        total_available_minutes=available_minutes,
        total_needed_minutes=needed_minutes,
    )


def _build_emergency_schedule(
    *,
    windows: list[tuple[datetime, datetime]],
    topics: list[TopicToSchedule],
    available_minutes: int,
    needed_minutes: int,
) -> Schedule:
    """One review session, split equally between topics.

    The split is equal and not mastery-weighted on purpose: with hours left,
    covering everything beats going deep on a few topics.
    """
    per_topic = _split_evenly(available_minutes, [topic.topic_id for topic in topics])

    requests = [
        _BlockRequest(
            minutes=per_topic[topic.topic_id],
            block_type=BlockType.REVIEW,
            topic_id=topic.topic_id,
            topic_name=topic.name,
            action_type=None,
            label=f"Crash review: {topic.name}",
        )
        for topic in topics
        if per_topic[topic.topic_id] > 0
    ]

    return Schedule(
        blocks=tuple(_place_blocks(windows, requests)),
        is_emergency_mode=True,
        total_available_minutes=available_minutes,
        total_needed_minutes=needed_minutes,
    )


class _BlockRequest:
    """"Schedule N minutes of X" - the caller says what, _place_blocks decides when."""

    __slots__ = (
        "minutes",
        "block_type",
        "topic_id",
        "topic_name",
        "action_type",
        "label",
        "action_id",
    )

    def __init__(
        self,
        minutes: int,
        block_type: BlockType,
        topic_id: str | None,
        topic_name: str | None,
        action_type: object | None,
        label: str,
        action_id: str | None = None,
    ) -> None:
        self.minutes = minutes
        self.block_type = block_type
        self.topic_id = topic_id
        self.topic_name = topic_name
        self.action_type = action_type
        self.label = label
        self.action_id = action_id


def _place_blocks(
    windows: list[tuple[datetime, datetime]], requests: list[_BlockRequest]
) -> list[ScheduledBlock]:
    """Lay the requested blocks into the free windows in order, no overlaps.

    A request longer than what's left in the current window spills into the next
    one, so a 3-hour action can span two evenings instead of being dropped.
    """
    blocks: list[ScheduledBlock] = []
    window_index = 0
    cursor = windows[0][0] if windows else None

    for request in requests:
        minutes_left = request.minutes
        while minutes_left > 0 and window_index < len(windows):
            window_start, window_end = windows[window_index]
            if cursor is None or cursor < window_start:
                cursor = window_start

            free_minutes = int((window_end - cursor).total_seconds() // 60)
            if free_minutes <= 0:
                window_index += 1
                cursor = windows[window_index][0] if window_index < len(windows) else None
                continue

            chunk = min(minutes_left, free_minutes)
            block_end = cursor + timedelta(minutes=chunk)
            blocks.append(
                ScheduledBlock(
                    start=cursor,
                    end=block_end,
                    block_type=request.block_type,
                    topic_id=request.topic_id,
                    topic_name=request.topic_name,
                    action_type=request.action_type,  # type: ignore[arg-type]
                    label=request.label,
                    action_id=request.action_id,
                )
            )
            cursor = block_end
            minutes_left -= chunk

    return blocks


def _split_evenly(total_minutes: int, keys: list[str]) -> dict[str, int]:
    """Equal split, remainder going to the first few keys."""
    if not keys or total_minutes <= 0:
        return {key: 0 for key in keys}

    base, remainder = divmod(total_minutes, len(keys))
    return {
        key: base + (1 if index < remainder else 0) for index, key in enumerate(keys)
    }


def _review_session_minutes(action_minutes: int) -> int:
    return max(MIN_REVIEW_MINUTES, round(action_minutes * REVIEW_SHARE_OF_ACTION_TIME))


def _needs_study_aid(exam_type: ExamType) -> bool:
    return exam_type in (ExamType.OPEN_MATERIAL, ExamType.FORMULA_SHEET)


def _window_minutes(window: tuple[datetime, datetime]) -> int:
    start, end = window
    return max(0, int((end - start).total_seconds() // 60))


def _group_slots_by_day(slots: list[BlockedSlot]) -> dict[int, list[BlockedSlot]]:
    grouped: dict[int, list[BlockedSlot]] = {}
    for slot in slots:
        grouped.setdefault(slot.day_of_week, []).append(slot)
    return grouped


def _clamp_day_window(
    *,
    day: date,
    day_start_time: time,
    day_end_time: time,
    earliest: datetime,
    latest: datetime,
) -> tuple[datetime, datetime] | None:
    """One day's study window, trimmed to the planning horizon. None if nothing is left."""
    start = datetime.combine(day, day_start_time, tzinfo=earliest.tzinfo)
    end = datetime.combine(day, day_end_time, tzinfo=earliest.tzinfo)

    start = max(start, earliest)
    end = min(end, latest)

    return (start, end) if end > start else None


def _subtract_blocked_slots(
    window: tuple[datetime, datetime], slots: list[BlockedSlot], day: date
) -> list[tuple[datetime, datetime]]:
    """Cut blocked commitments out of a day's window, returning what's left."""
    intervals = [
        (
            datetime.combine(day, slot.start_time, tzinfo=window[0].tzinfo),
            datetime.combine(day, slot.end_time, tzinfo=window[0].tzinfo),
        )
        for slot in slots
    ]
    return _subtract_intervals([window], intervals)


def _subtract_intervals(
    free: list[tuple[datetime, datetime]], intervals: Occupied
) -> list[tuple[datetime, datetime]]:
    """Remove every interval from the free ranges, splitting a range when an interval sits inside it."""
    for block_start, block_end in sorted(intervals):
        next_free: list[tuple[datetime, datetime]] = []
        for free_start, free_end in free:
            if block_end <= free_start or block_start >= free_end:
                next_free.append((free_start, free_end))
                continue
            if block_start > free_start:
                next_free.append((free_start, block_start))
            if block_end < free_end:
                next_free.append((block_end, free_end))
        free = next_free

    return free
