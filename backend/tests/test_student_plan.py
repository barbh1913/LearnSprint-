"""One plan per student, nearest exam first (ADR 0011), through the real wiring.

Each course's schedule is its slice of the combined plan, so the per-course
endpoint is the right place to observe the combination: sessions of different
courses never overlap, the earlier exam is placed first, and a later course is
judged on the time it actually has left.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def auth_headers(email: str = "planner@example.com") -> dict[str, str]:
    response = client.post("/auth/register", json={"email": email, "password": "s3cret123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_course(
    headers: dict[str, str],
    name: str,
    *topics: str,
    exam_in_days: int | None = 21,
    exam_date: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": name, "year": 2, "semester": "A", "credits": 5, "examType": "closed"}
    if exam_date is not None:
        payload["examDate"] = exam_date
    elif exam_in_days is not None:
        payload["examDate"] = (datetime.now() + timedelta(days=exam_in_days)).isoformat()
    course = client.post("/courses", json=payload, headers=headers).json()
    for topic in topics:
        client.post(f"/courses/{course['id']}/topics", json={"name": topic}, headers=headers)
    return course


def schedule_of(headers: dict[str, str], course: dict[str, Any]) -> dict[str, Any]:
    response = client.get(f"/courses/{course['id']}/schedule", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def intervals(schedule: dict[str, Any]) -> list[tuple[datetime, datetime]]:
    return [
        (datetime.fromisoformat(block["start"]), datetime.fromisoformat(block["end"]))
        for block in schedule["blocks"]
    ]


def overlap(a: list[tuple[datetime, datetime]], b: list[tuple[datetime, datetime]]) -> bool:
    return any(start_a < end_b and start_b < end_a for start_a, end_a in a for start_b, end_b in b)


class TestCombinedPlan:
    def test_two_courses_never_share_a_minute(self) -> None:
        headers = auth_headers()
        soon = create_course(headers, "Data Structures", "Trees", "Graphs", exam_in_days=10)
        later = create_course(headers, "OOP", "Classes", "Inheritance", exam_in_days=30)

        first, second = schedule_of(headers, soon), schedule_of(headers, later)

        assert first["feasible"] and second["feasible"]
        assert first["blocks"] and second["blocks"]
        assert not overlap(intervals(first), intervals(second))

    def test_the_nearer_exam_gets_the_hours_first(self) -> None:
        headers = auth_headers()
        later = create_course(headers, "OOP", "Classes", exam_in_days=30)
        soon = create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        first, second = schedule_of(headers, soon), schedule_of(headers, later)

        # Both plans start from "now", so whoever owns the very first free window went first.
        assert min(intervals(first))[0] < min(intervals(second))[0]

    def test_equal_exam_dates_break_the_tie_by_name(self) -> None:
        headers = auth_headers()
        # The same instant for both, so only the name can decide - and it does so case-insensitively.
        exam = (datetime.now() + timedelta(days=14)).isoformat()
        zoology = create_course(headers, "Zoology", "Cells", exam_date=exam)
        algebra = create_course(headers, "algebra", "Vectors", exam_date=exam)

        first, second = schedule_of(headers, algebra), schedule_of(headers, zoology)

        assert min(intervals(first))[0] < min(intervals(second))[0]
        assert not overlap(intervals(first), intervals(second))

    def test_a_later_course_is_judged_on_what_is_left(self) -> None:
        headers = auth_headers()
        # A big course with an exam in two days eats the free time; the second
        # course, due the same day, must be reported honestly rather than squeezed in.
        hog = create_course(headers, "Compilers", *[f"Chapter {i}" for i in range(12)], exam_in_days=2)
        starved = create_course(headers, "Zoology", "Cells", "Tissues", "Organs", exam_in_days=2)

        first, second = schedule_of(headers, hog), schedule_of(headers, starved)

        assert first["feasible"]
        assert (not second["feasible"]) or second["isEmergencyMode"]
        assert second["totalAvailableMinutes"] < first["totalAvailableMinutes"]
        assert not overlap(intervals(first), intervals(second))

    def test_a_course_without_an_exam_date_is_skipped_and_still_refused(self) -> None:
        headers = auth_headers()
        dated = create_course(headers, "Data Structures", "Trees", exam_in_days=10)
        undated = create_course(headers, "Reading Group", "Papers", exam_in_days=None)

        assert schedule_of(headers, dated)["feasible"]
        assert client.get(f"/courses/{undated['id']}/schedule", headers=headers).status_code == 400

    def test_sessions_start_on_a_clean_five_minute_boundary(self) -> None:
        headers = auth_headers()
        course = create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        first_start = min(intervals(schedule_of(headers, course)))[0]

        assert first_start.minute % 5 == 0
        assert (first_start.second, first_start.microsecond) == (0, 0)

    def test_the_slice_is_stable_across_requests(self) -> None:
        headers = auth_headers()
        create_course(headers, "OOP", "Classes", exam_in_days=30)
        soon = create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        # Both requests land inside the same 5-minute slot, so the plans are identical.
        assert schedule_of(headers, soon)["blocks"] == schedule_of(headers, soon)["blocks"]

    def test_the_all_courses_plan_lists_every_course_nearest_exam_first(self) -> None:
        headers = auth_headers()
        later = create_course(headers, "OOP", "Classes", exam_in_days=30)
        soon = create_course(headers, "Data Structures", "Trees", "Graphs", exam_in_days=10)
        create_course(headers, "Reading Group", "Papers", exam_in_days=None)

        response = client.get("/schedule", headers=headers)

        assert response.status_code == 200, response.text
        plan = response.json()
        assert [course["courseId"] for course in plan["courses"]] == [soon["id"], later["id"]]
        assert plan["courses"][0]["courseName"] == "Data Structures"
        assert plan["courses"][0]["examDate"].startswith(soon["examDate"][:10])
        # A session is a topic event; several per-action blocks fold into one.
        assert plan["sessions"] == len(plan["events"]) > 0
        assert len(plan["events"]) < len(plan["blocks"])
        assert all(event["courseName"] for event in plan["events"])

    def test_the_all_courses_blocks_are_merged_in_time_order_and_labelled(self) -> None:
        headers = auth_headers()
        create_course(headers, "OOP", "Classes", exam_in_days=30)
        create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        plan = client.get("/schedule", headers=headers).json()

        starts = [block["start"] for block in plan["blocks"]]
        assert starts == sorted(starts)
        assert {block["courseName"] for block in plan["blocks"]} == {"Data Structures", "OOP"}
        assert all(block["courseId"] for block in plan["blocks"])
        per_course = sum(len(course["blocks"]) for course in plan["courses"])
        assert len(plan["blocks"]) == per_course

    def test_the_all_courses_metrics_cover_every_displayed_course(self) -> None:
        headers = auth_headers()
        create_course(headers, "OOP", "Classes", exam_in_days=30)
        create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        plan = client.get("/schedule", headers=headers).json()

        assert plan["totalNeededMinutes"] == sum(c["totalNeededMinutes"] for c in plan["courses"])
        # Free time until the latest exam is at least what any single course saw.
        assert plan["totalAvailableMinutes"] >= max(c["totalAvailableMinutes"] for c in plan["courses"])

    def test_the_single_course_slice_matches_the_all_courses_plan(self) -> None:
        headers = auth_headers()
        create_course(headers, "OOP", "Classes", exam_in_days=30)
        soon = create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        plan = client.get("/schedule", headers=headers).json()
        alone = schedule_of(headers, soon)

        from_plan = next(c for c in plan["courses"] if c["courseId"] == soon["id"])
        assert alone["blocks"] == from_plan["blocks"]
        assert alone["blocks"][0]["courseName"] == "Data Structures"

    def test_an_empty_plan_is_empty_not_an_error(self) -> None:
        headers = auth_headers()

        plan = client.get("/schedule", headers=headers).json()

        assert plan == {
            "courses": [],
            "blocks": [],
            "events": [],
            "totalAvailableMinutes": 0,
            "totalNeededMinutes": 0,
            "sessions": 0,
        }

    def test_the_plan_requires_a_signed_in_student(self) -> None:
        assert client.get("/schedule").status_code == 401


class TestAllCoursesIcs:
    def test_exports_every_course_that_fits(self) -> None:
        headers = auth_headers()
        create_course(headers, "OOP", "Classes", exam_in_days=30)
        create_course(headers, "Data Structures", "Trees", exam_in_days=10)

        response = client.get("/schedule.ics", headers=headers)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/calendar")
        assert 'filename="learnsprint-study-plan.ics"' in response.headers["content-disposition"]
        assert "CATEGORIES:OOP" in response.text
        assert "CATEGORIES:Data Structures" in response.text

    def test_nothing_to_export_when_no_plan_fits(self) -> None:
        headers = auth_headers()
        create_course(headers, "Reading Group", "Papers", exam_in_days=None)

        assert client.get("/schedule.ics", headers=headers).status_code == 409

    def test_another_students_courses_do_not_take_my_hours(self) -> None:
        mine = auth_headers("me@example.com")
        theirs = auth_headers("them@example.com")
        create_course(theirs, "Their course", "A", "B", "C", exam_in_days=5)
        course = create_course(mine, "Data Structures", "Trees", exam_in_days=10)

        schedule = schedule_of(mine, course)

        first_start = min(intervals(schedule))[0]
        # My plan starts in the first free window after now - nobody else's sessions moved it.
        assert first_start - datetime.now() < timedelta(days=1)
