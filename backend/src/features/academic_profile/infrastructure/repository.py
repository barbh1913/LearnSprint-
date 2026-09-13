"""Course, membership and constraints storage.

Course content (name, credits, exam date) is shared - it lives under
PK=COURSE#<id>. Anything personal (the grade, the blocked hours) lives under
PK=USER#<id>, which is what keeps FR5.4 privacy true at the data layer rather
than as a UI filter.

Course fields are copied onto the membership row so the courses list and the
grades page are one query instead of one per course.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from shared import dynamo


def create_course(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    course_id = str(uuid.uuid4())
    course = {
        "PK": dynamo.course_pk(course_id),
        "SK": "META",
        "entity": "Course",
        "id": course_id,
        "name": data["name"],
        "year": data["year"],
        "semester": data["semester"],
        "credits": data["credits"],
        "examDate": data.get("examDate"),
        "examType": data.get("examType", "closed"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    dynamo.put_item(course)
    _put_membership(user_id, course, role="owner", final_grade=None)
    return course


def get_course(course_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.course_pk(course_id), "META")


def update_course(course_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    course = get_course(course_id)
    if course is None:
        return None

    course.update({key: value for key, value in changes.items() if value is not None})
    dynamo.put_item(course)

    # Memberships carry a copy of these fields, so refresh them too.
    for membership in list_course_members(course_id):
        _put_membership(
            membership["userId"], course, membership["role"], membership.get("finalGrade")
        )
    return course


def delete_course(course_id: str) -> None:
    """Remove the course and everything under it, plus every member's rows."""
    for item in dynamo.query_prefix(dynamo.course_pk(course_id)):
        dynamo.delete_item(item["PK"], item["SK"])

    for membership in list_course_members(course_id):
        dynamo.delete_item(membership["PK"], membership["SK"])


def list_memberships(user_id: str) -> list[dict[str, Any]]:
    return dynamo.query_prefix(dynamo.user_pk(user_id), "COURSE#")


def get_membership(user_id: str, course_id: str) -> dict[str, Any] | None:
    return dynamo.get_item(dynamo.user_pk(user_id), dynamo.course_pk(course_id))


def list_course_members(course_id: str) -> list[dict[str, Any]]:
    return dynamo.query_gsi1(dynamo.course_pk(course_id))


def add_member(user_id: str, course: dict[str, Any], role: str = "member") -> None:
    """Enrol another user on an existing course (FR5.1).

    They get their own membership row, so their grade and progress stay theirs -
    joining a group never exposes either.
    """
    _put_membership(user_id, course, role=role, final_grade=None)


def remove_membership(user_id: str, course_id: str) -> None:
    """Drop a member's enrolment.

    Their progress rows are left alone: they belong to that user, not to the
    course, and deleting them would destroy their own study history.
    """
    dynamo.delete_item(dynamo.user_pk(user_id), dynamo.course_pk(course_id))


def set_final_grade(user_id: str, course_id: str, grade: float | None) -> dict[str, Any] | None:
    membership = get_membership(user_id, course_id)
    if membership is None:
        return None

    membership["finalGrade"] = grade
    dynamo.put_item(membership)
    return membership


def get_constraints(user_id: str) -> dict[str, Any]:
    stored = dynamo.get_item(dynamo.user_pk(user_id), "CONSTRAINTS")
    if stored is not None:
        return stored

    return {
        "userId": user_id,
        "blockedSlots": [],
        "timePreference": "evening",
    }


def save_constraints(user_id: str, blocked_slots: list[dict[str, Any]], preference: str) -> dict[str, Any]:
    item = {
        "PK": dynamo.user_pk(user_id),
        "SK": "CONSTRAINTS",
        "entity": "UserConstraints",
        "userId": user_id,
        "blockedSlots": blocked_slots,
        "timePreference": preference,
    }
    dynamo.put_item(item)
    return item


def _put_membership(
    user_id: str, course: dict[str, Any], role: str, final_grade: float | None
) -> None:
    dynamo.put_item(
        {
            "PK": dynamo.user_pk(user_id),
            "SK": dynamo.course_pk(course["id"]),
            "GSI1PK": dynamo.course_pk(course["id"]),
            "GSI1SK": dynamo.user_pk(user_id),
            "entity": "CourseMembership",
            "userId": user_id,
            "courseId": course["id"],
            "role": role,
            "finalGrade": final_grade,
            # Denormalized copies so listing courses is a single query.
            "courseName": course["name"],
            "year": course["year"],
            "semester": course["semester"],
            "credits": course["credits"],
            "examDate": course.get("examDate"),
            "examType": course.get("examType", "closed"),
        }
    )
