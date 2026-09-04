"""Course, grade and constraint endpoints (FR1).

Thin by design: parse, call the repository or the domain calculation, return.
No business logic lives here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from features.academic_profile.application.schemas import (
    AverageOut,
    ConstraintsIn,
    ConstraintsOut,
    CourseCreate,
    CourseOut,
    CourseUpdate,
    GradesOut,
    GradeUpdate,
)
from features.academic_profile.domain.grades import (
    AverageBreakdown,
    GradedCourse,
    average_per_semester,
    overall_average,
)
from features.academic_profile.infrastructure import repository
from shared.auth.dependencies import get_current_user_id

router = APIRouter(tags=["academic-profile"])


@router.post("/courses", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, user_id: str = Depends(get_current_user_id)) -> CourseOut:
    course = repository.create_course(user_id, payload.model_dump())
    return _course_to_out(course, final_grade=None, role="owner")


@router.get("/courses", response_model=list[CourseOut])
def list_courses(user_id: str = Depends(get_current_user_id)) -> list[CourseOut]:
    return [_membership_to_course(item) for item in repository.list_memberships(user_id)]


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: str, user_id: str = Depends(get_current_user_id)) -> CourseOut:
    membership = _require_membership(user_id, course_id)
    course = repository.get_course(course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    return _course_to_out(course, membership.get("finalGrade"), membership["role"])


@router.patch("/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: str, payload: CourseUpdate, user_id: str = Depends(get_current_user_id)
) -> CourseOut:
    membership = _require_membership(user_id, course_id)
    course = repository.update_course(course_id, payload.model_dump(exclude_unset=True))
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    return _course_to_out(course, membership.get("finalGrade"), membership["role"])


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: str, user_id: str = Depends(get_current_user_id)) -> None:
    membership = _require_membership(user_id, course_id)
    if membership["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the course owner can delete it")

    repository.delete_course(course_id)


@router.put("/courses/{course_id}/grade", response_model=CourseOut)
def set_grade(
    course_id: str, payload: GradeUpdate, user_id: str = Depends(get_current_user_id)
) -> CourseOut:
    _require_membership(user_id, course_id)
    updated = repository.set_final_grade(user_id, course_id, payload.finalGrade)
    if updated is None:
        raise HTTPException(status_code=404, detail="Course not found")

    return _membership_to_course(updated)


@router.get("/grades", response_model=GradesOut)
def get_grades(user_id: str = Depends(get_current_user_id)) -> GradesOut:
    memberships = repository.list_memberships(user_id)
    graded_courses = [
        GradedCourse(
            course_id=item["courseId"],
            name=item.get("courseName", ""),
            semester=item.get("semester", ""),
            year=item.get("year", 1),
            credits=float(item.get("credits", 0)),
            final_grade=item.get("finalGrade"),
        )
        for item in memberships
    ]

    return GradesOut(
        overall=_to_average_out(overall_average(graded_courses)),
        perSemester=[_to_average_out(item) for item in average_per_semester(graded_courses)],
        courses=[_membership_to_course(item) for item in memberships],
    )


@router.get("/constraints", response_model=ConstraintsOut)
def get_constraints(user_id: str = Depends(get_current_user_id)) -> ConstraintsOut:
    stored = repository.get_constraints(user_id)
    return ConstraintsOut(
        blockedSlots=stored.get("blockedSlots", []),
        timePreference=stored.get("timePreference", "evening"),
    )


@router.put("/constraints", response_model=ConstraintsOut)
def save_constraints(
    payload: ConstraintsIn, user_id: str = Depends(get_current_user_id)
) -> ConstraintsOut:
    saved = repository.save_constraints(
        user_id,
        [slot.model_dump() for slot in payload.blockedSlots],
        payload.timePreference,
    )
    return ConstraintsOut(
        blockedSlots=saved["blockedSlots"], timePreference=saved["timePreference"]
    )


def _require_membership(user_id: str, course_id: str) -> dict[str, Any]:
    """403 rather than 404 - don't confirm a course exists to someone without access."""
    membership = repository.get_membership(user_id, course_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="You do not have access to this course")
    return membership


def _course_to_out(course: dict[str, Any], final_grade: float | None, role: str) -> CourseOut:
    return CourseOut(
        id=course["id"],
        name=course["name"],
        year=course["year"],
        semester=course["semester"],
        credits=float(course["credits"]),
        examDate=course.get("examDate"),
        examType=course.get("examType", "closed"),
        finalGrade=final_grade,
        role=role,
    )


def _membership_to_course(membership: dict[str, Any]) -> CourseOut:
    return CourseOut(
        id=membership["courseId"],
        name=membership.get("courseName", ""),
        year=membership.get("year", 1),
        semester=membership.get("semester", ""),
        credits=float(membership.get("credits", 0)),
        examDate=membership.get("examDate"),
        examType=membership.get("examType", "closed"),
        finalGrade=membership.get("finalGrade"),
        role=membership.get("role", "owner"),
    )


def _to_average_out(breakdown: AverageBreakdown) -> AverageOut:
    return AverageOut(
        label=breakdown.label,
        average=breakdown.average,
        totalCredits=breakdown.total_credits,
        gradedCourseCount=breakdown.graded_course_count,
    )
