"""User profile storage on DynamoDB.

Only the LearnSprint profile lives here - the credential is Cognito's
(ADR 0014). Email lookup goes through GSI1 (GSI1PK=EMAIL#<email>) because
login only knows the email, not the user id.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from shared import dynamo


def create_user(email: str) -> dict[str, Any]:
    user_id = str(uuid.uuid4())
    item = {
        "PK": dynamo.user_pk(user_id),
        "SK": "PROFILE",
        "GSI1PK": f"EMAIL#{email.lower()}",
        "GSI1SK": dynamo.user_pk(user_id),
        "entity": "User",
        "id": user_id,
        "email": email.lower(),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    dynamo.put_item(item)
    return item


def find_by_email(email: str) -> dict[str, Any] | None:
    matches = dynamo.query_gsi1(f"EMAIL#{email.lower()}")
    return matches[0] if matches else None


def find_by_id(user_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.user_pk(user_id), "PROFILE")


def find_or_create_by_email(email: str) -> dict[str, Any]:
    """The profile for an email, created on first sight.

    Whether the person arrived with a password or through Google, the same
    address is the same account, so a student's courses never split depending
    on which button they pressed.
    """
    existing = find_by_email(email)
    if existing is not None:
        return existing
    return create_user(email)


def delete_everything_under(user_id: str) -> None:
    """Every row in the user's own partition: profile, memberships, progress, constraints, connections."""
    for item in dynamo.query_prefix(dynamo.user_pk(user_id)):
        dynamo.delete_item(item["PK"], item["SK"])
