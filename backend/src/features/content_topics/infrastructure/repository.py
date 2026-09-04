"""Topic and learning-action storage.

Both live under the course partition (PK=COURSE#<id>), so one query returns the
whole course tree. Actions sort right after their topic because their SK starts
with the topic's SK.
"""

from __future__ import annotations

import uuid
from typing import Any

from shared import dynamo

# Default minutes per action type. Reading is the slowest, a quiz the quickest.
DEFAULT_DURATIONS = {"read": 60, "summarize": 45, "quiz": 30}
ACTION_TYPES = ("read", "summarize", "quiz")


def create_topic(course_id: str, name: str, *, is_priority: bool = False) -> dict[str, Any]:
    """Create a topic and its three learning actions (FR2.3)."""
    topic_id = str(uuid.uuid4())
    topic = {
        "PK": dynamo.course_pk(course_id),
        "SK": dynamo.topic_sk(topic_id),
        "entity": "Topic",
        "id": topic_id,
        "courseId": course_id,
        "name": name,
        "isPriority": is_priority,
    }
    dynamo.put_item(topic)

    for action_type in ACTION_TYPES:
        _create_action(course_id, topic_id, action_type)

    return topic


def list_topics(course_id: str) -> list[dict[str, Any]]:
    items = dynamo.query_prefix(dynamo.course_pk(course_id), "TOPIC#")
    return [item for item in items if item.get("entity") == "Topic"]


def list_actions(course_id: str) -> list[dict[str, Any]]:
    items = dynamo.query_prefix(dynamo.course_pk(course_id), "TOPIC#")
    return [item for item in items if item.get("entity") == "Action"]


def get_topic(course_id: str, topic_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.course_pk(course_id), dynamo.topic_sk(topic_id))


def update_topic(course_id: str, topic_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    topic = get_topic(course_id, topic_id)
    if topic is None:
        return None

    topic.update(changes)
    dynamo.put_item(topic)
    return topic


def delete_topic(course_id: str, topic_id: str) -> None:
    """Delete the topic and its actions. Progress rows are cleaned up by the caller."""
    for item in dynamo.query_prefix(dynamo.course_pk(course_id), dynamo.topic_sk(topic_id)):
        dynamo.delete_item(item["PK"], item["SK"])


def _create_action(course_id: str, topic_id: str, action_type: str) -> dict[str, Any]:
    action_id = str(uuid.uuid4())
    action = {
        "PK": dynamo.course_pk(course_id),
        "SK": dynamo.action_sk(topic_id, action_id),
        "entity": "Action",
        "id": action_id,
        "topicId": topic_id,
        "courseId": course_id,
        "type": action_type,
        "defaultDurationMinutes": DEFAULT_DURATIONS[action_type],
    }
    dynamo.put_item(action)
    return action
