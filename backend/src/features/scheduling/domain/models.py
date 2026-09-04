"""Value objects used by the scheduling algorithm (FR3.1-FR3.3).

Pure data - no DB, no framework. Everything the algorithm needs is passed in,
which is what makes it easy to unit test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from enum import Enum


class ActionType(str, Enum):
    """The three learning actions generated per topic (FR2.3)."""

    READ = "read"
    SUMMARIZE = "summarize"
    QUIZ = "quiz"


class TimePreference(str, Enum):
    MORNING = "morning"
    EVENING = "evening"


class ExamType(str, Enum):
    CLOSED = "closed"
    OPEN_MATERIAL = "open_material"
    FORMULA_SHEET = "formula_sheet"


class BlockType(str, Enum):
    ACTION = "action"
    REVIEW = "review"
    STUDY_AID = "study_aid"


@dataclass(frozen=True)
class BlockedSlot:
    """A recurring weekly commitment. day_of_week: Monday=0 (like date.weekday())."""

    day_of_week: int
    start_time: time
    end_time: time


@dataclass(frozen=True)
class PendingAction:
    """A learning action not done yet. Finished ones are filtered out before scheduling."""

    action_id: str
    topic_id: str
    action_type: ActionType
    duration_minutes: int


@dataclass(frozen=True)
class TopicToSchedule:
    """A topic plus the per-student data needed to weight it. mastery_level is None until rated."""

    topic_id: str
    name: str
    mastery_level: int | None
    is_priority: bool
    pending_actions: tuple[PendingAction, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ScheduledBlock:
    start: datetime
    end: datetime
    block_type: BlockType
    topic_id: str | None
    topic_name: str | None
    action_type: ActionType | None
    label: str

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclass(frozen=True)
class Schedule:
    blocks: tuple[ScheduledBlock, ...]
    is_emergency_mode: bool
    total_available_minutes: int
    total_needed_minutes: int


@dataclass(frozen=True)
class InfeasiblePlan:
    """Returned instead of a Schedule when even the reduced plan doesn't fit.

    We never silently overlap or truncate blocks - the user gets told how much
    time they need to free up.
    """

    reason: str
    available_minutes: int
    required_minutes: int

    @property
    def shortfall_minutes(self) -> int:
        return max(0, self.required_minutes - self.available_minutes)


SchedulingResult = Schedule | InfeasiblePlan
