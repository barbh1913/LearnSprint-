"""Assembles the board view (FR4.1).

Joins the shared course content with the current user's private progress. The
join happens here in the application layer because DynamoDB can't do it - which
is the trade-off we accepted when choosing it (see ADR 0006).
"""

from __future__ import annotations

from typing import Any

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.domain import status as status_rules
from features.progress.infrastructure import repository as progress_repo


def build_board(user_id: str, course_id: str | None = None) -> dict[str, Any]:
    """Board for one course, or across every course the user is enrolled in.

    The global board (course_id=None) is what stops a student forgetting one
    subject while buried in another (FR1.4).
    """
    memberships = course_repo.list_memberships(user_id)
    if course_id is not None:
        memberships = [item for item in memberships if item["courseId"] == course_id]

    progress_by_topic = {
        item["topicId"]: item for item in progress_repo.list_topic_progress(user_id)
    }
    done_action_ids = {
        item["actionId"]
        for item in progress_repo.list_action_progress(user_id)
        if item.get("isDone")
    }

    cards: list[dict[str, Any]] = []
    for membership in memberships:
        current_course_id = membership["courseId"]
        topics = topic_repo.list_topics(current_course_id)
        actions_by_topic = _group_actions(topic_repo.list_actions(current_course_id))

        for topic in topics:
            actions = actions_by_topic.get(topic["id"], [])
            cards.append(
                _build_card(
                    topic=topic,
                    actions=actions,
                    progress=progress_by_topic.get(topic["id"]),
                    done_action_ids=done_action_ids,
                    course_name=membership.get("courseName", ""),
                    course_id=current_course_id,
                )
            )

    return {
        "columns": {name: [card for card in cards if card["status"] == name] for name in status_rules.STATUSES},
        "cards": cards,
        "totalTopics": len(cards),
        "doneTopics": sum(1 for card in cards if card["status"] == status_rules.DONE),
    }


def completion_percentage(user_id: str, course_id: str | None = None) -> int:
    """Share of learning actions completed, 0-100.

    This is the only progress figure exposed to other people (FR5.3) - coarse
    on purpose, so peers see momentum but not grades or schedules.
    """
    board = build_board(user_id, course_id)
    total = sum(len(card["actions"]) for card in board["cards"])
    if total == 0:
        return 0

    done = sum(
        1 for card in board["cards"] for action in card["actions"] if action["isDone"]
    )
    return round(done * 100 / total)


def _build_card(
    *,
    topic: dict[str, Any],
    actions: list[dict[str, Any]],
    progress: dict[str, Any] | None,
    done_action_ids: set[str],
    course_name: str,
    course_id: str,
) -> dict[str, Any]:
    action_views = [
        {
            "id": action["id"],
            "type": action["type"],
            "durationMinutes": action.get("defaultDurationMinutes", 30),
            "isDone": action["id"] in done_action_ids,
        }
        for action in actions
    ]
    actions_done = sum(1 for action in action_views if action["isDone"])
    mastery = progress.get("masteryLevel") if progress else None
    stored_status = progress.get("status", status_rules.BACKLOG) if progress else status_rules.BACKLOG

    return {
        "topicId": topic["id"],
        "courseId": course_id,
        "courseName": course_name,
        "name": topic["name"],
        "isPriority": topic.get("isPriority", False),
        "masteryLevel": mastery,
        "status": status_rules.derive_status(
            actions_done=actions_done,
            total_actions=len(action_views),
            mastery_level=mastery,
            current_status=stored_status,
        ),
        "needsMasteryRating": status_rules.needs_mastery_prompt(
            actions_done=actions_done, total_actions=len(action_views), mastery_level=mastery
        ),
        "actions": action_views,
        "actionsDone": actions_done,
        "totalMinutes": sum(action["durationMinutes"] for action in action_views),
    }


def _group_actions(actions: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for action in actions:
        grouped.setdefault(action["topicId"], []).append(action)
    return grouped
