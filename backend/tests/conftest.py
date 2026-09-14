"""Shared test fixtures.

Tests run against in-memory stand-ins for DynamoDB and S3 rather than the real
services, so they're fast, offline, and don't leave junk in AWS. Each fake
implements only the access patterns its shared/ module actually uses.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared import dynamo, storage
from shared.auth import cognito_users


class FakeTable:
    """Dict-backed replacement for the DynamoDB table, keyed by (PK, SK)."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], dict[str, Any]] = {}

    def put(self, item: dict[str, Any]) -> None:
        self.items[(item["PK"], item["SK"])] = dict(item)

    def get(self, pk: str, sk: str) -> dict[str, Any] | None:
        found = self.items.get((pk, sk))
        return dict(found) if found else None

    def delete(self, pk: str, sk: str) -> None:
        self.items.pop((pk, sk), None)

    def query(self, pk: str, sk_prefix: str | None = None) -> list[dict[str, Any]]:
        return sorted(
            (
                dict(item)
                for (item_pk, item_sk), item in self.items.items()
                if item_pk == pk and (sk_prefix is None or item_sk.startswith(sk_prefix))
            ),
            key=lambda item: item["SK"],
        )

    def query_index(self, gsi1pk: str) -> list[dict[str, Any]]:
        return [dict(item) for item in self.items.values() if item.get("GSI1PK") == gsi1pk]


@pytest.fixture(autouse=True)
def fake_dynamo(monkeypatch: pytest.MonkeyPatch) -> FakeTable:
    """Point shared.dynamo at the fake table for the duration of each test."""
    table = FakeTable()

    monkeypatch.setattr(dynamo, "put_item", table.put)
    monkeypatch.setattr(dynamo, "get_item", table.get)
    monkeypatch.setattr(dynamo, "delete_item", table.delete)
    monkeypatch.setattr(dynamo, "query_prefix", table.query)
    monkeypatch.setattr(dynamo, "query_gsi1", table.query_index)

    return table


class FakeBucket:
    """Dict-backed replacement for the uploads bucket, keyed by object key."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, content: bytes) -> None:
        self.objects[key] = content

    def get(self, key: str) -> bytes:
        return self.objects[key]

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def presigned_get_url(self, key: str, *, file_name: str, expires_in: int) -> str:
        return f"https://fake-bucket.test/{key}?filename={file_name}&expires={expires_in}"

    def presigned_put_url(self, key: str, *, expires_in: int) -> str:
        return f"https://fake-bucket.test/{key}?upload=1&expires={expires_in}"


class FakeCognito:
    """Dict-backed stand-in for the user pool: email -> password (None for a Google-only user)."""

    def __init__(self) -> None:
        self.users: dict[str, str | None] = {}
        self.reset_codes: dict[str, str] = {}
        self.deleted: list[str] = []
        self.weak_passwords: set[str] = set()

    def is_configured(self) -> bool:
        return True

    def sign_up(self, email: str, password: str) -> None:
        if email in self.users:
            raise cognito_users.EmailAlreadyRegistered()
        self._check_policy(password)
        self.users[email] = password

    def verify_password(self, email: str, password: str) -> None:
        stored = self.users.get(email)
        if stored is None or stored != password:
            raise cognito_users.InvalidCredentials()

    def set_password(self, email: str, password: str) -> None:
        if email not in self.users:
            raise cognito_users.UserNotFound()
        self._check_policy(password)
        self.users[email] = password

    def forgot_password(self, email: str) -> None:
        if email in self.users:
            self.reset_codes[email] = "123456"

    def confirm_forgot_password(self, email: str, code: str, password: str) -> None:
        if email not in self.users:
            raise cognito_users.UserNotFound()
        if self.reset_codes.get(email) != code:
            raise cognito_users.InvalidCode()
        self._check_policy(password)
        self.users[email] = password
        del self.reset_codes[email]

    def has_password(self, email: str) -> bool:
        return self.users.get(email) is not None

    def delete_user(self, email: str) -> None:
        self.users.pop(email, None)
        self.deleted.append(email)

    def add_google_user(self, email: str) -> None:
        """A person who only ever signed in through Google: known to the pool, no password."""
        self.users.setdefault(email, None)

    def _check_policy(self, password: str) -> None:
        if password in self.weak_passwords:
            raise cognito_users.WeakPassword("Password did not conform with policy")


@pytest.fixture(autouse=True)
def fake_cognito(monkeypatch: pytest.MonkeyPatch) -> FakeCognito:
    """Point the auth layer at the fake pool - no AWS call ever leaves a test."""
    pool = FakeCognito()
    for name in (
        "is_configured",
        "sign_up",
        "verify_password",
        "set_password",
        "forgot_password",
        "confirm_forgot_password",
        "has_password",
        "delete_user",
    ):
        monkeypatch.setattr(cognito_users, name, getattr(pool, name))
    return pool


def upload_file(client: Any, headers: dict[str, str], course_id: str, file_name: str, content: bytes) -> dict[str, str]:
    """Simulate the browser's direct-to-S3 upload flow used by every upload
    endpoint now: ask for a presigned URL, then write the bytes straight to
    the (fake) bucket the way the browser's own PUT would, and hand back the
    {key, fileName} ref the analyse/extract/materials endpoints expect.
    """
    upload = client.post(
        f"/courses/{course_id}/materials/upload-url",
        json={"fileName": file_name},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text
    key = upload.json()["key"]
    storage.put_object(key, content)
    return {"key": key, "fileName": file_name}


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> FakeBucket:
    """Point shared.storage at the fake bucket for the duration of each test."""
    bucket = FakeBucket()

    monkeypatch.setattr(storage, "put_object", bucket.put)
    monkeypatch.setattr(storage, "get_object", bucket.get)
    monkeypatch.setattr(storage, "delete_object", bucket.delete)
    monkeypatch.setattr(storage, "presigned_get_url", bucket.presigned_get_url)
    monkeypatch.setattr(storage, "presigned_put_url", bucket.presigned_put_url)

    return bucket
