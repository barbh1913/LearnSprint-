"""Weighted average calculation (FR1.3).

Pure functions - no DB. A course only counts once it has a grade, and heavier
courses (more credit points) pull the average harder.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GradedCourse:
    course_id: str
    name: str
    semester: str
    year: int
    credits: float
    final_grade: float | None


@dataclass(frozen=True)
class AverageBreakdown:
    """Average for one grouping (a semester, or everything)."""

    label: str
    average: float | None
    total_credits: float
    graded_course_count: int


def weighted_average(courses: list[GradedCourse]) -> float | None:
    """Average grade weighted by credit points. None when nothing is graded yet."""
    graded = [course for course in courses if course.final_grade is not None]
    total_credits = sum(course.credits for course in graded)

    if not graded or total_credits <= 0:
        return None

    weighted_sum = sum(course.final_grade * course.credits for course in graded)  # type: ignore[operator]
    return round(weighted_sum / total_credits, 2)


def average_per_semester(courses: list[GradedCourse]) -> list[AverageBreakdown]:
    """One breakdown per semester, ordered by year then semester."""
    by_semester: dict[tuple[int, str], list[GradedCourse]] = {}
    for course in courses:
        by_semester.setdefault((course.year, course.semester), []).append(course)

    breakdowns = []
    for (year, semester), group in sorted(by_semester.items()):
        graded = [course for course in group if course.final_grade is not None]
        breakdowns.append(
            AverageBreakdown(
                label=f"Year {year} - {semester}",
                average=weighted_average(group),
                total_credits=sum(course.credits for course in graded),
                graded_course_count=len(graded),
            )
        )
    return breakdowns


def overall_average(courses: list[GradedCourse]) -> AverageBreakdown:
    graded = [course for course in courses if course.final_grade is not None]
    return AverageBreakdown(
        label="Overall",
        average=weighted_average(courses),
        total_credits=sum(course.credits for course in graded),
        graded_course_count=len(graded),
    )
