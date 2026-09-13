"""Google's OAuth and Calendar endpoints over plain HTTP (ADR 0010).

A handful of REST calls, so no Google SDK: the token exchange, creating and
deleting the one calendar the app owns, and revoking access. Anything Google
rejects, or any network failure, surfaces as GoogleCalendarError so the use
case can turn it into a clear response instead of a stack trace.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any
from urllib.parse import urlencode

import httpx

from shared.config import settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
BATCH_URL = "https://www.googleapis.com/batch/calendar/v3"
TIMEOUT_SECONDS = 15.0

CALENDAR_NAME = "LearnSprint"

# Google caps a batch at 50 sub-requests; one HTTP round-trip per 50 events
# instead of one per event is what keeps a sync inside a normal request.
BATCH_SIZE = 50
LIST_PAGE_SIZE = 2500

_SUB_STATUS = re.compile(r"^HTTP/1\.1 (\d{3})", re.MULTILINE)


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


def list_event_ids(access_token: str, calendar_id: str, private_property: str) -> list[str]:
    """Ids of the events carrying one private property - i.e. one course's sessions - across all pages."""
    ids: list[str] = []
    page_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "privateExtendedProperty": private_property,
            "fields": "items/id,nextPageToken",
            "maxResults": LIST_PAGE_SIZE,
        }
        if page_token:
            params["pageToken"] = page_token
        page = _json(
            _request(
                "GET",
                f"{CALENDAR_API}/calendars/{calendar_id}/events",
                params=params,
                access_token=access_token,
            ),
            "Google Calendar would not list the LearnSprint events",
        )
        ids.extend(item["id"] for item in page.get("items", []))
        page_token = page.get("nextPageToken")
        if not page_token:
            return ids


def delete_events(access_token: str, calendar_id: str, event_ids: list[str]) -> None:
    for chunk in _chunks(event_ids):
        _batch(
            access_token,
            [(f"DELETE /calendar/v3/calendars/{calendar_id}/events/{event_id}", None) for event_id in chunk],
            # An event someone already removed by hand is not a failed delete.
            allowed_statuses={404, 410},
            failure_message="Google Calendar would not remove the previous sessions",
        )


def insert_events(access_token: str, calendar_id: str, events: list[dict[str, Any]]) -> None:
    for chunk in _chunks(events):
        _batch(
            access_token,
            [(f"POST /calendar/v3/calendars/{calendar_id}/events", event) for event in chunk],
            allowed_statuses=set(),
            failure_message="Google Calendar would not add the sessions",
        )


def revoke_token(token: str) -> None:
    """Best effort: a revoke that fails leaves a dangling grant in the student's Google account, nothing worse."""
    try:
        _request("POST", REVOKE_URL, params={"token": token})
    except GoogleCalendarError:
        pass


def _batch(
    access_token: str,
    parts: list[tuple[str, dict[str, Any] | None]],
    *,
    allowed_statuses: set[int],
    failure_message: str,
) -> None:
    """One multipart/mixed request carrying up to BATCH_SIZE Calendar calls.

    Google answers with one HTTP status per part; anything outside 2xx (or the
    caller's allowed set) fails the whole sync, so a half-written calendar is
    reported rather than silently left behind.
    """
    boundary = f"learnsprint_{uuid.uuid4().hex}"
    body = "".join(_batch_part(boundary, index, request_line, payload) for index, (request_line, payload) in enumerate(parts))
    body += f"--{boundary}--\r\n"

    response = _request(
        "POST",
        BATCH_URL,
        content=body.encode("utf-8"),
        headers={"Content-Type": f"multipart/mixed; boundary={boundary}"},
        access_token=access_token,
    )
    if response.status_code >= 400:
        raise GoogleCalendarError(failure_message)

    statuses = [int(code) for code in _SUB_STATUS.findall(response.text)]
    if len(statuses) != len(parts) or any(
        not (200 <= status < 300) and status not in allowed_statuses for status in statuses
    ):
        raise GoogleCalendarError(failure_message)


def _batch_part(boundary: str, index: int, request_line: str, payload: dict[str, Any] | None) -> str:
    head = (
        f"--{boundary}\r\n"
        "Content-Type: application/http\r\n"
        f"Content-ID: <item{index}>\r\n\r\n"
        f"{request_line}\r\n"
    )
    if payload is None:
        return head + "\r\n"
    return head + "Content-Type: application/json\r\n\r\n" + json.dumps(payload) + "\r\n"


def _chunks(items: list[Any]) -> list[list[Any]]:
    return [items[start : start + BATCH_SIZE] for start in range(0, len(items), BATCH_SIZE)]


def _request(
    method: str,
    url: str,
    *,
    access_token: str | None = None,
    headers: dict[str, str] | None = None,
    **kwargs: Any,
) -> httpx.Response:
    all_headers = dict(headers or {})
    if access_token:
        all_headers["Authorization"] = f"Bearer {access_token}"
    try:
        return httpx.request(method, url, headers=all_headers, timeout=TIMEOUT_SECONDS, **kwargs)
    except httpx.HTTPError as exc:
        raise GoogleCalendarError("Google Calendar could not be reached") from exc


def _json(response: httpx.Response, failure_message: str) -> dict[str, Any]:
    if response.status_code >= 400:
        raise GoogleCalendarError(failure_message)
    return response.json()
