"""Google Calendar connection (FR6.2). Google itself is faked at the infrastructure boundary."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from features.scheduling.infrastructure import google_calendar
from main import app
from shared.config import settings

from .conftest import FakeTable

client = TestClient(app)


def auth_headers(email: str = "student@example.com") -> dict[str, str]:
    response = client.post("/auth/register", json={"email": email, "password": "s3cret123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_course_with_topics(headers: dict[str, str], *topics: str, exam_in_days: int = 21) -> dict[str, Any]:
    course = client.post(
        "/courses",
        json={
            "name": "Data Structures",
            "year": 2,
            "semester": "A",
            "credits": 5,
            "examDate": (datetime.now() + timedelta(days=exam_in_days)).isoformat(),
            "examType": "closed",
        },
        headers=headers,
    ).json()
    for name in topics:
        client.post(f"/courses/{course['id']}/topics", json={"name": name}, headers=headers)
    return course


class FakeGoogle:
    """Stands in for Google: records what the app asked it to do."""

    def __init__(self) -> None:
        self.created: list[str] = []
        self.deleted: list[str] = []
        self.revoked: list[str] = []
        self.exchange_fails = False
        self.refresh_fails = False
        self.insert_fails = False
        self.next_calendar = 0
        # calendar id -> event id -> payload, so a sync's clear-then-insert is observable.
        self.events: dict[str, dict[str, dict[str, Any]]] = {}
        self.next_event = 0
        self.deleted_events: list[str] = []

    def exchange_code(self, code: str) -> dict[str, Any]:
        if self.exchange_fails:
            raise google_calendar.GoogleCalendarError("Google did not accept the sign-in code")
        return {"access_token": f"access-for-{code}", "refresh_token": f"refresh-for-{code}"}

    def refresh_access_token(self, refresh_token: str) -> str:
        if self.refresh_fails:
            raise google_calendar.GoogleReconnectRequired(
                "Google Calendar access has expired - connect it again"
            )
        return f"access-from-{refresh_token}"

    def create_calendar(self, access_token: str, summary: str = "LearnSprint") -> str:
        self.next_calendar += 1
        calendar_id = f"cal-{self.next_calendar}"
        self.created.append(calendar_id)
        return calendar_id

    def delete_calendar(self, access_token: str, calendar_id: str) -> None:
        self.deleted.append(calendar_id)

    def revoke_token(self, token: str) -> None:
        self.revoked.append(token)

    def list_event_ids(self, access_token: str, calendar_id: str, private_property: str) -> list[str]:
        key, _, value = private_property.partition("=")
        return [
            event_id
            for event_id, payload in self.events.get(calendar_id, {}).items()
            if payload["extendedProperties"]["private"].get(key) == value
        ]

    def delete_events(self, access_token: str, calendar_id: str, event_ids: list[str]) -> None:
        for event_id in event_ids:
            self.events.get(calendar_id, {}).pop(event_id, None)
            self.deleted_events.append(event_id)

    def insert_events(self, access_token: str, calendar_id: str, events: list[dict[str, Any]]) -> None:
        if self.insert_fails:
            raise google_calendar.GoogleCalendarError("Google Calendar would not add the sessions")
        for payload in events:
            self.next_event += 1
            self.events.setdefault(calendar_id, {})[f"ev-{self.next_event}"] = payload

    def calendar_events(self, calendar_id: str = "cal-1") -> list[dict[str, Any]]:
        return list(self.events.get(calendar_id, {}).values())


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    fake = FakeGoogle()
    for name in (
        "exchange_code",
        "refresh_access_token",
        "create_calendar",
        "delete_calendar",
        "revoke_token",
        "list_event_ids",
        "delete_events",
        "insert_events",
    ):
        monkeypatch.setattr(google_calendar, name, getattr(fake, name))
    return fake


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_calendar_client_id", "client-id")
    monkeypatch.setattr(settings, "google_calendar_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_calendar_redirect_uri", "http://localhost:5173/calendar/google/callback")


def connect(headers: dict[str, str], code: str = "code-1") -> dict[str, Any]:
    response = client.post("/integrations/google-calendar/callback", json={"code": code}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


class TestWhenNotConfigured:
    def test_status_says_so(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "google_calendar_client_id", "")

        status = client.get("/integrations/google-calendar/status", headers=auth_headers()).json()

        assert status == {"configured": False, "connected": False, "connectedAt": None, "lastSyncedAt": None}

    def test_authorize_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "google_calendar_client_id", "")

        response = client.get("/integrations/google-calendar/authorize", headers=auth_headers())

        assert response.status_code == 503

    def test_requires_a_signed_in_student(self) -> None:
        assert client.get("/integrations/google-calendar/status").status_code == 401


@pytest.mark.usefixtures("configured")
class TestConnecting:
    def test_authorize_points_at_google_with_consent_for_a_refresh_token(self) -> None:
        response = client.get("/integrations/google-calendar/authorize", headers=auth_headers()).json()

        url = response["authorizeUrl"]
        assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        assert "client_id=client-id" in url
        assert "access_type=offline" in url
        assert "prompt=consent" in url
        assert "calendar.app.created" in url
        assert f"state={response['state']}" in url
        assert response["state"]

    def test_callback_creates_the_calendar_and_stores_the_credential(
        self, google: FakeGoogle, fake_dynamo: FakeTable
    ) -> None:
        headers = auth_headers()

        status = connect(headers)

        assert status["connected"] is True
        assert status["connectedAt"]
        assert google.created == ["cal-1"]
        stored = [item for item in fake_dynamo.items.values() if item["SK"] == "GOOGLE_CALENDAR"]
        assert len(stored) == 1
        assert stored[0]["refreshToken"] == "refresh-for-code-1"
        assert stored[0]["googleCalendarId"] == "cal-1"

    def test_the_credential_never_leaves_the_server(self, google: FakeGoogle) -> None:
        headers = auth_headers()

        callback = client.post("/integrations/google-calendar/callback", json={"code": "c"}, headers=headers)
        status = client.get("/integrations/google-calendar/status", headers=headers)

        for body in (callback.text, status.text):
            assert "refresh-for" not in body
            assert "access-for" not in body
        assert status.json()["connected"] is True

    def test_reconnecting_replaces_the_calendar(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        connect(headers, "first")

        connect(headers, "second")

        assert google.deleted == ["cal-1"]
        assert google.created == ["cal-1", "cal-2"]

    def test_google_rejecting_the_code_stores_nothing(
        self, google: FakeGoogle, fake_dynamo: FakeTable
    ) -> None:
        google.exchange_fails = True

        response = client.post(
            "/integrations/google-calendar/callback", json={"code": "bad"}, headers=auth_headers()
        )

        assert response.status_code == 502
        assert not any(item["SK"] == "GOOGLE_CALENDAR" for item in fake_dynamo.items.values())

    def test_connections_are_per_student(self, google: FakeGoogle) -> None:
        connect(auth_headers("a@example.com"))

        status = client.get(
            "/integrations/google-calendar/status", headers=auth_headers("b@example.com")
        ).json()

        assert status["connected"] is False


@pytest.mark.usefixtures("configured")
class TestDisconnecting:
    def test_removes_the_calendar_the_grant_and_the_record(
        self, google: FakeGoogle, fake_dynamo: FakeTable
    ) -> None:
        headers = auth_headers()
        connect(headers)

        response = client.delete("/integrations/google-calendar/connection", headers=headers)

        assert response.status_code == 204
        assert google.deleted == ["cal-1"]
        assert google.revoked == ["refresh-for-code-1"]
        assert not any(item["SK"] == "GOOGLE_CALENDAR" for item in fake_dynamo.items.values())
        assert client.get("/integrations/google-calendar/status", headers=headers).json()["connected"] is False

    def test_still_forgets_the_record_when_google_no_longer_honours_the_token(
        self, google: FakeGoogle, fake_dynamo: FakeTable
    ) -> None:
        headers = auth_headers()
        connect(headers)
        google.refresh_fails = True

        response = client.delete("/integrations/google-calendar/connection", headers=headers)

        assert response.status_code == 204
        assert google.deleted == []
        assert not any(item["SK"] == "GOOGLE_CALENDAR" for item in fake_dynamo.items.values())

    def test_disconnecting_twice_is_harmless(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        connect(headers)
        client.delete("/integrations/google-calendar/connection", headers=headers)

        assert client.delete("/integrations/google-calendar/connection", headers=headers).status_code == 204


@pytest.mark.usefixtures("configured")
class TestSyncing:
    def sync(self, headers: dict[str, str], course_id: str):
        return client.post(f"/integrations/google-calendar/sync?courseId={course_id}", headers=headers)

    def test_writes_the_plan_into_the_learnsprint_calendar(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        course = create_course_with_topics(headers, "Trees", "Graphs")
        connect(headers)

        response = self.sync(headers, course["id"])

        assert response.status_code == 200, response.text
        body = response.json()
        events = google.calendar_events()
        assert body["synced"] == len(events) > 0
        assert all(e["extendedProperties"]["private"]["learnsprintCourseId"] == course["id"] for e in events)
        assert all(e["start"]["timeZone"] == "Asia/Jerusalem" for e in events)
        assert body["lastSyncedAt"]
        status = client.get("/integrations/google-calendar/status", headers=headers).json()
        assert status["lastSyncedAt"] == body["lastSyncedAt"]

    def test_syncing_again_replaces_rather_than_duplicates(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        course = create_course_with_topics(headers, "Trees")
        connect(headers)
        first = self.sync(headers, course["id"]).json()["synced"]

        second = self.sync(headers, course["id"]).json()["synced"]

        assert second == first
        assert len(google.calendar_events()) == first
        assert len(google.deleted_events) == first

    def test_syncing_one_course_leaves_another_courses_sessions_alone(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        first_course = create_course_with_topics(headers, "Trees")
        second_course = create_course_with_topics(headers, "Sorting")
        connect(headers)
        self.sync(headers, first_course["id"])
        before = len(google.calendar_events())

        self.sync(headers, second_course["id"])
        self.sync(headers, second_course["id"])

        first_left = [
            e for e in google.calendar_events()
            if e["extendedProperties"]["private"]["learnsprintCourseId"] == first_course["id"]
        ]
        assert len(first_left) == before

    def test_refused_when_not_connected(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        course = create_course_with_topics(headers, "Trees")

        response = self.sync(headers, course["id"])

        assert response.status_code == 409
        assert "Connect" in response.json()["detail"]

    def test_refused_when_the_plan_does_not_fit(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        # The exam is in an hour: not even a crash review fits.
        course = create_course_with_topics(headers, "Trees", "Graphs", "Hashing", exam_in_days=0)
        connect(headers)

        response = self.sync(headers, course["id"])

        assert response.status_code == 409
        assert google.calendar_events() == []

    def test_a_dead_credential_asks_to_reconnect_instead_of_failing_quietly(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        course = create_course_with_topics(headers, "Trees")
        connect(headers)
        google.refresh_fails = True

        response = self.sync(headers, course["id"])

        assert response.status_code == 502
        assert "connect" in response.json()["detail"].lower()

    def test_google_failing_mid_sync_is_reported_and_leaves_no_sync_stamp(self, google: FakeGoogle) -> None:
        headers = auth_headers()
        course = create_course_with_topics(headers, "Trees")
        connect(headers)
        google.insert_fails = True

        response = self.sync(headers, course["id"])

        assert response.status_code == 502
        assert client.get("/integrations/google-calendar/status", headers=headers).json()["lastSyncedAt"] is None

    def test_cannot_sync_someone_elses_course(self, google: FakeGoogle) -> None:
        owner = auth_headers("owner@example.com")
        course = create_course_with_topics(owner, "Trees")
        stranger = auth_headers("stranger@example.com")
        connect(stranger)

        assert self.sync(stranger, course["id"]).status_code == 403


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any], text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


@pytest.mark.usefixtures("configured")
class TestGoogleClient:
    """The thin HTTP layer, with httpx itself stubbed."""

    def test_exchange_without_a_refresh_token_is_an_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            google_calendar.httpx, "request", lambda *a, **k: FakeResponse(200, {"access_token": "x"})
        )

        with pytest.raises(google_calendar.GoogleCalendarError, match="refresh token"):
            google_calendar.exchange_code("code")

    def test_a_dead_refresh_token_asks_for_a_reconnect(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            google_calendar.httpx, "request", lambda *a, **k: FakeResponse(400, {"error": "invalid_grant"})
        )

        with pytest.raises(google_calendar.GoogleReconnectRequired):
            google_calendar.refresh_access_token("stale")

    def test_network_trouble_is_reported_not_raised_raw(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def boom(*args: Any, **kwargs: Any) -> None:
            raise google_calendar.httpx.ConnectError("no route")

        monkeypatch.setattr(google_calendar.httpx, "request", boom)

        with pytest.raises(google_calendar.GoogleCalendarError, match="could not be reached"):
            google_calendar.create_calendar("token")

    def test_deleting_an_already_gone_calendar_counts_as_done(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(google_calendar.httpx, "request", lambda *a, **k: FakeResponse(404, {}))

        google_calendar.delete_calendar("token", "cal-gone")

    def test_batches_are_capped_at_fifty_and_each_part_is_checked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent: list[bytes] = []

        def fake_request(method: str, url: str, **kwargs: Any) -> FakeResponse:
            sent.append(kwargs["content"])
            parts = kwargs["content"].count(b"Content-Type: application/http")
            return FakeResponse(200, {}, text="HTTP/1.1 200 OK\r\n" * parts)

        monkeypatch.setattr(google_calendar.httpx, "request", fake_request)

        google_calendar.insert_events("token", "cal-1", [{"summary": f"e{i}"} for i in range(120)])

        assert len(sent) == 3
        assert sent[0].count(b"POST /calendar/v3/calendars/cal-1/events") == 50
        assert sent[2].count(b"POST /calendar/v3/calendars/cal-1/events") == 20

    def test_one_failed_part_fails_the_batch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            google_calendar.httpx,
            "request",
            lambda *a, **k: FakeResponse(200, {}, text="HTTP/1.1 200 OK\r\nHTTP/1.1 403 Forbidden\r\n"),
        )

        with pytest.raises(google_calendar.GoogleCalendarError, match="would not add"):
            google_calendar.insert_events("token", "cal-1", [{"summary": "a"}, {"summary": "b"}])

    def test_deleting_events_someone_already_removed_is_fine(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            google_calendar.httpx,
            "request",
            lambda *a, **k: FakeResponse(200, {}, text="HTTP/1.1 204 No Content\r\nHTTP/1.1 404 Not Found\r\n"),
        )

        google_calendar.delete_events("token", "cal-1", ["ev-1", "ev-2"])

    def test_listing_follows_every_page(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pages = iter(
            [
                FakeResponse(200, {"items": [{"id": "a"}, {"id": "b"}], "nextPageToken": "p2"}),
                FakeResponse(200, {"items": [{"id": "c"}]}),
            ]
        )
        requested_params: list[dict[str, Any]] = []

        def fake_request(method: str, url: str, **kwargs: Any) -> FakeResponse:
            requested_params.append(kwargs["params"])
            return next(pages)

        monkeypatch.setattr(google_calendar.httpx, "request", fake_request)

        ids = google_calendar.list_event_ids("token", "cal-1", "learnsprintCourseId=c1")

        assert ids == ["a", "b", "c"]
        assert requested_params[0]["privateExtendedProperty"] == "learnsprintCourseId=c1"
        assert requested_params[1]["pageToken"] == "p2"
