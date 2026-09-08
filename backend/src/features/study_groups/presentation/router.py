"""Study group endpoints (FR5.1-FR5.4).

Every response goes through the domain's peer projection, so a member's grade
or blocked hours cannot leak here even by accident.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from features.academic_profile.infrastructure import repository as course_repo
from features.study_groups.application import group_service
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["study-groups"])


class InviteRequest(BaseModel):
    email: EmailStr


class MemberOut(BaseModel):
    userId: str
    email: EmailStr
    role: str
    isMe: bool
    topicsTotal: int
    topicsDone: int
    percentComplete: int


@router.get("/courses/{course_id}/members", response_model=list[MemberOut])
def list_members(course_id: str, user_id: str = Depends(get_current_user_id)) -> list[dict[str, Any]]:
    """Everyone on this course and how far along they are (FR5.3)."""
    _require_membership(user_id, course_id)
    return group_service.list_members(course_id=course_id, viewer_id=user_id)


@router.post(
    "/courses/{course_id}/members",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
)
def invite_member(
    course_id: str, payload: InviteRequest, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    """Invite an existing user to share this course (FR5.1). Owner only."""
    _require_owner(user_id, course_id)

    try:
        group_service.invite_member(course_id=course_id, email=payload.email)
    except group_service.UserNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail="No account with that email. They need to sign up first.",
        ) from exc
    except group_service.AlreadyMember as exc:
        raise HTTPException(status_code=409, detail="Already a member of this course") from exc

    members = group_service.list_members(course_id=course_id, viewer_id=user_id)
    return next(member for member in members if member["email"] == payload.email.lower())


@router.delete("/courses/{course_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    course_id: str, member_id: str, user_id: str = Depends(get_current_user_id)
) -> None:
    """Remove a member, or leave the course yourself."""
    membership = _require_membership(user_id, course_id)

    # Anyone may remove themselves; only the owner may remove someone else.
    if member_id != user_id and membership["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the course owner can remove members")

    try:
        group_service.remove_member(course_id=course_id, user_id=member_id)
    except group_service.NotAMember as exc:
        raise HTTPException(status_code=404, detail="Not a member of this course") from exc
    except group_service.CannotRemoveOwner as exc:
        raise HTTPException(
            status_code=409,
            detail="The owner cannot be removed. Delete the course instead.",
        ) from exc


def _require_membership(user_id: str, course_id: str) -> dict[str, Any]:
    membership = course_repo.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")
    return membership


def _require_owner(user_id: str, course_id: str) -> dict[str, Any]:
    membership = _require_membership(user_id, course_id)
    if membership["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the course owner can invite members")
    return membership
