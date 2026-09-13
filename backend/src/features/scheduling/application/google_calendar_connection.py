"""Connecting and disconnecting a student's Google Calendar (FR6.2).

Connecting means: trade Google's one-time code for a refresh token, create the
one "LearnSprint" calendar in the student's account, and remember both. The
plan itself is pushed separately (sync) - connecting stores nothing about it.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from features.scheduling.infrastructure import google_calendar
from features.scheduling.infrastructure import google_connection_repository as connections


class GoogleCalendarNotConfigured(Exception):
    """The backend has no Google OAuth client - the feature is switched off."""


def connection_status(user_id: str) -> dict[str, Any]:
    connection = connections.get_connection(user_id)
    return {
        "configured": google_calendar.is_configured(),
        "connected": connection is not None,
        "connectedAt": connection.get("connectedAt") if connection else None,
        "lastSyncedAt": connection.get("lastSyncedAt") if connection else None,
    }


def start_connection() -> tuple[str, str]:
    """The Google consent URL plus the state nonce the browser must see come back."""
    _require_configured()
    state = secrets.token_urlsafe(24)
    return google_calendar.build_authorize_url(state), state


def complete_connection(user_id: str, code: str) -> dict[str, Any]:
    _require_configured()
    tokens = google_calendar.exchange_code(code)
    access_token = tokens["access_token"]

    # Reconnecting replaces the calendar rather than leaving an orphan behind.
    # If the student picked a different Google account this time, the old one
    # simply isn't there to delete - that's fine.
    previous = connections.get_connection(user_id)
    if previous is not None:
        _quietly_delete_calendar(access_token, previous["googleCalendarId"])

    calendar_id = google_calendar.create_calendar(access_token)
    connections.save_connection(
        user_id,
        refresh_token=tokens["refresh_token"],
        google_calendar_id=calendar_id,
        connected_at=datetime.now().isoformat(timespec="seconds"),
    )
    return connection_status(user_id)


def disconnect(user_id: str) -> None:
    """Remove the app's calendar and the credential. Never fails on Google's account - the local record always goes."""
    connection = connections.get_connection(user_id)
    if connection is None:
        return

    try:
        access_token = google_calendar.refresh_access_token(connection["refreshToken"])
        _quietly_delete_calendar(access_token, connection["googleCalendarId"])
    except google_calendar.GoogleCalendarError:
        pass
    google_calendar.revoke_token(connection["refreshToken"])
    connections.delete_connection(user_id)


def _quietly_delete_calendar(access_token: str, calendar_id: str) -> None:
    try:
        google_calendar.delete_calendar(access_token, calendar_id)
    except google_calendar.GoogleCalendarError:
        pass


def _require_configured() -> None:
    if not google_calendar.is_configured():
        raise GoogleCalendarNotConfigured()
