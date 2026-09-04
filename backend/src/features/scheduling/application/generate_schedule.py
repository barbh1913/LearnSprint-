"""Wires stored data into the allocation algorithm (FR3.1-FR3.3).

The use case does the fetching and mapping; the algorithm itself stays pure and
knows nothing about DynamoDB. The result is never saved - see ADR 0005.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Any

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.infrastructure import repository as progress_repo
from features.scheduling.domain.allocation import generate_schedule
from features.scheduling.domain.models import (
    ActionType,
    BlockedSlot,
    ExamType,
    PendingAction,
    SchedulingResult,
    TimePreference,
    TopicToSchedule,
)


class CourseNotScheduled(Exception):
    """Raised when the course has no exam date, so there's nothing to plan towards."""


def build_schedule_for_course(user_id: str, course_id: str, *, now: datetime | None = None) -> SchedulingResult:
    course = course_repo.get_course(course_id)
    if course is None or not course.get("examDate"):
        raise CourseNotScheduled(course_id)

    exam_date = _parse_datetime(course["examDate"])
    constraints = course_repo.get_constraints(user_id)

    topics = topic_repo.list_topics(course_id)
    actions_by_topic = _group_by_topic(topic_repo.list_actions(course_id))
    progress_by_topic = {
        item["topicId"]: item for item in progress_repo.list_topic_progress(user_id)
    }
    done_action_ids = {
        item["actionId"]
        for item in progress_repo.list_action_progress(user_id)
        if item.get("isDone")
    }

    to_schedule = [
        TopicToSchedule(
            topic_id=topic["id"],
            name=topic["name"],
            mastery_level=progress_by_topic.get(topic["id"], {}).get("masteryLevel"),
            is_priority=topic.get("isPriority", False),
            pending_actions=tuple(
                PendingAction(
                    action_id=action["id"],
                    topic_id=topic["id"],
                    action_type=ActionType(action["type"]),
                    duration_minutes=int(action.get("defaultDurationMinutes", 30)),
                )
                # Only what's left to do gets scheduled.
                for action in actions_by_topic.get(topic["id"], [])
                if action["id"] not in done_action_ids
            ),
        )
        for topic in topics
    ]

    # Naive local time throughout: blocked slots are wall-clock ("09:00"), so
    # mixing in a UTC-aware `now` would compare apples to oranges.
    return generate_schedule(
        now=now or datetime.now(),
        exam_date=exam_date,
        topics=to_schedule,
        blocked_slots=[_to_blocked_slot(slot) for slot in constraints.get("blockedSlots", [])],
        time_preference=TimePreference(constraints.get("timePreference", "evening")),
        exam_type=ExamType(course.get("examType", "closed")),
    )


def _group_by_topic(actions: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for action in actions:
        grouped.setdefault(action["topicId"], []).append(action)
    return grouped


def _to_blocked_slot(slot: dict[str, Any]) -> BlockedSlot:
    return BlockedSlot(
        day_of_week=int(slot["day"]),
        start_time=_parse_time(slot["startTime"]),
        end_time=_parse_time(slot["endTime"]),
    )


def _parse_time(value: str) -> time:
    hour, _, minute = value.partition(":")
    return time(int(hour), int(minute or 0))


def _parse_datetime(value: str) -> datetime:
    """Accept a plain date or a full timestamp; a bare date means 09:00 that day."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.hour == 0 and parsed.minute == 0:
        parsed = parsed.replace(hour=9)
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
