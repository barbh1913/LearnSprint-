"""Analyse a file, let the student decide, then file it (FR2.8, FR2.10, ADR 0013).

Analysis stores the file and what it is about on a Material row with no topic.
Confirmation is where anything about the course changes - and it is idempotent:
a material already filed returns the same answer, a "create" for a name that
already exists returns that topic, and a syllabus remembers what it created.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any

from features.content_topics.application.content_understanding import propose_lectures, understand
from features.content_topics.domain.material_matching import (
    ATTACH_EXISTING,
    MaterialContent,
    RankedMatch,
    TopicCandidate,
    normalize,
    rank_against_topics,
)
from features.content_topics.infrastructure import repository

MATERIAL = "material"
SYLLABUS = "syllabus"

ATTACH = "attach"
CREATE = "create"
SKIP = "skip"


class TopicGone(Exception):
    """The chosen topic no longer exists - deleted between analysis and confirmation."""


class WrongKindOfMaterial(Exception):
    """A syllabus confirmed as a single material, or the other way round."""


class BadProposal(Exception):
    """A confirmation item points at a proposal the analysis never made."""


# --- Analysis -------------------------------------------------------------------


def analyse_material(
    *, user_id: str, course_id: str, file_name: str, s3_key: str, size_bytes: int, lines: list[str]
) -> dict[str, Any]:
    content, analysed_by, note = understand(lines, file_name=file_name)
    match = rank_against_topics(content, _candidates(course_id))
    material = repository.create_material(
        user_id=user_id,
        course_id=course_id,
        topic_id=None,
        file_name=file_name,
        s3_key=s3_key,
        size_bytes=size_bytes,
        analysis={"kind": MATERIAL, "analysedBy": analysed_by, "note": note, "content": asdict(content)},
    )
    return {"material": material, "content": content, "match": match, "analysedBy": analysed_by, "note": note}


def analyse_syllabus(
    *, user_id: str, course_id: str, file_name: str, s3_key: str, size_bytes: int, lines: list[str]
) -> dict[str, Any]:
    proposals, analysed_by, note = propose_lectures(lines)
    candidates = _candidates(course_id)
    matches = [rank_against_topics(proposal, candidates) for proposal in proposals]
    material = repository.create_material(
        user_id=user_id,
        course_id=course_id,
        topic_id=None,
        file_name=file_name,
        s3_key=s3_key,
        size_bytes=size_bytes,
        analysis={
            "kind": SYLLABUS,
            "analysedBy": analysed_by,
            "note": note,
            "proposals": [asdict(proposal) for proposal in proposals],
        },
    )
    return {
        "material": material,
        "proposals": proposals,
        "matches": matches,
        "analysedBy": analysed_by,
        "note": note,
    }


# --- Confirmation ----------------------------------------------------------------


def confirm_material(
    material: dict[str, Any], *, decision: str, topic_id: str | None, title: str | None
) -> dict[str, Any]:
    """File one analysed material. Returns {topicId, topicName, created, alreadyConfirmed}."""
    analysis = material.get("analysis") or {}
    if analysis.get("kind") != MATERIAL:
        raise WrongKindOfMaterial()

    course_id = material["courseId"]
    if material.get("topicId"):
        topic = repository.get_topic(course_id, material["topicId"])
        return _result(material["topicId"], topic["name"] if topic else "", created=False, already=True)

    content = _content_from(analysis["content"])
    if decision == ATTACH:
        topic, created = _attach_target(course_id, topic_id)
    else:
        topic, created = _create_or_reuse(course_id, (title or content.title).strip(), content)

    _refresh_description(course_id, topic, content)
    repository.update_material(
        course_id, material["id"], {"topicId": topic["id"], "confirmedAt": _now()}
    )
    return _result(topic["id"], topic["name"], created=created, already=False)


def confirm_syllabus(material: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    """Create or attach the reviewed proposals. Returns {created, attached, skipped, alreadyConfirmed}."""
    analysis = material.get("analysis") or {}
    if analysis.get("kind") != SYLLABUS:
        raise WrongKindOfMaterial()
    if material.get("confirmedAt"):
        return {**material["confirmation"], "alreadyConfirmed": True}

    course_id = material["courseId"]
    proposals = [_content_from(raw) for raw in analysis.get("proposals", [])]
    created: list[dict[str, str]] = []
    attached: list[dict[str, str]] = []
    skipped = 0

    for item in items:
        index = item["index"]
        if not 0 <= index < len(proposals):
            raise BadProposal()
        proposal = proposals[index]
        decision = item["decision"]

        if decision == SKIP:
            skipped += 1
            continue
        if decision == ATTACH:
            topic, was_created = _attach_target(course_id, item.get("topicId"))
        else:
            topic, was_created = _create_or_reuse(course_id, (item.get("title") or proposal.title).strip(), proposal)

        _refresh_description(course_id, topic, proposal)
        (created if was_created else attached).append({"topicId": topic["id"], "name": topic["name"]})

    confirmation = {"created": created, "attached": attached, "skipped": skipped}
    repository.update_material(course_id, material["id"], {"confirmedAt": _now(), "confirmation": confirmation})
    return {**confirmation, "alreadyConfirmed": False}


# --- Helpers ---------------------------------------------------------------------


def _candidates(course_id: str) -> list[TopicCandidate]:
    return [
        TopicCandidate(topic_id=topic["id"], name=topic["name"], description=topic.get("description"))
        for topic in repository.list_topics(course_id)
    ]


def _attach_target(course_id: str, topic_id: str | None) -> tuple[dict[str, Any], bool]:
    topic = repository.get_topic(course_id, topic_id) if topic_id else None
    if topic is None:
        raise TopicGone()
    return topic, False


def _create_or_reuse(course_id: str, title: str, content: MaterialContent) -> tuple[dict[str, Any], bool]:
    """Create the topic - unless one with that name already exists, which is what a retry looks like."""
    wanted = normalize(title)
    for existing in repository.list_topics(course_id):
        if normalize(existing["name"]) == wanted:
            return existing, False

    topic = repository.create_topic(
        course_id,
        title,
        description=describe(content),
        total_minutes=content.estimated_minutes,
    )
    return topic, True


def _refresh_description(course_id: str, topic: dict[str, Any], content: MaterialContent) -> None:
    """The topic's description follows the material just filed under it; progress is never touched."""
    description = describe(content)
    if description and description != topic.get("description"):
        repository.update_topic(course_id, topic["id"], {"description": description})


