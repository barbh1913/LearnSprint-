"""Pure rules for topic time estimates (FR2.2).

A topic's estimate is the sum of its subtasks' minutes. Editing the topic total
re-splits it across the subtasks in proportion to what they had - the shape of
the work is kept, only the scale changes - so nothing has to store a second
"topic estimate" that could drift from the parts.
"""

from __future__ import annotations

MIN_SUBTASK_MINUTES = 10


def split_total_minutes(total_minutes: int, current_minutes: list[int]) -> list[int]:
    """Spread `total_minutes` over the subtasks in proportion to `current_minutes`.

    Uses largest-remainder rounding so the result sums to exactly the total, and
    never gives a subtask less than MIN_SUBTASK_MINUTES. Raises ValueError when
    the total cannot honour that floor.
    """
    count = len(current_minutes)
    if count == 0:
        raise ValueError("A topic needs at least one subtask")
    if total_minutes < MIN_SUBTASK_MINUTES * count:
        raise ValueError(f"At least {MIN_SUBTASK_MINUTES * count} minutes are needed for {count} subtasks")

    weights = [max(minutes, 0) for minutes in current_minutes]
    if sum(weights) == 0:
        weights = [1] * count

    total_weight = sum(weights)
    exact = [total_minutes * weight / total_weight for weight in weights]
    allocation = [max(MIN_SUBTASK_MINUTES, int(share)) for share in exact]

    # Hand the minutes lost to truncation (or taken by the floor) back, biggest
    # fraction first, until the total is exact.
    remaining = total_minutes - sum(allocation)
    order = sorted(range(count), key=lambda index: exact[index] - int(exact[index]), reverse=True)
    step = 1 if remaining > 0 else -1
    index = 0
    while remaining != 0:
        candidate = order[index % count]
        if step > 0 or allocation[candidate] > MIN_SUBTASK_MINUTES:
            allocation[candidate] += step
            remaining -= step
        index += 1

    return allocation
