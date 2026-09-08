"""Study group use cases (FR5.1-FR5.4).

A "group" is not a separate entity - it is the set of memberships on a course
(see docs/erd.md). Inviting someone is therefore just adding a membership row,
which is why they immediately see the same shared topic backlog (FR5.2) with
no copying involved.
"""

from __future__ import annotations

from typing import Any

from features.academic_profile.infrastructure import repository as course_repo
from features.content_topics.infrastructure import repository as topic_repo
from features.progress.infrastructure import repository as progress_repo
from features.study_groups.domain import peer_view
from shared.auth import repository as user_repo


class UserNotFound(Exception):
    """No account with that email. We deliberately do not create one silently."""


class AlreadyMember(Exception):
    pass


class NotAMember(Exception):
    pass


class CannotRemoveOwner(Exception):
    pass


def invite_member(*, course_id: str, email: str) -> dict[str, Any]:
    """Add an existing user to a course by email (FR5.1).

    The invitee must already have an account. Auto-creating one would mean
    putting a stranger's email in the table without their consent, and there is
    no email delivery in this system to confirm it with.
    """
    course = course_repo.get_course(course_id)
    if course is None:
        raise UserNotFound(email)

    user = user_repo.find_by_email(email)
    if user is None:
        raise UserNotFound(email)

    if course_repo.get_membership(user["id"], course_id) is not None:
        raise AlreadyMember(email)

    course_repo.add_member(user["id"], course, role="member")
    return user


def remove_member(*, course_id: str, user_id: str) -> None:
    """Remove a member. The owner cannot be removed - deleting the course is that action."""
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise NotAMember(user_id)
    if membership["role"] == "owner":
        raise CannotRemoveOwner(user_id)

    course_repo.remove_membership(user_id, course_id)


def list_members(*, course_id: str, viewer_id: str) -> list[dict[str, Any]]:
    """Everyone on the course with their completion percentage (FR5.3).

    Each member's progress is fetched separately because progress rows live in
    their own partition - the price of the privacy split, and cheap at the size
    of a study group.
    """
    memberships = course_repo.list_course_members(course_id)

    # Course content is shared, so fetch it once and reuse it for every member.
    topic_ids = {topic["id"] for topic in topic_repo.list_topics(course_id)}
    actions_by_topic: dict[str, list[str]] = {topic_id: [] for topic_id in topic_ids}
    for action in topic_repo.list_actions(course_id):
        if action["topicId"] in actions_by_topic:
            actions_by_topic[action["topicId"]].append(action["id"])

    peers = []
    for membership in memberships:
        member_id = membership["userId"]
        user = user_repo.find_by_id(member_id)
        if user is None:
            continue

        progress_by_topic = {
            row["topicId"]: row for row in progress_repo.list_topic_progress(member_id)
        }
        done_action_ids = {
            row["actionId"]
            for row in progress_repo.list_action_progress(member_id)
            if row.get("isDone")
        }

        peers.append(
            peer_view.to_response(
                peer_view.summarise_peer(
                    user_id=member_id,
                    email=user["email"],
                    role=membership["role"],
                    is_me=member_id == viewer_id,
                    actions_by_topic=actions_by_topic,
                    progress_by_topic=progress_by_topic,
                    done_action_ids=done_action_ids,
                )
            )
        )

    # Owner first, then the furthest along - the ordering the board reads best in.
    peers.sort(key=lambda peer: (peer["role"] != "owner", -peer["percentComplete"]))
    return peers
