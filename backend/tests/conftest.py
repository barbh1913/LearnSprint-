"""Shared test fixtures.

Tests run against an in-memory stand-in for DynamoDB rather than the real table,
so they're fast, offline, and don't leave junk in AWS. The fake implements only
the four access patterns shared/dynamo.py actually uses.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared import dynamo


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
