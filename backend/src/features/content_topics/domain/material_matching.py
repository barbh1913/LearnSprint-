"""Deciding which existing topic a piece of material belongs to (FR2.8, FR2.10).

This is LearnSprint's decision, not the AI's (ADR 0013). The AI - or the
keyword heuristic - only says what the material is about: a title, key points,
topics. This module compares that with the course's topics using two plain,
explainable signals and returns a ranked recommendation with a reason in words.

    score = max(term_overlap, TITLE_WEIGHT * title_similarity + TERMS_WEIGHT * term_overlap)
    (and a direct mention of a topic's name is a near-certain match)

Text is compared after Unicode normalisation, case-folding and punctuation
stripping, so Hebrew and English material behaves the same way. Pure functions,
no I/O.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

TITLE_WEIGHT = 0.5
TERMS_WEIGHT = 0.5
# A topic named in the material outright is as good a signal as we get.
MENTION_SCORE = 0.9
# Below this the best candidate isn't worth recommending - suggest a new topic instead.
ATTACH_THRESHOLD = 0.45
# Alternatives weaker than this would only be noise in the dialog.
ALTERNATIVE_THRESHOLD = 0.2
MAX_ALTERNATIVES = 2
STRONG_TITLE_SIMILARITY = 0.6

ATTACH_EXISTING = "attach_existing"
CREATE_NEW = "create_new"

# Words that carry no meaning for matching, English and Hebrew.
STOPWORDS = frozenset(
    """a an the of and or to in on for with is are be by from as at this that
    into over under about between lecture lectures chapter week unit part
    introduction intro overview
    של את על עם אל מן כי או גם לא זה זו הם הן אם יש אין שיעור פרק יחידה מבוא""".split()
)

_PUNCTUATION = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class MaterialContent:
    """What a file is about, as understood by the AI or the heuristic."""

    title: str
    summary: str | None
    key_points: tuple[str, ...]
    topics: tuple[str, ...]
    estimated_minutes: int | None
    language: str


@dataclass(frozen=True)
class TopicCandidate:
    topic_id: str
    name: str
    description: str | None = None


@dataclass(frozen=True)
class Candidate:
    topic_id: str
    topic_name: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class RankedMatch:
    decision: str  # ATTACH_EXISTING | CREATE_NEW
    best: Candidate | None
    reason: str
    suggested_title: str
    alternatives: tuple[Candidate, ...] = field(default_factory=tuple)


def normalize(text: str) -> str:
    """Case-folded, punctuation-free, single-spaced - the form every comparison uses."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return _WHITESPACE.sub(" ", _PUNCTUATION.sub(" ", folded)).strip()


def terms(*texts: str | None) -> frozenset[str]:
    """The meaningful words across the given texts."""
    words: set[str] = set()
    for text in texts:
        if not text:
            continue
        words.update(word for word in normalize(text).split() if len(word) > 1 and word not in STOPWORDS)
    return frozenset(words)


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def rank_against_topics(content: MaterialContent, topics: list[TopicCandidate]) -> RankedMatch:
    """Rank the course's topics for this material and recommend attach-or-create."""
    if not topics:
        return RankedMatch(
            decision=CREATE_NEW,
            best=None,
            reason="The course has no topics yet, so this becomes its first",
            suggested_title=content.title,
        )

    content_terms = terms(content.title, *content.key_points, *content.topics)
    mentioned = {normalize(name) for name in (content.title, *content.topics)}

    scored = sorted(
        (_score(content, content_terms, mentioned, topic) for topic in topics),
        key=lambda candidate: (-candidate.confidence, candidate.topic_name.casefold(), candidate.topic_id),
    )
    best = scored[0]
    alternatives = tuple(
        candidate
        for candidate in scored[1 : 1 + MAX_ALTERNATIVES]
        if candidate.confidence >= ALTERNATIVE_THRESHOLD
    )

    if best.confidence >= ATTACH_THRESHOLD:
        return RankedMatch(
            decision=ATTACH_EXISTING,
            best=best,
            reason=best.reason,
            suggested_title=content.title,
            alternatives=alternatives,
        )

    return RankedMatch(
        decision=CREATE_NEW,
        best=None,
        reason=(
            f"No existing topic covers this material well - the closest is "
            f"'{best.topic_name}' at {_percent(best.confidence)}"
        ),
        suggested_title=content.title,
        # The best candidate is still offered, so "attach anyway" is one click.
        alternatives=tuple(c for c in scored[:MAX_ALTERNATIVES] if c.confidence >= ALTERNATIVE_THRESHOLD),
    )


def _score(
    content: MaterialContent,
    content_terms: frozenset[str],
    mentioned: set[str],
    topic: TopicCandidate,
) -> Candidate:
    topic_terms = terms(topic.name, topic.description)
    shared = sorted(content_terms & topic_terms)
    overlap = len(shared) / len(topic_terms) if topic_terms else 0.0
    similarity = title_similarity(content.title, topic.name)

    # Either the shared terms alone say enough (an exercise sheet rarely shares
    # its title with the lecture), or title and terms together do.
    score = max(overlap, TITLE_WEIGHT * similarity + TERMS_WEIGHT * overlap)
    reasons: list[str] = []

    if normalize(topic.name) in mentioned:
        score = max(score, MENTION_SCORE)
        reasons.append(f"names '{topic.name}' outright")
    if similarity >= STRONG_TITLE_SIMILARITY:
        reasons.append(f"its title is close to '{topic.name}'")
    if shared:
        listed = ", ".join(shared[:4])
        reasons.append(f"shares {len(shared)} of {len(topic_terms)} key terms with '{topic.name}' ({listed})")
    if not reasons:
        reasons.append(f"little in common with '{topic.name}'")

    return Candidate(
        topic_id=topic.topic_id,
        topic_name=topic.name,
        confidence=round(min(score, 1.0), 2),
        reason="The material " + "; ".join(reasons),
    )


def _percent(value: float) -> str:
    return f"{round(value * 100)}%"
