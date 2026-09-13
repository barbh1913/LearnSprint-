"""Topic, learning-action and material storage.

All three live under the course partition (PK=COURSE#<id>), so one query returns
the whole course tree. Actions sort right after their topic because their SK
starts with the topic's SK; materials sit under their own MATERIAL# prefix and
carry the topic they belong to.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from shared import dynamo

# Default minutes per action type. Reading is the slowest, a quiz the quickest.
DEFAULT_DURATIONS = {"read": 60, "summarize": 45, "quiz": 30}
ACTION_TYPES = ("read", "summarize", "quiz")
DEFAULT_TITLES = {"read": "Read", "summarize": "Summarize", "quiz": "Quiz"}
CUSTOM_ACTION_TYPE = "custom"

# When we have a total study estimate for a topic (from the AI analysis), this is
# how it splits across the three actions - reading dominates, the quiz is a check.
DURATION_SPLIT = {"read": 0.5, "summarize": 0.3, "quiz": 0.2}
MIN_ACTION_MINUTES = 10

PRIORITIES = ("low", "medium", "high")
DEFAULT_PRIORITY = "medium"

MATERIAL_PREFIX = "MATERIAL#"


def create_topic(
    course_id: str,
    name: str,
    *,
    priority: str = DEFAULT_PRIORITY,
    description: str | None = None,
    total_minutes: int | None = None,
) -> dict[str, Any]:
    """Create a topic and its three default learning actions (FR2.3).

    `total_minutes` is the estimated study time for the whole topic; when given
    it is split across the actions instead of using the fixed defaults.
    """
    topic_id = str(uuid.uuid4())
    topic = {
        "PK": dynamo.course_pk(course_id),
        "SK": dynamo.topic_sk(topic_id),
        "entity": "Topic",
        "id": topic_id,
        "courseId": course_id,
        "name": name,
        "description": description,
        "priority": priority,
        # Kept alongside `priority` so everything that reads the flag - the
        # scheduler's boost above all - behaves exactly as before (ADR 0012).
        "isPriority": priority == "high",
    }
    dynamo.put_item(topic)

    for order, action_type in enumerate(ACTION_TYPES):
        _create_action(
            course_id,
            topic_id,
            action_type=action_type,
            title=DEFAULT_TITLES[action_type],
            duration_minutes=_duration_for(action_type, total_minutes),
            order=order,
        )

    return _read_topic(topic)


def _duration_for(action_type: str, total_minutes: int | None) -> int:
    if total_minutes is None:
        return DEFAULT_DURATIONS[action_type]

    return max(MIN_ACTION_MINUTES, round(total_minutes * DURATION_SPLIT[action_type]))


def list_topics(course_id: str) -> list[dict[str, Any]]:
    items = dynamo.query_prefix(dynamo.course_pk(course_id), "TOPIC#")
    return [_read_topic(item) for item in items if item.get("entity") == "Topic"]


def list_actions(course_id: str) -> list[dict[str, Any]]:
    """Every action in the course, each topic's in its display order."""
    items = dynamo.query_prefix(dynamo.course_pk(course_id), "TOPIC#")
    actions = [_read_action(item) for item in items if item.get("entity") == "Action"]
    return sorted(actions, key=lambda action: (action["topicId"], action["order"], action["id"]))


def get_topic(course_id: str, topic_id: str) -> dict[str, Any] | None:
    topic = dynamo.get_item(dynamo.course_pk(course_id), dynamo.topic_sk(topic_id))
    return _read_topic(topic) if topic else None


