"""Unit tests for the topic-extraction heuristic (FR2.1), independent of any
file fixture - just lists of strings, per the module's own design note.
"""

from __future__ import annotations

from features.content_topics.domain import extraction


class TestScoring:
    def test_a_borderline_heading_only_passes_with_its_numbering_credited(self) -> None:
        """Regression: score_line used to be called on the already-cleaned line,
        so a numbered heading's leading "1." (stripped before scoring) could
        never earn the numbering bonus the docstring promises. A caller that
        reports the prefix it stripped (as extract_topics now does) must still
        get credit for it.
        """
        cleaned = "this concept is the reason why systems eventually fail"

        assert extraction.score_line(cleaned) < extraction.MIN_SCORE_TO_ACCEPT
        assert (
            extraction.score_line(cleaned, had_numbering=True)
            >= extraction.MIN_SCORE_TO_ACCEPT
        )

    def test_noise_lines_never_score(self) -> None:
        assert extraction.score_line("Page 3") == 0
        assert extraction.score_line("xiv") == 0
        assert extraction.score_line("12/40") == 0

    def test_detects_hebrew_and_english(self) -> None:
        assert extraction.detect_language("מבוא למבני נתונים") == "he"
        assert extraction.detect_language("Intro to Data Structures") == "en"


class TestExtractTopics:
    def test_numbered_headings_are_picked_up_and_cleaned(self) -> None:
        topics = extraction.extract_topics(
            ["1. Introduction to Graphs", "2. Depth First Search"]
        )

        assert [topic.name for topic in topics] == [
            "Introduction to Graphs",
            "Depth First Search",
        ]

    def test_a_bullet_prefix_is_stripped_from_the_topic_name(self) -> None:
        topics = extraction.extract_topics(["• Recursion and Backtracking"])

        assert topics[0].name == "Recursion and Backtracking"

    def test_lines_repeated_across_the_document_are_excluded_as_headers(self) -> None:
        topics = extraction.extract_topics(
            ["Course 101"] * 3 + ["1. Introduction to Graphs", "2. Depth First Search"]
        )

        names = {topic.name for topic in topics}
        assert "Course 101" not in names
        assert names == {"Introduction to Graphs", "Depth First Search"}

    def test_duplicate_headings_are_collapsed_case_insensitively(self) -> None:
        topics = extraction.extract_topics(
            ["1. Sorting Algorithms", "sorting algorithms", "2. Searching Techniques"]
        )

        assert [topic.name for topic in topics] == [
            "Sorting Algorithms",
            "Searching Techniques",
        ]

    def test_falls_back_to_a_rough_list_when_nothing_scores_high_enough(self) -> None:
        line = "this concept is the reason why systems eventually fail"

        topics = extraction.extract_topics([line])

        assert len(topics) == 1
        assert topics[0].name == line

    def test_no_lines_produces_no_topics(self) -> None:
        assert extraction.extract_topics([]) == []

    def test_respects_the_max_topics_cap(self) -> None:
        lines = [f"{i}. Topic Number {i}" for i in range(1, 46)]

        topics = extraction.extract_topics(lines)

        assert len(topics) == 40
