"""DynamoDB access for the single-table design.

Everything lives in one table with a composite key (PK, SK) plus one GSI. The
key layout is documented in docs/erd.md - in short:

    User               PK=USER#<id>     SK=PROFILE          GSI1PK=EMAIL#<email>
    UserConstraints    PK=USER#<id>     SK=CONSTRAINTS
    CourseMembership   PK=USER#<id>     SK=COURSE#<cid>     GSI1PK=COURSE#<cid>
    Course             PK=COURSE#<cid>  SK=META
    Topic              PK=COURSE#<cid>  SK=TOPIC#<tid>
    Action             PK=COURSE#<cid>  SK=TOPIC#<tid>#ACTION#<aid>
    UserTopicProgress  PK=USER#<id>     SK=TPROG#<tid>
    UserActionProgress PK=USER#<id>     SK=APROG#<aid>

Putting a course's topics and actions under the same PK means the whole course
tree comes back in a single query instead of N round trips.
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("DYNAMO_TABLE", "LearnSprint")
AWS_REGION = os.environ.get("AWS_REGION", "il-central-1")

_table = None


def get_table():
    """The boto3 Table resource, created once and reused."""
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb", region_name=AWS_REGION).Table(TABLE_NAME)
    return _table


def user_pk(user_id: str) -> str:
    return f"USER#{user_id}"


def course_pk(course_id: str) -> str:
    return f"COURSE#{course_id}"


def topic_sk(topic_id: str) -> str:
    return f"TOPIC#{topic_id}"


def action_sk(topic_id: str, action_id: str) -> str:
    return f"TOPIC#{topic_id}#ACTION#{action_id}"


def put_item(item: dict[str, Any]) -> None:
    get_table().put_item(Item=_to_dynamo(item))


def get_item(pk: str, sk: str) -> dict[str, Any] | None:
    response = get_table().get_item(Key={"PK": pk, "SK": sk})
    item = response.get("Item")
    return _from_dynamo(item) if item else None


def delete_item(pk: str, sk: str) -> None:
    get_table().delete_item(Key={"PK": pk, "SK": sk})


def query_prefix(pk: str, sk_prefix: str | None = None) -> list[dict[str, Any]]:
    """All items under one partition, optionally filtered by SK prefix."""
    condition = Key("PK").eq(pk)
    if sk_prefix:
        condition = condition & Key("SK").begins_with(sk_prefix)

    response = get_table().query(KeyConditionExpression=condition)
    return [_from_dynamo(item) for item in response.get("Items", [])]


def query_gsi1(gsi1pk: str) -> list[dict[str, Any]]:
    """Reverse lookup via GSI1 - used for login-by-email and course members."""
    response = get_table().query(
        IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(gsi1pk)
    )
    return [_from_dynamo(item) for item in response.get("Items", [])]


def _to_dynamo(value: Any) -> Any:
    """DynamoDB stores numbers as Decimal and rejects float, so convert on the way in."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _to_dynamo(inner) for key, inner in value.items() if inner is not None}
    if isinstance(value, (list, tuple)):
        return [_to_dynamo(inner) for inner in value]
    return value


def _from_dynamo(value: Any) -> Any:
    """Turn Decimal back into int/float so Pydantic and JSON are happy."""
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {key: _from_dynamo(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [_from_dynamo(inner) for inner in value]
    return value
