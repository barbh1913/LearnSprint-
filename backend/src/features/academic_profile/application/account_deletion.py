"""Remove everything a student owns when they delete their account (ADR 0014).

What goes:
- courses they own, for everyone - the shared content, every member's progress
  on it, every member's materials in it (rows and files);
- their own materials in courses they merely belong to;
- the Google Calendar connection (and the LearnSprint calendar in Google, best effort);
- every row in their own partition: memberships, progress, constraints, profile.

What stays: courses owned by someone else keep running for the other members,
minus this student's membership.
"""

from __future__ import annotations

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.infrastructure import repository as progress_repo
from features.scheduling.application import google_calendar_connection
from shared import storage
from shared.auth import repository as user_repo


def delete_account_data(user_id: str) -> None:
    google_calendar_connection.disconnect(user_id)

    for membership in course_repo.list_memberships(user_id):
        course_id = membership["courseId"]
        if membership.get("role") == "owner":
            delete_course_for_everyone(course_id)
        else:
            _delete_materials(course_id, owner_id=user_id)

    user_repo.delete_everything_under(user_id)


def delete_course_for_everyone(course_id: str) -> None:
    """The course, every member's progress on it, every member's materials in it."""
    delete_all_members_progress(course_id)
    _delete_materials(course_id, owner_id=None)
    course_repo.delete_course(course_id)


def delete_all_members_progress(course_id: str) -> None:
    """Every member's private progress rows for the course's topics.

    Cleaned up before the shared topics disappear - otherwise they'd sit
    orphaned under partitions (PK=USER#<id>) a course delete never touches.
    """
    action_ids_by_topic: dict[str, list[str]] = {}
    for action in topic_repo.list_actions(course_id):
        action_ids_by_topic.setdefault(action["topicId"], []).append(action["id"])

    topic_ids = [topic["id"] for topic in topic_repo.list_topics(course_id)]
    for member in course_repo.list_course_members(course_id):
        for topic_id in topic_ids:
            progress_repo.delete_topic_progress(member["userId"], topic_id, action_ids_by_topic.get(topic_id, []))


def _delete_materials(course_id: str, *, owner_id: str | None) -> None:
    """Materials in the course - one student's, or everyone's when the course itself goes."""
    for material in topic_repo.list_course_materials(course_id):
        if owner_id is not None and material.get("userId") != owner_id:
            continue
        storage.delete_object(material["s3Key"])
        topic_repo.delete_material(course_id, material["id"])
