"""Google Calendar connection (FR6.2). Google itself is faked at the infrastructure boundary."""

from __future__ import annotations

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


class FakeGoogle:
    """Stands in for Google: records what the app asked it to do."""

    def __init__(self) -> None:
        self.created: list[str] = []
        self.deleted: list[str] = []
        self.revoked: list[str] = []
        self.exchange_fails = False
        self.refresh_fails = False
        self.next_calendar = 0

    def exchange_code(self, code: str) -> dict[str, Any]:
        if self.exchange_fails:
            raise google_calendar.GoogleCalendarError("Google did not accept the sign-in code")
        return {"access_token": f"access-for-{code}", "refresh_token": f"refresh-for-{code}"}

    def refresh_access_token(self, refresh_token: str) -> str:
        if self.refresh_fails:
            raise google_calendar.GoogleReconnectRequired("expired")
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


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    fake = FakeGoogle()
    for name in ("exchange_code", "refresh_access_token", "create_calendar", "delete_calendar", "revoke_token"):
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


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

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
