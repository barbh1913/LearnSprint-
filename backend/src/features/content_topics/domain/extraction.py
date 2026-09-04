"""Topic extraction from course material (FR2.1).

Given the raw lines of a PDF or PPTX, decide which of them are actually topic
headings and which are body text, page furniture, or noise.

The approach is a scoring heuristic rather than a fixed rule: each candidate
line collects points for looking like a heading (numbered, short, no trailing
punctuation, title case) and loses them for looking like prose or boilerplate.
Lines above a threshold become topics. Scoring beats hard rules here because
lecture slides are inconsistent - some number their headings, some don't.

Hebrew and English are both supported, and names are kept in the source
language (never translated), which is the multi-language edge case in CLAUDE.md.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

# Hebrew block in Unicode. Used to pick the right heuristics per line.
HEBREW_PATTERN = re.compile(r"[֐-׿]")

# "1." / "1.2" / "1.2.3" / "chapter 4" / Hebrew letter numbering like "א."
NUMBERING_PATTERN = re.compile(
    r"^\s*(?:\d+(?:\.\d+)*[.)]?|[א-ת][.)]|chapter\s+\d+|part\s+\d+|unit\s+\d+)\s+",
    re.IGNORECASE,
)

BULLET_PATTERN = re.compile(r"^\s*[-*•●▪]\s+")

# Slide furniture that is never a topic.
NOISE_PATTERN = re.compile(
    r"^\s*(?:page\s*\d+|slide\s*\d+|\d+\s*/\s*\d+|[ivxlcdm]+|\d+)\s*$", re.IGNORECASE
)

MIN_TOPIC_LENGTH = 3
MAX_TOPIC_LENGTH = 90
MIN_SCORE_TO_ACCEPT = 2

# A line appearing on this many pages/slides is a header or footer, not a topic.
REPEAT_THRESHOLD = 3


@dataclass(frozen=True)
class ExtractedTopic:
    name: str
    language: str  # "he" or "en"
    score: int


def detect_language(text: str) -> str:
    """"he" if the text contains Hebrew characters, otherwise "en"."""
    return "he" if HEBREW_PATTERN.search(text) else "en"


def extract_topics(lines: list[str], *, max_topics: int = 40) -> list[ExtractedTopic]:
    """Pick the topic headings out of the raw lines of a document.

    Duplicates are collapsed (a heading often repeats on a continuation slide)
    and the original document order is preserved, because the order lecturers
    teach in is usually the order worth studying in.
    """
    repeated = _find_repeated_lines(lines)

    seen: set[str] = set()
    topics: list[ExtractedTopic] = []

    for raw_line in lines:
        name = _clean(raw_line)
        if not name:
            continue

        key = name.casefold()
        if key in seen or name in repeated:
            continue

        score = score_line(name)
        if score < MIN_SCORE_TO_ACCEPT:
            continue

        seen.add(key)
        topics.append(ExtractedTopic(name=name, language=detect_language(name), score=score))

    # If the heuristic was too strict (unusual formatting), fall back to the
    # most heading-like lines so the user still gets something to edit.
    if not topics:
        topics = _best_effort_fallback(lines, repeated)

    return topics[:max_topics]


def score_line(line: str) -> int:
    """How much this line looks like a topic heading. Higher is more likely."""
    if not _is_plausible_length(line) or NOISE_PATTERN.match(line):
        return 0

    score = 0
    word_count = len(line.split())

    if NUMBERING_PATTERN.match(line):
        score += 3
    if BULLET_PATTERN.match(line):
        score += 1

    # Headings are short phrases; prose runs long.
    if 1 <= word_count <= 8:
        score += 2
    elif word_count <= 12:
        score += 1
    else:
        score -= 2

    # Headings don't end in sentence punctuation.
    if not line.rstrip().endswith((".", ",", ";", ":", "!", "?")):
        score += 1

    # Prose is full of connectives; headings rarely are.
    if _looks_like_prose(line):
        score -= 2

    if detect_language(line) == "en" and _is_title_case(line):
        score += 1

    return score


def _clean(line: str) -> str:
    """Strip bullets, numbering and stray whitespace, keeping the wording intact."""
    cleaned = line.strip()
    cleaned = BULLET_PATTERN.sub("", cleaned)
    cleaned = NUMBERING_PATTERN.sub("", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip(" \t-–—:")


def _is_plausible_length(line: str) -> bool:
    return MIN_TOPIC_LENGTH <= len(line) <= MAX_TOPIC_LENGTH


def _looks_like_prose(line: str) -> bool:
    """Sentence connectives are a strong signal this is body text, not a heading."""
    prose_markers = (
        " is ", " are ", " the ", " that ", " which ", " because ", " we ", " you ",
        " של ", " הוא ", " היא ", " אשר ", " כדי ", " שבו ",
    )
    padded = f" {line.casefold()} "
    return sum(marker in padded for marker in prose_markers) >= 2


def _is_title_case(line: str) -> bool:
    words = [word for word in line.split() if word.isalpha()]
    if not words:
        return False
    capitalised = sum(1 for word in words if word[0].isupper())
    return capitalised >= max(1, len(words) // 2)


def _find_repeated_lines(lines: list[str]) -> set[str]:
    """Lines repeating across the document are headers/footers, not topics."""
    counts = Counter(_clean(line) for line in lines if _clean(line))
    return {line for line, count in counts.items() if count >= REPEAT_THRESHOLD}


def _best_effort_fallback(lines: list[str], repeated: set[str]) -> list[ExtractedTopic]:
    """When nothing scores high enough, return the shortest distinct lines.

    Better to hand the student a rough list they can edit (FR2.2) than an empty
    screen after they waited for an upload.
    """
    seen: set[str] = set()
    candidates: list[str] = []

    for raw_line in lines:
        name = _clean(raw_line)
        key = name.casefold()
        if not name or key in seen or name in repeated:
            continue
        if not _is_plausible_length(name) or NOISE_PATTERN.match(name):
            continue
        seen.add(key)
        candidates.append(name)

    candidates.sort(key=len)
    return [
        ExtractedTopic(name=name, language=detect_language(name), score=1)
        for name in candidates[:15]
    ]
