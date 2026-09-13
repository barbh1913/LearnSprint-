"""AI-powered analysis of course material (FR2.7, ADR 0013).

When the backend has an Anthropic key configured, this runs instead of the
keyword heuristic in domain/extraction.py: Claude reads the raw slide/syllabus
text and returns topics with an estimated study duration for each, which is a
much better starting estimate than the fixed per-action defaults.

The key is the backend's own, is never logged, and is never returned to the
frontend. If anything here fails - no key, bad key, rate limit, malformed
response - the caller falls back to the heuristic, so an AI outage can never
block an upload.
"""

from __future__ import annotations

import logging

from anthropic import Anthropic, APIError
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MODEL = "claude-opus-4-8"
MAX_TOKENS = 8000

# Only the first slice of the document is sent: syllabi front-load their
# structure, and this bounds both cost and latency.
MAX_INPUT_CHARS = 40_000

SYSTEM_PROMPT = """You analyse university course material and turn it into a study plan.

Given the raw text of a syllabus or lecture deck, identify the distinct study
topics a student would need to revise for the exam.

Rules:
- Return real subject topics, not slide furniture (page numbers, the course
  name repeated on every slide, "Questions?", the lecturer's name).
- Keep each topic name in the language it appears in. Never translate.
- Merge topics that are obviously the same subject split across slides.
- Estimate how many minutes an average student needs to read and understand
  each topic. Base it on how much material the document devotes to it, not on
  a fixed number.
- Order topics the way the course teaches them.
- Aim for 5-30 topics. If the document is too thin to tell, return what you can."""


class AnalysedTopic(BaseModel):
    """One topic the model identified."""

    name: str = Field(description="Topic name, in its original language")
    estimated_minutes: int = Field(
        ge=10, le=300, description="Minutes an average student needs to read this topic"
    )
    language: str = Field(description="Two-letter code of the topic name's language, he or en")


class SyllabusAnalysis(BaseModel):
    topics: list[AnalysedTopic]


class AiAnalysisUnavailable(Exception):
    """Raised when AI analysis can't run, so the caller falls back to the heuristic."""


# --- Content understanding for the analysis flows (FR2.8, FR2.10, ADR 0013) ---
#
# These describe what a document is about. They are never shown a topic id and
# never choose one: matching is LearnSprint's own deterministic step.

MATERIAL_PROMPT = """You describe one piece of university course material so a study planner can file it.

The file is ONE academic unit - one lecture, one exercise sheet, one chapter -
and becomes ONE study topic. Never split it into a topic per slide, heading or
section; those belong inside the unit as key points.

Given its raw text, work out:
- a short title for the unit as a whole, in the material's own language (never translate),
- a summary of two to four sentences a student could revise from,
- one to five key points - the main concepts, methods or results it teaches,
  each a meaningful subtopic rather than a slide title,
- the study topics it touches, as short names (used only to match it against the
  course's existing topics),
- how many minutes an average student needs to read and understand it, based on
  how much real content there is,
- the two-letter language code of the material (he or en).

Ignore slide furniture: page numbers, the course name repeated on every slide,
the lecturer's name, "Questions?"."""

SYLLABUS_PROMPT = """You turn a university syllabus into a lecture-level study backlog.

Given the raw text of a syllabus or course outline, identify its lectures, weeks
or sessions - roughly one entry per lecture. Do not split a lecture into its
subtopics; those belong inside the entry as key points.

For each entry give a title (in the document's own language, never translated),
a two-to-four sentence summary, three to eight key points, an estimate of the
minutes an average student needs for it, and the two-letter language code.

Keep the document's order. If the document has no recognisable lecture
structure, return its few main units rather than inventing lectures."""


class MaterialUnderstanding(BaseModel):
    """What one file - one academic unit, one topic - is about."""

    title: str = Field(description="Short title for the unit as a whole, in its own language")
    summary: str = Field(description="Two to four sentences a student could revise from")
    key_points: list[str] = Field(description="One to five main concepts, methods or results it teaches")
    topics: list[str] = Field(description="Short names of the study topics it touches, for matching")
    estimated_minutes: int = Field(ge=10, le=600, description="Minutes an average student needs for it")
    language: str = Field(description="Two-letter language code, he or en")


class LectureProposal(BaseModel):
    """One lecture-level entry of a syllabus."""

    title: str = Field(description="Lecture title, in the document's own language")
    summary: str = Field(description="Two to four sentences describing the lecture")
    key_points: list[str] = Field(description="Three to eight key points inside this lecture")
    estimated_minutes: int = Field(ge=10, le=600, description="Minutes an average student needs for it")
    language: str = Field(description="Two-letter language code, he or en")


class SyllabusStructure(BaseModel):
    lectures: list[LectureProposal]


def analyse_syllabus(lines: list[str], *, api_key: str) -> list[AnalysedTopic]:
    """Extract topics and per-topic study estimates from document text (the batch upload, FR2.1).

    Raises AiAnalysisUnavailable on any failure - the caller is expected to fall
    back to the keyword heuristic rather than surface an error to the student.
    """
    analysis = _parse(lines, api_key=api_key, system=SYSTEM_PROMPT, schema=SyllabusAnalysis, what="topics")
    if not analysis.topics:
        raise AiAnalysisUnavailable("The model returned no topics")
    return analysis.topics


def understand_material(lines: list[str], *, api_key: str) -> MaterialUnderstanding:
    """What one file covers: title, summary, key points, topics, an estimate (FR2.8)."""
    understanding = _parse(
        lines, api_key=api_key, system=MATERIAL_PROMPT, schema=MaterialUnderstanding, what="material"
    )
    if not understanding.title.strip():
        raise AiAnalysisUnavailable("The model returned no title")
    return understanding


def propose_lecture_structure(lines: list[str], *, api_key: str) -> list[LectureProposal]:
    """Roughly one entry per lecture of a syllabus, each with summary and key points (FR2.10)."""
    structure = _parse(
        lines, api_key=api_key, system=SYLLABUS_PROMPT, schema=SyllabusStructure, what="lectures"
    )
    if not structure.lectures:
        raise AiAnalysisUnavailable("The model found no lectures")
    return structure.lectures


def _parse(lines: list[str], *, api_key: str, system: str, schema: type, what: str):
    """One structured-output call. Any failure becomes AiAnalysisUnavailable."""
    document = "\n".join(lines)[:MAX_INPUT_CHARS].strip()
    if not document:
        raise AiAnalysisUnavailable("The document had no readable text")

    client = Anthropic(api_key=api_key)

    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            thinking={"type": "adaptive"},
            output_config={"format": schema},
            messages=[
                {
                    "role": "user",
                    "content": f"Course material:\n\n{document}",
                }
            ],
        )
    except APIError as exc:
        # Deliberately logs the type, never the key or the document contents.
        logger.warning("AI %s analysis failed: %s", what, type(exc).__name__)
        raise AiAnalysisUnavailable(str(exc)) from exc

    if response.stop_reason == "refusal":
        raise AiAnalysisUnavailable("The model declined to analyse this document")

    parsed = response.parsed_output
    if parsed is None:
        raise AiAnalysisUnavailable(f"The model returned no {what}")

    return parsed
