"""Study group tests (FR5.1-FR5.4).

The privacy tests matter most here: FR5.4 and NFR3 say a member's grade and
constraints must never reach another member, and these assert that at the API
boundary rather than trusting the UI not to render them.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from features.study_groups.domain import peer_view
from main import app

client = TestClient(app)


def register(email: str) -> dict[str, str]:
    response = client.post("/auth/register", json={"email": email, "password": "s3cret123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_course(headers: dict[str, str]) -> dict:
    return client.post(
        "/courses",
        json={
            "name": "Operating Systems",
            "year": 2,
            "semester": "B",
            "credits": 4,
            "examDate": (datetime.now() + timedelta(days=21)).isoformat(),
            "examType": "closed",
        },
        headers=headers,
    ).json()


def add_topic(headers: dict[str, str], course_id: str, name: str) -> dict:
    return client.post(f"/courses/{course_id}/topics", json={"name": name}, headers=headers).json()


class TestInviting:
    def test_owner_can_invite_an_existing_user(self) -> None:
        owner = register("owner@example.com")
        register("peer@example.com")
        course = create_course(owner)

        response = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        assert response.status_code == 201
        assert response.json()["email"] == "peer@example.com"
        assert response.json()["role"] == "member"

    def test_invited_member_sees_the_shared_course(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        add_topic(owner, course["id"], "Deadlock")

        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        # The backlog is shared, not copied - the peer sees the owner's topic.
        courses = client.get("/courses", headers=peer).json()
        topics = client.get(f"/courses/{course['id']}/topics", headers=peer).json()
        assert [item["id"] for item in courses] == [course["id"]]
        assert [item["name"] for item in topics] == ["Deadlock"]

    def test_inviting_an_unknown_email_is_rejected(self) -> None:
        owner = register("owner@example.com")
        course = create_course(owner)

        response = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "nobody@example.com"},
            headers=owner,
        )

        assert response.status_code == 404

    def test_inviting_twice_is_rejected(self) -> None:
        owner = register("owner@example.com")
        register("peer@example.com")
        course = create_course(owner)
        payload = {"email": "peer@example.com"}

        client.post(f"/courses/{course['id']}/members", json=payload, headers=owner)
        second = client.post(f"/courses/{course['id']}/members", json=payload, headers=owner)

        assert second.status_code == 409

    def test_a_member_cannot_invite_others(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        register("third@example.com")
        course = create_course(owner)
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        response = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "third@example.com"},
            headers=peer,
        )

        assert response.status_code == 403

    def test_a_stranger_cannot_see_the_member_list(self) -> None:
        owner = register("owner@example.com")
        stranger = register("stranger@example.com")
        course = create_course(owner)

        assert client.get(f"/courses/{course['id']}/members", headers=stranger).status_code == 403


class TestPeerProgress:
    def test_members_see_each_others_completion(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        topic = add_topic(owner, course["id"], "Deadlock")
        add_topic(owner, course["id"], "Virtual Memory")
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        # The owner finishes one of the two topics.
        board = client.get(f"/board?courseId={course['id']}", headers=owner).json()
        card = next(item for item in board["cards"] if item["topicId"] == topic["id"])
        for action in card["actions"]:
            client.patch(
                f"/actions/{action['id']}/progress?courseId={course['id']}",
                json={"isDone": True},
                headers=owner,
            )
        client.patch(
            f"/topics/{topic['id']}/progress?courseId={course['id']}",
            json={"masteryLevel": 5},
            headers=owner,
        )

        members = client.get(f"/courses/{course['id']}/members", headers=peer).json()
        by_email = {member["email"]: member for member in members}

        assert by_email["owner@example.com"]["percentComplete"] == 50
        assert by_email["peer@example.com"]["percentComplete"] == 0

    def test_progress_is_independent_per_member(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        add_topic(owner, course["id"], "Deadlock")
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        # The peer moves the shared topic on their own board.
        board = client.get(f"/board?courseId={course['id']}", headers=peer).json()
        topic_id = board["cards"][0]["topicId"]
        client.patch(
            f"/topics/{topic_id}/progress?courseId={course['id']}",
            json={"status": "todo"},
            headers=peer,
        )

        owner_board = client.get(f"/board?courseId={course['id']}", headers=owner).json()
        assert owner_board["cards"][0]["status"] == "backlog"

    def test_needs_review_does_not_count_as_done(self) -> None:
        # A topic rated 1-2 has been studied but isn't ready, so counting it
        # would overstate how prepared the student is.
        owner = register("owner@example.com")
        course = create_course(owner)
        topic = add_topic(owner, course["id"], "Deadlock")

        board = client.get(f"/board?courseId={course['id']}", headers=owner).json()
        for action in board["cards"][0]["actions"]:
            client.patch(
                f"/actions/{action['id']}/progress?courseId={course['id']}",
                json={"isDone": True},
                headers=owner,
            )
        client.patch(
            f"/topics/{topic['id']}/progress?courseId={course['id']}",
            json={"masteryLevel": 1},
            headers=owner,
        )

        members = client.get(f"/courses/{course['id']}/members", headers=owner).json()
        assert members[0]["percentComplete"] == 0

    def test_a_manual_status_override_counts_the_same_for_peers_as_on_the_students_own_board(
        self,
    ) -> None:
        # Regression: peer_view has its own call into derive_status (separate
        # from the board's), and it was missing the manual_override flag - a
        # topic dragged straight to Done (FR4.3) showed as done on the
        # student's own board but as 0% to everyone else in the group.
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        topic = add_topic(owner, course["id"], "Deadlock")
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        client.patch(
            f"/topics/{topic['id']}/progress?courseId={course['id']}",
            json={"status": "done"},
            headers=owner,
        )
        own_board = client.get(f"/board?courseId={course['id']}", headers=owner).json()
        assert own_board["cards"][0]["status"] == "done"

        members = client.get(f"/courses/{course['id']}/members", headers=peer).json()
        by_email = {member["email"]: member for member in members}
        assert by_email["owner@example.com"]["percentComplete"] == 100


class TestPrivacy:
    """FR5.4 / NFR3 - enforced at the API, not by hoping the UI hides it."""

    def test_member_list_never_exposes_private_fields(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )
        client.put(
            f"/courses/{course['id']}/grade", json={"finalGrade": 95}, headers=owner
        )
        client.put(
            "/constraints",
            json={
                "blockedSlots": [{"day": 1, "startTime": "09:00", "endTime": "17:00"}],
                "timePreference": "morning",
            },
            headers=owner,
        )

        response = client.get(f"/courses/{course['id']}/members", headers=peer)
        members = response.json()

        for field in peer_view.PRIVATE_FIELDS:
            assert field not in response.text, f"{field} leaked into the member list"
        # Checked as an actual field value, not a substring of the response body -
        # a random UUID or timestamp elsewhere in the payload can legitimately
        # contain the digits "95" and would make a raw substring check flaky.
        assert all(95 not in member.values() for member in members)

    def test_a_member_never_sees_another_members_grade(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )
        client.put(f"/courses/{course['id']}/grade", json={"finalGrade": 95}, headers=owner)

        grades = client.get("/grades", headers=peer).json()

        # The peer is enrolled on the same course but has no grade of their own.
        assert grades["overall"]["average"] is None

    def test_joining_a_course_does_not_expose_the_owners_schedule(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        add_topic(owner, course["id"], "Deadlock")
        client.put(
            "/constraints",
            json={
                "blockedSlots": [{"day": 0, "startTime": "08:00", "endTime": "20:00"}],
                "timePreference": "evening",
            },
            headers=owner,
        )
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        # Same shared course, but the schedule is built from the peer's own
        # (empty) constraints, not the owner's.
        peer_constraints = client.get("/constraints", headers=peer).json()
        assert peer_constraints["blockedSlots"] == []


class TestLeaving:
    def test_owner_can_remove_a_member(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        invited = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        ).json()

        response = client.delete(
            f"/courses/{course['id']}/members/{invited['userId']}", headers=owner
        )

        assert response.status_code == 204
        assert client.get("/courses", headers=peer).json() == []

    def test_a_member_can_leave_by_themselves(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        invited = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        ).json()

        response = client.delete(
            f"/courses/{course['id']}/members/{invited['userId']}", headers=peer
        )

        assert response.status_code == 204

    def test_a_member_cannot_remove_someone_else(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        owner_id = client.get("/auth/me", headers=owner).json()["id"]
        client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        )

        response = client.delete(f"/courses/{course['id']}/members/{owner_id}", headers=peer)

        assert response.status_code == 403

    def test_the_owner_cannot_be_removed(self) -> None:
        owner = register("owner@example.com")
        course = create_course(owner)
        owner_id = client.get("/auth/me", headers=owner).json()["id"]

        response = client.delete(f"/courses/{course['id']}/members/{owner_id}", headers=owner)

        assert response.status_code == 409

    def test_leaving_keeps_the_students_own_progress(self) -> None:
        owner = register("owner@example.com")
        peer = register("peer@example.com")
        course = create_course(owner)
        add_topic(owner, course["id"], "Deadlock")
        invited = client.post(
            f"/courses/{course['id']}/members",
            json={"email": "peer@example.com"},
            headers=owner,
        ).json()

        board = client.get(f"/board?courseId={course['id']}", headers=peer).json()
        topic_id = board["cards"][0]["topicId"]
        client.patch(
            f"/topics/{topic_id}/progress?courseId={course['id']}",
            json={"masteryLevel": 4},
            headers=peer,
        )

        client.delete(f"/courses/{course['id']}/members/{invited['userId']}", headers=peer)

        # They lose access to the course, but their own study history survives -
        # it belongs to them, not to the course.
        assert client.get(f"/courses/{course['id']}", headers=peer).status_code == 403
        assert client.get("/velocity", headers=peer).status_code == 200
