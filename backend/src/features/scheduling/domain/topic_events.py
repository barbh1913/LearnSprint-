"""Group the scheduler's per-action blocks into topic-level events (FR6.1, ADR 0012).

The allocation algorithm places one block per learning action. On a calendar
the student wants to see the topic - "Trees, 18:00-20:15" with its subtasks
inside - not three adjacent slivers. This is a pure step over the scheduler's
output: consecutive blocks of the same topic and kind become one event. A
blocked hour or a day boundary between them naturally keeps them apart, which
is right - the student is not studying in the gap.

The same events feed the screen, the .ics export and the Google sync, so all
three show the same thing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from features.scheduling.domain.models import BlockType, ScheduledBlock

STUDY = "study"
REVIEW = "review"
STUDY_AID = "study_aid"

KIND_OF_BLOCK = {
    BlockType.ACTION: STUDY,
    BlockType.REVIEW: REVIEW,
    BlockType.STUDY_AID: STUDY_AID,
}


@dataclass(frozen=True)
class TopicEventAction:
    action_id: str
    title: str
    minutes: int


@dataclass(frozen=True)
class TopicEvent:
    topic_id: str | None
    topic_name: str | None
    kind: str
    start: datetime
    end: datetime
    label: str
    actions: tuple[TopicEventAction, ...] = field(default_factory=tuple)

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


def group_blocks_into_topic_events(blocks: tuple[ScheduledBlock, ...] | list[ScheduledBlock]) -> list[TopicEvent]:
    """Merge consecutive blocks of one topic and kind into one event, in time order."""
    events: list[TopicEvent] = []

    for block in sorted(blocks, key=lambda item: item.start):
        kind = KIND_OF_BLOCK[block.block_type]
        previous = events[-1] if events else None

        if previous is not None and _continues(previous, block, kind):
            events[-1] = TopicEvent(
                topic_id=previous.topic_id,
                topic_name=previous.topic_name,
                kind=kind,
                start=previous.start,
                end=block.end,
                label=previous.label,
                actions=_with_action(previous.actions, block),
            )
            continue

        events.append(
            TopicEvent(
                topic_id=block.topic_id,
                topic_name=block.topic_name,
                kind=kind,
                start=block.start,
                end=block.end,
                label=_label(block, kind),
                actions=_with_action((), block),
            )
        )

    return events


def _continues(event: TopicEvent, block: ScheduledBlock, kind: str) -> bool:
    return event.kind == kind and event.topic_id == block.topic_id and event.end == block.start


def _label(block: ScheduledBlock, kind: str) -> str:
    # A study event is simply the topic; review and study-aid blocks already say what they are.
    return block.topic_name or block.label if kind == STUDY else block.label


def _with_action(actions: tuple[TopicEventAction, ...], block: ScheduledBlock) -> tuple[TopicEventAction, ...]:
    if block.action_id is None:
        return actions

    minutes = block.duration_minutes
    for index, action in enumerate(actions):
        if action.action_id == block.action_id:
            # The same subtask split across two windows that turned out to be contiguous.
            merged = TopicEventAction(action.action_id, action.title, action.minutes + minutes)
            return actions[:index] + (merged,) + actions[index + 1 :]

    return actions + (TopicEventAction(block.action_id, block.action_title or block.label, minutes),)
