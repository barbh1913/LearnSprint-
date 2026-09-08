"""AI-powered syllabus analysis (optional, opt-in per user).

When the student supplies their own Anthropic API key in their profile, this
runs instead of the keyword heuristic in domain/extraction.py: Claude reads the
raw slide/syllabus text and returns topics with an estimated study duration for
each, which is a much better starting estimate than the fixed per-action
defaults.

The key belongs to the student, is never logged, and is never returned to the
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


def analyse_syllabus(lines: list[str], *, api_key: str) -> list[AnalysedTopic]:
    """Extract topics and per-topic study estimates from document text.

    Raises AiAnalysisUnavailable on any failure - the caller is expected to fall
    back to the keyword heuristic rather than surface an error to the student.
    """
    document = "\n".join(lines)[:MAX_INPUT_CHARS].strip()
    if not document:
        raise AiAnalysisUnavailable("The document had no readable text")

    client = Anthropic(api_key=api_key)

    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"format": SyllabusAnalysis},
            messages=[
                {
                    "role": "user",
                    "content": f"Course material:\n\n{document}",
                }
            ],
        )
    except APIError as exc:
        # Deliberately logs the type, never the key or the document contents.
        logger.warning("AI syllabus analysis failed: %s", type(exc).__name__)
        raise AiAnalysisUnavailable(str(exc)) from exc

    if response.stop_reason == "refusal":
        raise AiAnalysisUnavailable("The model declined to analyse this document")

    analysis = response.parsed_output
    if analysis is None or not analysis.topics:
        raise AiAnalysisUnavailable("The model returned no topics")

    return analysis.topics
