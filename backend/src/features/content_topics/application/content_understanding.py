"""What a document is about - by AI when the backend has a key, otherwise by the heuristic.

Both routes produce the same MaterialContent shape, so everything downstream
(the matcher, the confirmation) never knows which one ran - only the student is
told, in a note (ADR 0013).
"""

from __future__ import annotations

from features.content_topics.domain.extraction import detect_language, extract_topics
from features.content_topics.domain.material_matching import MaterialContent
from features.content_topics.infrastructure import ai_extractor
from shared.config import settings

AI = "ai"
HEURISTIC = "heuristic"
# One file is one academic unit: one topic, with a handful of key points inside
# it - never one topic per heading (FR2.8).
MAX_KEY_POINTS = 5
MAX_HEURISTIC_LECTURES = 30


def understand(lines: list[str], *, file_name: str) -> tuple[MaterialContent, str, str | None]:
    """One file's content. Returns (content, which analyser ran, an optional note)."""
    if settings.system_anthropic_api_key:
        try:
            understood = ai_extractor.understand_material(lines, api_key=settings.system_anthropic_api_key)
            key_points = [point.strip() for point in understood.key_points if point.strip()]
            return (
                MaterialContent(
                    title=understood.title.strip(),
                    summary=understood.summary.strip() or None,
                    key_points=tuple(key_points[:MAX_KEY_POINTS]),
                    topics=tuple(topic.strip() for topic in understood.topics if topic.strip()),
                    estimated_minutes=understood.estimated_minutes,
                    language=understood.language,
                ),
                AI,
                None,
            )
        except ai_extractor.AiAnalysisUnavailable as exc:
            return _heuristic_material(lines, file_name), HEURISTIC, _note(exc)

    return _heuristic_material(lines, file_name), HEURISTIC, None


def propose_lectures(lines: list[str]) -> tuple[list[MaterialContent], str, str | None]:
    """A syllabus as lecture-level proposals. Returns (proposals, which analyser ran, an optional note)."""
    if settings.system_anthropic_api_key:
        try:
            proposals = ai_extractor.propose_lecture_structure(lines, api_key=settings.system_anthropic_api_key)
            return (
                [
                    MaterialContent(
                        title=lecture.title.strip(),
                        summary=lecture.summary.strip() or None,
                        key_points=tuple(point.strip() for point in lecture.key_points if point.strip()),
                        topics=(),
                        estimated_minutes=lecture.estimated_minutes,
                        language=lecture.language,
                    )
                    for lecture in proposals
                    if lecture.title.strip()
                ],
                AI,
                None,
            )
        except ai_extractor.AiAnalysisUnavailable as exc:
            return _heuristic_lectures(lines), HEURISTIC, _note(exc)

    return _heuristic_lectures(lines), HEURISTIC, None


def _heuristic_material(lines: list[str], file_name: str) -> MaterialContent:
    """Without AI: the first heading (or the file name) is the unit's title; the
    strongest of the remaining headings, in document order, are its key points.

    Every heading still feeds the matcher (`topics`) - that is evidence of what
    the file covers, not a proposal to create anything.
    """
    headings = extract_topics(lines)
    title = headings[0].name if headings else _title_from_file_name(file_name)
    strongest = sorted(headings[1:], key=lambda heading: heading.score, reverse=True)[:MAX_KEY_POINTS]
    key_points = [heading.name for heading in headings[1:] if heading in strongest]
    return MaterialContent(
        title=title,
        summary=None,
        key_points=tuple(key_points),
        topics=tuple(heading.name for heading in headings),
        estimated_minutes=None,
        language=detect_language(" ".join(lines[:50])),
    )


def _heuristic_lectures(lines: list[str]) -> list[MaterialContent]:
    """Without AI: one proposal per heading - conservative, never invented."""
    return [
        MaterialContent(
            title=topic.name,
            summary=None,
            key_points=(),
            topics=(),
            estimated_minutes=None,
            language=topic.language,
        )
        for topic in extract_topics(lines, max_topics=MAX_HEURISTIC_LECTURES)
    ]


def _title_from_file_name(file_name: str) -> str:
    stem = file_name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem.replace("_", " ").replace("-", " ").strip() or "Untitled material"


def _note(exc: Exception) -> str:
    return f"AI analysis was unavailable ({exc}), so the built-in analyser ran instead."
