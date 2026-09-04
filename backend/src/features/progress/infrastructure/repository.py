"""Per-user progress storage.

Progress is private, so it lives under the user's partition (PK=USER#<id>) and
never under the shared course partition. Two group members studying the same
topic each get their own row.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from shared import dynamo

TOPIC_PROGRESS_PREFIX = "TPROG#"
ACTION_PROGRESS_PREFIX = "APROG#"


def list_topic_progress(user_id: str) -> list[dict[str, Any]]:
    return dynamo.query_prefix(dynamo.user_pk(user_id), TOPIC_PROGRESS_PREFIX)


def list_action_progress(user_id: str) -> list[dict[str, Any]]:
    return dynamo.query_prefix(dynamo.user_pk(user_id), ACTION_PROGRESS_PREFIX)


def get_topic_progress(user_id: str, topic_id: str) -> dict[str, Any]:
    stored = dynamo.get_item(dynamo.user_pk(user_id), f"{TOPIC_PROGRESS_PREFIX}{topic_id}")
    if stored is not None:
        return stored

    return {
        "PK": dynamo.user_pk(user_id),
        "SK": f"{TOPIC_PROGRESS_PREFIX}{topic_id}",
        "entity": "UserTopicProgress",
        "userId": user_id,
        "topicId": topic_id,
        "status": "backlog",
        "masteryLevel": None,
    }


def save_topic_progress(progress: dict[str, Any]) -> dict[str, Any]:
    dynamo.put_item(progress)
    return progress


def set_action_done(user_id: str, action_id: str, topic_id: str, is_done: bool) -> dict[str, Any]:
    item = {
        "PK": dynamo.user_pk(user_id),
        "SK": f"{ACTION_PROGRESS_PREFIX}{action_id}",
        "entity": "UserActionProgress",
        "userId": user_id,
        "actionId": action_id,
        "topicId": topic_id,
        "isDone": is_done,
        "completedAt": datetime.now(timezone.utc).isoformat() if is_done else None,
    }
    dynamo.put_item(item)
    return item


def delete_topic_progress(user_id: str, topic_id: str, action_ids: list[str]) -> None:
    """Clean up a user's rows when a shared topic is deleted."""
    dynamo.delete_item(dynamo.user_pk(user_id), f"{TOPIC_PROGRESS_PREFIX}{topic_id}")
    for action_id in action_ids:
        dynamo.delete_item(dynamo.user_pk(user_id), f"{ACTION_PROGRESS_PREFIX}{action_id}")