def update_topic(course_id: str, topic_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    topic = dynamo.get_item(dynamo.course_pk(course_id), dynamo.topic_sk(topic_id))
    if topic is None:
        return None

    topic.update(changes)
    if "priority" in changes:
        topic["isPriority"] = changes["priority"] == "high"
    dynamo.put_item(topic)
    return _read_topic(topic)


def get_action(course_id: str, topic_id: str, action_id: str) -> dict[str, Any] | None:
    action = dynamo.get_item(dynamo.course_pk(course_id), dynamo.action_sk(topic_id, action_id))
    return _read_action(action) if action else None


def create_action(
    course_id: str, topic_id: str, *, title: str, duration_minutes: int
) -> dict[str, Any]:
    """Add a custom subtask after the topic's existing ones (FR2.3)."""
    existing = [action for action in list_actions(course_id) if action["topicId"] == topic_id]
    next_order = max((action["order"] for action in existing), default=-1) + 1
    return _create_action(
        course_id,
        topic_id,
        action_type=CUSTOM_ACTION_TYPE,
        title=title,
        duration_minutes=duration_minutes,
        order=next_order,
    )


def update_action(
    course_id: str, topic_id: str, action_id: str, changes: dict[str, Any]
) -> dict[str, Any] | None:
    action = dynamo.get_item(dynamo.course_pk(course_id), dynamo.action_sk(topic_id, action_id))
    if action is None:
        return None

    action.update(changes)
    dynamo.put_item(action)
    return _read_action(action)


def delete_action(course_id: str, topic_id: str, action_id: str) -> None:
    dynamo.delete_item(dynamo.course_pk(course_id), dynamo.action_sk(topic_id, action_id))


def set_action_minutes(course_id: str, topic_id: str, minutes_by_action_id: dict[str, int]) -> None:
    """Write a re-split of the topic's estimate back to its subtasks."""
    for action_id, minutes in minutes_by_action_id.items():
        update_action(course_id, topic_id, action_id, {"defaultDurationMinutes": minutes})


def delete_topic(course_id: str, topic_id: str) -> None:
    """Delete the topic and its actions. Progress rows and materials are cleaned up by the caller."""
    for item in dynamo.query_prefix(dynamo.course_pk(course_id), dynamo.topic_sk(topic_id)):
        dynamo.delete_item(item["PK"], item["SK"])


# --- Materials (FR2.9) -------------------------------------------------------


def create_material(
    *,
    user_id: str,
    course_id: str,
    topic_id: str,
    file_name: str,
    s3_key: str,
    size_bytes: int,
) -> dict[str, Any]:
    material_id = str(uuid.uuid4())
    item = {
        "PK": dynamo.course_pk(course_id),
        "SK": f"{MATERIAL_PREFIX}{material_id}",
        "entity": "Material",
        "id": material_id,
        "userId": user_id,
        "courseId": course_id,
        "topicId": topic_id,
        "fileName": file_name,
        "s3Key": s3_key,
        "fileType": _file_type(file_name),
        "sizeBytes": size_bytes,
        "uploadedAt": datetime.now().isoformat(timespec="seconds"),
    }
    dynamo.put_item(item)
    return item


def get_material(course_id: str, material_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.course_pk(course_id), f"{MATERIAL_PREFIX}{material_id}")


def list_topic_materials(course_id: str, topic_id: str) -> list[dict[str, Any]]:
    """Every material on the topic, whoever uploaded it - callers filter by owner."""
    items = dynamo.query_prefix(dynamo.course_pk(course_id), MATERIAL_PREFIX)
    return sorted(
        (item for item in items if item.get("topicId") == topic_id),
        key=lambda item: (item.get("uploadedAt", ""), item.get("fileName", "").lower()),
    )


def delete_material(course_id: str, material_id: str) -> None:
    dynamo.delete_item(dynamo.course_pk(course_id), f"{MATERIAL_PREFIX}{material_id}")


def _file_type(file_name: str) -> str:
    _, dot, extension = file_name.rpartition(".")
    return extension.lower() if dot and extension else ""


# --- Reading items ------------------------------------------------------------


def _read_topic(item: dict[str, Any]) -> dict[str, Any]:
    """A topic as the rest of the app sees it, however old the stored item is.

    Items written before priority levels carry only `isPriority`; they read as
    `high` when flagged and `medium` otherwise (ADR 0012).
    """
    topic = dict(item)
    if "priority" not in topic:
        topic["priority"] = "high" if topic.get("isPriority") else DEFAULT_PRIORITY
    topic["isPriority"] = topic["priority"] == "high"
    topic.setdefault("description", None)
    return topic


def _read_action(item: dict[str, Any]) -> dict[str, Any]:
    """An action as a subtask: older items get their title and order from their type."""
    action = dict(item)
    action.setdefault("title", DEFAULT_TITLES.get(action.get("type", ""), action.get("type", "")))
    if "order" not in action:
        action["order"] = ACTION_TYPES.index(action["type"]) if action.get("type") in ACTION_TYPES else len(ACTION_TYPES)
    return action


def _create_action(
    course_id: str,
    topic_id: str,
    *,
    action_type: str,
    title: str,
    duration_minutes: int,
    order: int,
) -> dict[str, Any]:
    action_id = str(uuid.uuid4())
    action = {
        "PK": dynamo.course_pk(course_id),
        "SK": dynamo.action_sk(topic_id, action_id),
        "entity": "Action",
        "id": action_id,
        "topicId": topic_id,
        "courseId": course_id,
        "type": action_type,
        "title": title,
        "order": order,
        "defaultDurationMinutes": duration_minutes,
    }
    dynamo.put_item(action)
    return action