def describe(content: MaterialContent) -> str | None:
    """Summary plus key points as the topic description. None when there is nothing to say."""
    parts: list[str] = []
    if content.summary:
        parts.append(content.summary)
    if content.key_points:
        parts.append("Key points:\n" + "\n".join(f"- {point}" for point in content.key_points))
    return "\n\n".join(parts) or None


def _content_from(raw: dict[str, Any]) -> MaterialContent:
    return MaterialContent(
        title=raw["title"],
        summary=raw.get("summary"),
        key_points=tuple(raw.get("key_points", ())),
        topics=tuple(raw.get("topics", ())),
        estimated_minutes=raw.get("estimated_minutes"),
        language=raw.get("language", "en"),
    )


def _result(topic_id: str, topic_name: str, *, created: bool, already: bool) -> dict[str, Any]:
    return {"topicId": topic_id, "topicName": topic_name, "created": created, "alreadyConfirmed": already}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def match_to_dict(match: RankedMatch) -> dict[str, Any]:
    """The matcher's answer in the API's shape."""
    return {
        "decision": match.decision,
        "topicId": match.best.topic_id if match.best else None,
        "topicName": match.best.topic_name if match.best else None,
        "confidence": match.best.confidence if match.best else 0.0,
        "reason": match.reason,
        "suggestedTitle": match.suggested_title,
        "alternatives": [
            {
                "topicId": candidate.topic_id,
                "topicName": candidate.topic_name,
                "confidence": candidate.confidence,
                "reason": candidate.reason,
            }
            for candidate in match.alternatives
        ],
        "isAttach": match.decision == ATTACH_EXISTING,
    }
