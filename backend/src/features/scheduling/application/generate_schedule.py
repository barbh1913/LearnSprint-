"""Wires stored data into the allocation algorithm (FR3.1-FR3.3).

One plan per student (ADR 0011): every course with an exam date is scheduled
in turn, nearest exam first, and each course's sessions are handed to the next
course as occupied time - so the plans never overlap. A single course's
schedule is that course's entry in the combined plan, never a separate run.

The use case does the fetching and mapping; the algorithm itself stays pure and
knows nothing about DynamoDB. The result is never saved - see ADR 0005.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from typing import Any

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.infrastructure import repository as progress_repo
from features.scheduling.domain.allocation import generate_schedule, round_up_to_slot
from features.scheduling.domain.models import (
    ActionType,
    BlockedSlot,
    ExamType,
    PendingAction,
    Schedule,
    SchedulingResult,
    TimePreference,
    TopicToSchedule,
)


class CourseNotScheduled(Exception):
    """Raised when the course has no exam date, so there's nothing to plan towards."""


@dataclass(frozen=True)
class CoursePlan:
    """One course's slice of the student's combined plan."""

    course_id: str
    course_name: str
    exam_date: datetime
    result: SchedulingResult


def build_plan_for_student(user_id: str, *, now: datetime | None = None) -> list[CoursePlan]:
    """Every schedulable course, in the order it was given the hours: nearest exam first."""
    # Naive local time throughout: blocked slots are wall-clock ("09:00"), so
    # mixing in a UTC-aware `now` would compare apples to oranges.
    moment = round_up_to_slot(now or datetime.now())
    constraints = course_repo.get_constraints(user_id)

    courses = [
        course
        for course in (
            course_repo.get_course(membership["courseId"])
            for membership in course_repo.list_memberships(user_id)
        )
        if course is not None and course.get("examDate")
    ]
    courses.sort(key=_scheduling_order)

    plans: list[CoursePlan] = []
    occupied: list[tuple[datetime, datetime]] = []
    for course in courses:
        result = _schedule_course(user_id, course, constraints, now=moment, occupied=occupied)
        if isinstance(result, Schedule):
            occupied.extend((block.start, block.end) for block in result.blocks)
        plans.append(
            CoursePlan(
                course_id=course["id"],
                course_name=course.get("name", "Course"),
                exam_date=_parse_datetime(course["examDate"]),
                result=result,
            )
        )
    return plans


def build_schedule_for_course(
    user_id: str, course_id: str, *, now: datetime | None = None
) -> SchedulingResult:
    """This course's slice of the combined plan - the same times the all-courses view shows."""
    for plan in build_plan_for_student(user_id, now=now):
        if plan.course_id == course_id:
            return plan.result
    raise CourseNotScheduled(course_id)


def _scheduling_order(course: dict[str, Any]) -> tuple[datetime, str, str]:
    """Earliest exam first; a deterministic tie-breaker so equal dates never reorder between requests."""
    return (_parse_datetime(course["examDate"]), course.get("name", "").lower(), course["id"])


def _schedule_course(
    user_id: str,
    course: dict[str, Any],
    constraints: dict[str, Any],
    *,
    now: datetime,
    occupied: list[tuple[datetime, datetime]],
) -> SchedulingResult:
    course_id = course["id"]
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

    return generate_schedule(
        now=now,
        exam_date=_parse_datetime(course["examDate"]),
        topics=to_schedule,
        blocked_slots=[_to_blocked_slot(slot) for slot in constraints.get("blockedSlots", [])],
        time_preference=TimePreference(constraints.get("timePreference", "evening")),
        exam_type=ExamType(course.get("examType", "closed")),
        occupied=occupied,
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
