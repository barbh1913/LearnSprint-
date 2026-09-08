"""User storage on DynamoDB.

Email lookup goes through GSI1 (GSI1PK=EMAIL#<email>) because login only knows
the email, not the user id.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from shared import dynamo


def create_user(email: str, password_hash: str | None) -> dict[str, Any]:
    user_id = str(uuid.uuid4())
    item = {
        "PK": dynamo.user_pk(user_id),
        "SK": "PROFILE",
        "GSI1PK": f"EMAIL#{email.lower()}",
        "GSI1SK": dynamo.user_pk(user_id),
        "entity": "User",
        "id": user_id,
        "email": email.lower(),
        "passwordHash": password_hash,
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
    """The user for an email, created on first sight - used by Google sign-in.

    A user created this way has no password hash, so they can only ever get in
    through Cognito. If the email already exists as a password account, that
    account is returned, so one person never ends up with two.
    """
    existing = find_by_email(email)
    if existing is not None:
        return existing
    return create_user(email, password_hash=None)
