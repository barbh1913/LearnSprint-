"""What one group member is allowed to see about another (FR5.3, FR5.4).

The privacy rule lives here rather than in the router so there is exactly one
place that decides it. A member sees how far a peer has got and nothing else -
no grade, no blocked hours, no schedule.
"""

from __future__ import annotations

from dataclasses import dataclass

from features.progress.domain import status as status_rules

# Fields that must never cross between members. Kept as an explicit list so the
# guard test can assert on it instead of trusting that nobody adds one later.
PRIVATE_FIELDS = ("finalGrade", "blockedSlots", "timePreference")


@dataclass(frozen=True)
class PeerProgress:
    """One member's progress, as everyone else in the group is allowed to see it."""

    user_id: str
    email: str
    role: str
    is_me: bool
    topics_total: int
    topics_done: int

    @property
    def percent_complete(self) -> int:
        if self.topics_total == 0:
            return 0
        return round(self.topics_done * 100 / self.topics_total)


def summarise_peer(
    *,
    user_id: str,
    email: str,
    role: str,
    is_me: bool,
    actions_by_topic: dict[str, list[str]],
    progress_by_topic: dict[str, dict],
    done_action_ids: set[str],
) -> PeerProgress:
    """Reduce a member's progress to a completion count, dropping everything else.

    Status is derived the same way the board derives it, not read from the
    stored row - the stored value is only the student's manual placement, so
    trusting it would report a finished topic as untouched.

    Only `done` counts. A topic sitting in Needs review has been studied but
    rated low, so counting it would overstate how ready the student is.
    """
    done = 0
    for topic_id, action_ids in actions_by_topic.items():
        progress = progress_by_topic.get(topic_id) or {}
        status = status_rules.derive_status(
            actions_done=sum(1 for action_id in action_ids if action_id in done_action_ids),
            total_actions=len(action_ids),
            mastery_level=progress.get("masteryLevel"),
            current_status=progress.get("status", status_rules.BACKLOG),
            manual_override=bool(progress.get("statusOverride")),
        )
        if status == status_rules.DONE:
            done += 1

    return PeerProgress(
        user_id=user_id,
        email=email,
        role=role,
        is_me=is_me,
        topics_total=len(actions_by_topic),
        topics_done=done,
    )


def to_response(peer: PeerProgress) -> dict:
    """Serialise a peer for the API. This is the only shape the endpoint returns."""
    return {
        "userId": peer.user_id,
        "email": peer.email,
        "role": peer.role,
        "isMe": peer.is_me,
        "topicsTotal": peer.topics_total,
        "topicsDone": peer.topics_done,
        "percentComplete": peer.percent_complete,
    }
