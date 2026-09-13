"""Google's OAuth and Calendar endpoints over plain HTTP (ADR 0010).

A handful of REST calls, so no Google SDK: the token exchange, creating and
deleting the one calendar the app owns, and revoking access. Anything Google
rejects, or any network failure, surfaces as GoogleCalendarError so the use
case can turn it into a clear response instead of a stack trace.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from shared.config import settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
TIMEOUT_SECONDS = 15.0

CALENDAR_NAME = "LearnSprint"


class GoogleCalendarError(Exception):
    """Google said no, or could not be reached."""


class GoogleReconnectRequired(GoogleCalendarError):
    """The stored credential no longer works - revoked, or expired under Google's testing-mode limit."""


def is_configured() -> bool:
    return bool(
        settings.google_calendar_client_id
        and settings.google_calendar_client_secret
        and settings.google_calendar_redirect_uri
    )


def build_authorize_url(state: str) -> str:
    """Where to send the browser. `prompt=consent` + `access_type=offline` is what makes Google issue a refresh token."""
    params = {
        "client_id": settings.google_calendar_client_id,
        "redirect_uri": settings.google_calendar_redirect_uri,
        "response_type": "code",
        "scope": settings.google_calendar_scope,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict[str, Any]:
    """Trade the one-time code for tokens. Returns Google's token payload; the refresh token is what gets stored."""
    tokens = _json(
        _request(
            "POST",
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_calendar_client_id,
                "client_secret": settings.google_calendar_client_secret,
                "redirect_uri": settings.google_calendar_redirect_uri,
                "grant_type": "authorization_code",
            },
        ),
        "Google did not accept the sign-in code",
    )
    if not tokens.get("refresh_token"):
        raise GoogleCalendarError("Google did not return a refresh token - try connecting again")
    return tokens


def refresh_access_token(refresh_token: str) -> str:
    response = _request(
        "POST",
        TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": settings.google_calendar_client_id,
            "client_secret": settings.google_calendar_client_secret,
            "grant_type": "refresh_token",
        },
    )
    if response.status_code in (400, 401):
        # invalid_grant is Google's word for "this refresh token is dead".
        raise GoogleReconnectRequired("Google Calendar access has expired - connect it again")
    return _json(response, "Google did not renew access")["access_token"]


def create_calendar(access_token: str, summary: str = CALENDAR_NAME) -> str:
    calendar = _json(
        _request(
            "POST",
            f"{CALENDAR_API}/calendars",
            json={"summary": summary, "timeZone": settings.google_calendar_time_zone},
            access_token=access_token,
        ),
        "Google Calendar would not create the LearnSprint calendar",
    )
    return calendar["id"]


def delete_calendar(access_token: str, calendar_id: str) -> None:
    """Remove the app's calendar. Already gone counts as done."""
    response = _request(
        "DELETE", f"{CALENDAR_API}/calendars/{calendar_id}", access_token=access_token
    )
    if response.status_code not in (200, 204, 404, 410):
        raise GoogleCalendarError("Google Calendar would not delete the LearnSprint calendar")


def revoke_token(token: str) -> None:
    """Best effort: a revoke that fails leaves a dangling grant in the student's Google account, nothing worse."""
    try:
        _request("POST", REVOKE_URL, params={"token": token})
    except GoogleCalendarError:
        pass


def _request(
    method: str,
    url: str,
    *,
    access_token: str | None = None,
    **kwargs: Any,
) -> httpx.Response:
    headers = {"Authorization": f"Bearer {access_token}"} if access_token else {}
    try:
        return httpx.request(method, url, headers=headers, timeout=TIMEOUT_SECONDS, **kwargs)
    except httpx.HTTPError as exc:
        raise GoogleCalendarError("Google Calendar could not be reached") from exc


def _json(response: httpx.Response, failure_message: str) -> dict[str, Any]:
    if response.status_code >= 400:
        raise GoogleCalendarError(failure_message)
    return response.json()
