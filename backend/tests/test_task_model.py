"""The Topic as the task (ADR 0012): priority levels, description, topic-level
estimates, editable subtasks and attached materials (FR2.2, FR2.3, FR2.6, FR2.9)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from features.content_topics.domain.estimates import split_total_minutes
from main import app
from shared import dynamo

from .conftest import FakeBucket, FakeTable, upload_file

client = TestClient(app)


def auth_headers(email: str = "student@example.com") -> dict[str, str]:
    response = client.post("/auth/register", json={"email": email, "password": "s3cret123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_course(headers: dict[str, str]) -> dict[str, Any]:
    return client.post(
        "/courses",
        json={
            "name": "Data Structures",
            "year": 2,
            "semester": "A",
            "credits": 5,
            "examDate": (datetime.now() + timedelta(days=21)).isoformat(),
            "examType": "closed",
        },
        headers=headers,
    ).json()


def create_topic(headers: dict[str, str], course_id: str, name: str = "Trees", **extra: Any) -> dict[str, Any]:
    response = client.post(f"/courses/{course_id}/topics", json={"name": name, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def card_for(headers: dict[str, str], course_id: str, topic_id: str) -> dict[str, Any]:
    board = client.get(f"/board?courseId={course_id}", headers=headers).json()
    return next(card for card in board["cards"] if card["topicId"] == topic_id)


def invite(owner: dict[str, str], course_id: str, email: str) -> dict[str, str]:
    member = auth_headers(email)
    response = client.post(f"/courses/{course_id}/members", json={"email": email}, headers=owner)
    assert response.status_code in (200, 201), response.text
    return member


class TestSplitTotalMinutes:
    def test_keeps_the_shape_and_adds_up_exactly(self) -> None:
        assert split_total_minutes(270, [60, 45, 30]) == [120, 90, 60]

    def test_rounding_never_loses_a_minute(self) -> None:
        result = split_total_minutes(100, [60, 45, 30])

        assert sum(result) == 100
        assert result[0] > result[1] > result[2]

    def test_a_subtask_never_drops_below_the_floor(self) -> None:
        result = split_total_minutes(40, [100, 5, 5])

        assert sum(result) == 40
        assert min(result) >= 10

    def test_refuses_a_total_that_cannot_honour_the_floor(self) -> None:
        with pytest.raises(ValueError):
            split_total_minutes(25, [60, 45, 30])

    def test_equal_split_when_nothing_is_estimated_yet(self) -> None:
        assert split_total_minutes(90, [0, 0, 0]) == [30, 30, 30]


class TestPriorityAndDescription:
    def test_a_topic_defaults_to_medium_priority(self) -> None:
        headers = auth_headers()
        course = create_course(headers)

        topic = create_topic(headers, course["id"])

        assert topic["priority"] == "medium"
        assert topic["isPriority"] is False

    def test_priority_levels_round_trip_and_only_high_sets_the_flag(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"], priority="low")
        assert topic["priority"] == "low"

        high = client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}", json={"priority": "high"}, headers=headers
        ).json()

        assert (high["priority"], high["isPriority"]) == ("high", True)
        assert card_for(headers, course["id"], topic["id"])["priority"] == "high"

    def test_an_old_item_with_only_the_flag_reads_as_a_level(self, fake_dynamo: FakeTable) -> None:
        headers = auth_headers()
        course = create_course(headers)
        for topic_id, flag in (("old-high", True), ("old-medium", False)):
            fake_dynamo.put(
                {
                    "PK": dynamo.course_pk(course["id"]),
                    "SK": dynamo.topic_sk(topic_id),
                    "entity": "Topic",
                    "id": topic_id,
                    "courseId": course["id"],
                    "name": topic_id,
                    "isPriority": flag,
                }
            )

        topics = {t["id"]: t for t in client.get(f"/courses/{course['id']}/topics", headers=headers).json()}

        assert topics["old-high"]["priority"] == "high"
        assert topics["old-medium"]["priority"] == "medium"
        assert topics["old-medium"]["description"] is None

    def test_description_can_be_set_and_cleared(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        url = f"/courses/{course['id']}/topics/{topic['id']}"

        with_text = client.patch(url, json={"description": "Balanced trees and rotations"}, headers=headers).json()
        assert with_text["description"] == "Balanced trees and rotations"
        assert card_for(headers, course["id"], topic["id"])["description"] == "Balanced trees and rotations"

        cleared = client.patch(url, json={"description": None}, headers=headers).json()
        assert cleared["description"] is None


class TestTopicEstimate:
    def test_a_topic_level_estimate_is_split_across_its_subtasks(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])

        response = client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}", json={"estimatedMinutes": 270}, headers=headers
        )

        assert response.status_code == 200, response.text
        card = card_for(headers, course["id"], topic["id"])
        assert card["totalMinutes"] == 270
        assert [a["durationMinutes"] for a in card["actions"]] == [120, 90, 60]

    def test_each_subtask_stays_editable_on_its_own(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        card = card_for(headers, course["id"], topic["id"])
        quiz = next(a for a in card["actions"] if a["type"] == "quiz")

        client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}/actions/{quiz['id']}",
            json={"durationMinutes": 90},
            headers=headers,
        )

        card = card_for(headers, course["id"], topic["id"])
        assert next(a for a in card["actions"] if a["type"] == "quiz")["durationMinutes"] == 90
        assert card["totalMinutes"] == 60 + 45 + 90

    def test_an_estimate_too_small_for_the_subtasks_is_refused(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])

        response = client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}", json={"estimatedMinutes": 20}, headers=headers
        )

        assert response.status_code == 422


class TestSubtasks:
    def test_defaults_carry_titles_in_order(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])

        actions = card_for(headers, course["id"], topic["id"])["actions"]

        assert [(a["title"], a["order"]) for a in actions] == [("Read", 0), ("Summarize", 1), ("Quiz", 2)]

    def test_adding_a_subtask_appends_it_and_counts_towards_the_topic(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])

        response = client.post(
            f"/courses/{course['id']}/topics/{topic['id']}/actions",
            json={"title": "Solve exercise sheet 3", "durationMinutes": 50},
            headers=headers,
        )

        assert response.status_code == 201, response.text
        created = response.json()
        assert (created["type"], created["title"], created["order"]) == ("custom", "Solve exercise sheet 3", 3)
        card = card_for(headers, course["id"], topic["id"])
        assert card["actions"][-1]["title"] == "Solve exercise sheet 3"
        assert card["totalMinutes"] == 60 + 45 + 30 + 50

    def test_renaming_a_subtask(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        read = card_for(headers, course["id"], topic["id"])["actions"][0]

        response = client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}/actions/{read['id']}",
            json={"title": "Read chapter 4"},
            headers=headers,
        )

        assert response.json()["title"] == "Read chapter 4"
        assert card_for(headers, course["id"], topic["id"])["actions"][0]["title"] == "Read chapter 4"

    def test_an_empty_change_is_refused(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        read = card_for(headers, course["id"], topic["id"])["actions"][0]

        response = client.patch(
            f"/courses/{course['id']}/topics/{topic['id']}/actions/{read['id']}", json={}, headers=headers
        )

        assert response.status_code == 422

    def test_deleting_a_subtask_removes_every_members_progress_on_it(self, fake_dynamo: FakeTable) -> None:
        owner = auth_headers("owner@example.com")
        course = create_course(owner)
        member = invite(owner, course["id"], "peer@example.com")
        topic = create_topic(owner, course["id"])
        quiz = card_for(owner, course["id"], topic["id"])["actions"][2]
        for who in (owner, member):
            client.patch(f"/actions/{quiz['id']}/progress?courseId={course['id']}", json={"isDone": True}, headers=who)
        assert card_for(member, course["id"], topic["id"])["actionsDone"] == 1

        response = client.delete(
            f"/courses/{course['id']}/topics/{topic['id']}/actions/{quiz['id']}", headers=owner
        )

        assert response.status_code == 204
        assert len(card_for(owner, course["id"], topic["id"])["actions"]) == 2
        assert card_for(member, course["id"], topic["id"])["actionsDone"] == 0
        assert not any(item["SK"] == f"APROG#{quiz['id']}" for item in fake_dynamo.items.values())

    def test_a_topic_keeps_at_least_one_subtask(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        actions = card_for(headers, course["id"], topic["id"])["actions"]
        for action in actions[:2]:
            client.delete(f"/courses/{course['id']}/topics/{topic['id']}/actions/{action['id']}", headers=headers)

        response = client.delete(
            f"/courses/{course['id']}/topics/{topic['id']}/actions/{actions[2]['id']}", headers=headers
        )

        assert response.status_code == 409
        assert len(card_for(headers, course["id"], topic["id"])["actions"]) == 1

    def test_status_still_derives_from_all_subtasks_done(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        client.post(
            f"/courses/{course['id']}/topics/{topic['id']}/actions", json={"title": "Extra"}, headers=headers
        )
        for action in card_for(headers, course["id"], topic["id"])["actions"]:
            client.patch(f"/actions/{action['id']}/progress?courseId={course['id']}", json={"isDone": True}, headers=headers)

        card = card_for(headers, course["id"], topic["id"])

        assert card["needsMasteryRating"] is True

    def test_a_custom_subtask_is_scheduled_under_its_own_name(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        client.post(
            f"/courses/{course['id']}/topics/{topic['id']}/actions",
            json={"title": "Solve exercises", "durationMinutes": 40},
            headers=headers,
        )

        schedule = client.get(f"/courses/{course['id']}/schedule", headers=headers).json()

        labels = {block["label"] for block in schedule["blocks"]}
        assert "Solve exercises: Trees" in labels
        assert "Read: Trees" in labels

    def test_a_stranger_cannot_add_subtasks(self) -> None:
        owner = auth_headers("owner@example.com")
        course = create_course(owner)
        topic = create_topic(owner, course["id"])
        stranger = auth_headers("stranger@example.com")

        response = client.post(
            f"/courses/{course['id']}/topics/{topic['id']}/actions", json={"title": "x"}, headers=stranger
        )

        assert response.status_code == 403


def upload(headers: dict[str, str], course_id: str, topic_id: str, *names: str):
    refs = [
        upload_file(client, headers, course_id, name, b"%PDF-1.4 fake " + name.encode())
        for name in names
    ]
    return client.post(
        f"/courses/{course_id}/topics/{topic_id}/materials",
        json={"files": refs},
        headers=headers,
    )


class TestMaterials:
    def test_uploads_are_listed_with_their_details(self, fake_storage: FakeBucket) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])

        response = upload(headers, course["id"], topic["id"], "lecture5.pdf", "notes.docx")

        assert response.status_code == 201, response.text
        listed = client.get(f"/courses/{course['id']}/topics/{topic['id']}/materials", headers=headers).json()
        assert [(m["fileName"], m["fileType"]) for m in listed] == [("lecture5.pdf", "pdf"), ("notes.docx", "docx")]
        assert all(m["sizeBytes"] > 0 and m["uploadedAt"] for m in listed)
        assert len(fake_storage.objects) == 2

    def test_a_download_link_is_short_lived_and_names_the_file(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        [material] = upload(headers, course["id"], topic["id"], "lecture5.pdf").json()

        link = client.get(
            f"/courses/{course['id']}/topics/{topic['id']}/materials/{material['id']}/download", headers=headers
        ).json()

        assert link["expiresInSeconds"] == 300
        assert "filename=lecture5.pdf" in link["url"]

    def test_materials_are_private_to_their_uploader(self) -> None:
        owner = auth_headers("owner@example.com")
        course = create_course(owner)
        member = invite(owner, course["id"], "peer@example.com")
        topic = create_topic(owner, course["id"])
        [material] = upload(owner, course["id"], topic["id"], "lecture5.pdf").json()
        base = f"/courses/{course['id']}/topics/{topic['id']}/materials"

        assert client.get(base, headers=member).json() == []
        assert client.get(f"{base}/{material['id']}/download", headers=member).status_code == 403
        assert client.delete(f"{base}/{material['id']}", headers=member).status_code == 403
        assert client.get(base, headers=owner).json()[0]["id"] == material["id"]

    def test_a_stranger_cannot_reach_a_material_at_all(self) -> None:
        owner = auth_headers("owner@example.com")
        course = create_course(owner)
        topic = create_topic(owner, course["id"])
        [material] = upload(owner, course["id"], topic["id"], "lecture5.pdf").json()
        stranger = auth_headers("stranger@example.com")

        response = client.get(
            f"/courses/{course['id']}/topics/{topic['id']}/materials/{material['id']}/download", headers=stranger
        )

        assert response.status_code == 403

    def test_deleting_a_material_removes_the_file_too(self, fake_storage: FakeBucket) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        [material] = upload(headers, course["id"], topic["id"], "lecture5.pdf").json()

        response = client.delete(
            f"/courses/{course['id']}/topics/{topic['id']}/materials/{material['id']}", headers=headers
        )

        assert response.status_code == 204
        assert client.get(f"/courses/{course['id']}/topics/{topic['id']}/materials", headers=headers).json() == []
        assert fake_storage.objects == {}

    def test_deleting_the_topic_takes_its_materials_with_it(self, fake_storage: FakeBucket, fake_dynamo: FakeTable) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        upload(headers, course["id"], topic["id"], "a.pdf", "b.pdf")

        client.delete(f"/courses/{course['id']}/topics/{topic['id']}", headers=headers)

        assert fake_storage.objects == {}
        assert not any(item["SK"].startswith("MATERIAL#") for item in fake_dynamo.items.values())

    def test_an_empty_file_is_refused(self) -> None:
        headers = auth_headers()
        course = create_course(headers)
        topic = create_topic(headers, course["id"])
        ref = upload_file(client, headers, course["id"], "empty.pdf", b"")

        response = client.post(
            f"/courses/{course['id']}/topics/{topic['id']}/materials",
            json={"files": [ref]},
            headers=headers,
        )

        assert response.status_code == 400

    def test_uploading_to_a_missing_topic_is_a_404(self) -> None:
        headers = auth_headers()
        course = create_course(headers)

        assert upload(headers, course["id"], "no-such-topic", "a.pdf").status_code == 404
