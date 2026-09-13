"""Shared test fixtures.

Tests run against in-memory stand-ins for DynamoDB and S3 rather than the real
services, so they're fast, offline, and don't leave junk in AWS. Each fake
implements only the access patterns its shared/ module actually uses.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared import dynamo, storage


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


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> FakeBucket:
    """Point shared.storage at the fake bucket for the duration of each test."""
    bucket = FakeBucket()

    monkeypatch.setattr(storage, "put_object", bucket.put)
    monkeypatch.setattr(storage, "get_object", bucket.get)
    monkeypatch.setattr(storage, "delete_object", bucket.delete)
    monkeypatch.setattr(storage, "presigned_get_url", bucket.presigned_get_url)

    return bucket
