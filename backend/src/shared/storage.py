"""S3 access for uploaded course material.

Each student's files live under their own prefix (userId/courseId/...), which
is what makes isolation structural rather than a filter someone could get
wrong later - the same principle DynamoDB's per-user partitions already use
(see docs/erd.md). No one's key ever needs a WHERE clause to keep it apart
from anyone else's.
"""

from __future__ import annotations

import os
import uuid

import boto3

BUCKET = os.environ.get("UPLOADS_BUCKET", "learnsprint-uploads-835505308330")
AWS_REGION = os.environ.get("AWS_REGION", "il-central-1")

_client = None


def get_client():
    global _client
    if _client is None:
        _client = boto3.client("s3", region_name=AWS_REGION)
    return _client


def upload_key(user_id: str, course_id: str, filename: str) -> str:
    """A fresh, collision-free key under this user's own prefix."""
    safe_name = filename.replace("/", "_") or "upload"
    return f"{user_id}/{course_id}/{uuid.uuid4().hex}-{safe_name}"


def put_object(key: str, content: bytes) -> None:
    get_client().put_object(Bucket=BUCKET, Key=key, Body=content)


def get_object(key: str) -> bytes:
    response = get_client().get_object(Bucket=BUCKET, Key=key)
    return response["Body"].read()


def delete_object(key: str) -> None:
    get_client().delete_object(Bucket=BUCKET, Key=key)
