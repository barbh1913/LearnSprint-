"""The per-user Google Calendar connection (FR6.2).

One private item per student: the refresh token Google issued and the id of
the "LearnSprint" calendar the app created in their account. The token is only
ever read here, server-side - no router returns it (see ADR 0010).
"""

from __future__ import annotations

from typing import Any

from shared import dynamo

CONNECTION_SK = "GOOGLE_CALENDAR"


def get_connection(user_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.user_pk(user_id), CONNECTION_SK)


def save_connection(
    user_id: str,
    *,
    refresh_token: str,
    google_calendar_id: str,
    connected_at: str,
    last_synced_at: str | None = None,
) -> dict[str, Any]:
    item = {
        "PK": dynamo.user_pk(user_id),
        "SK": CONNECTION_SK,
        "entity": "GoogleCalendarConnection",
        "userId": user_id,
        "refreshToken": refresh_token,
        "googleCalendarId": google_calendar_id,
        "connectedAt": connected_at,
        "lastSyncedAt": last_synced_at,
    }
    dynamo.put_item(item)
    return item


def mark_synced(user_id: str, synced_at: str) -> None:
    connection = get_connection(user_id)
    if connection is None:
        return
    connection["lastSyncedAt"] = synced_at
    dynamo.put_item(connection)


def delete_connection(user_id: str) -> None:
    dynamo.delete_item(dynamo.user_pk(user_id), CONNECTION_SK)
