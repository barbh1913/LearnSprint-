"""Password reset, password change and account deletion (ADR 0014).

Cognito is faked in conftest.py; what's under test is our side - the status
codes, the "never reveal whether an email exists" rule, and that deleting an
account removes the student's data without touching anyone else's.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from shared import dynamo
from tests.conftest import FakeBucket, FakeCognito, FakeTable, upload_file

client = TestClient(app)

PASSWORD = "s3cret123"


def register(email: str, password: str = PASSWORD) -> dict[str, str]:
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def login_status(email: str, password: str) -> int:
    return client.post("/auth/login", json={"email": email, "password": password}).status_code


class TestForgotPassword:
    def test_reset_with_the_emailed_code_sets_the_new_password(self, fake_cognito: FakeCognito) -> None:
        register("bar@example.com")

        forgot = client.post("/auth/forgot-password", json={"email": "bar@example.com"})
        reset = client.post(
            "/auth/reset-password",
            json={"email": "bar@example.com", "code": fake_cognito.reset_codes["bar@example.com"], "newPassword": "n3wpassword"},
        )

        assert forgot.status_code == 204
        assert reset.status_code == 204
        assert login_status("bar@example.com", "n3wpassword") == 200
        assert login_status("bar@example.com", PASSWORD) == 401

    def test_forgot_password_never_reveals_whether_the_email_exists(self) -> None:
        response = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})

        assert response.status_code == 204

    def test_wrong_code_is_rejected(self, fake_cognito: FakeCognito) -> None:
        register("bar@example.com")
        client.post("/auth/forgot-password", json={"email": "bar@example.com"})

        response = client.post(
            "/auth/reset-password",
            json={"email": "bar@example.com", "code": "000000", "newPassword": "n3wpassword"},
        )

        assert response.status_code == 400
        assert login_status("bar@example.com", PASSWORD) == 200

    def test_weak_new_password_reports_cognitos_reason(self, fake_cognito: FakeCognito) -> None:
        register("bar@example.com")
        client.post("/auth/forgot-password", json={"email": "bar@example.com"})
        fake_cognito.weak_passwords.add("weakweak")

        response = client.post(
            "/auth/reset-password",
            json={"email": "bar@example.com", "code": "123456", "newPassword": "weakweak"},
        )

        assert response.status_code == 422
        assert "policy" in response.json()["detail"]


class TestChangePassword:
    def test_changes_the_password_after_checking_the_current_one(self) -> None:
        headers = register("bar@example.com")

        response = client.post(
            "/auth/change-password",
            json={"currentPassword": PASSWORD, "newPassword": "n3wpassword"},
            headers=headers,
        )

        assert response.status_code == 204
        assert login_status("bar@example.com", "n3wpassword") == 200
        assert login_status("bar@example.com", PASSWORD) == 401

    def test_wrong_current_password_changes_nothing(self) -> None:
        headers = register("bar@example.com")

        response = client.post(
            "/auth/change-password",
            json={"currentPassword": "notit", "newPassword": "n3wpassword"},
            headers=headers,
        )

        assert response.status_code == 401
        assert login_status("bar@example.com", PASSWORD) == 200

    def test_google_only_account_has_no_password_to_change(self, fake_cognito: FakeCognito) -> None:
        # The profile exists (first Google sign-in created it) but the pool holds no password.
        headers = register("g@gmail.com")
        fake_cognito.users["g@gmail.com"] = None

        response = client.post(
            "/auth/change-password",
            json={"currentPassword": "anything", "newPassword": "n3wpassword"},
            headers=headers,
        )

        assert response.status_code == 400
        assert "Google" in response.json()["detail"]

    def test_requires_a_signed_in_user(self) -> None:
        response = client.post(
            "/auth/change-password", json={"currentPassword": PASSWORD, "newPassword": "n3wpassword"}
        )

        assert response.status_code == 401


class TestDeleteAccount:
    def test_requires_the_typed_confirmation(self, fake_cognito: FakeCognito) -> None:
        headers = register("bar@example.com")

        response = client.request("DELETE", "/auth/me", json={"confirm": "delete"}, headers=headers)

        assert response.status_code == 400
        assert fake_cognito.deleted == []
        assert client.get("/auth/me", headers=headers).status_code == 200

    def test_removes_the_profile_and_the_cognito_user(
        self, fake_cognito: FakeCognito, fake_dynamo: FakeTable
    ) -> None:
        headers = register("bar@example.com")
        client.put(
            "/constraints",
            json={"blockedSlots": [], "timePreference": "morning"},
            headers=headers,
        )

        response = client.request("DELETE", "/auth/me", json={"confirm": "DELETE"}, headers=headers)

        assert response.status_code == 204
        assert fake_cognito.deleted == ["bar@example.com"]
        assert client.get("/auth/me", headers=headers).status_code == 401
        assert login_status("bar@example.com", PASSWORD) == 401
        assert not [key for key in fake_dynamo.items if key[0].startswith("USER#")]

    def test_owned_course_goes_with_its_materials_and_every_members_progress(
        self, fake_dynamo: FakeTable, fake_storage: FakeBucket
    ) -> None:
        owner = register("owner@example.com")
        member = register("member@example.com")
        course_id = self._course(owner)
        topic = client.post(
            f"/courses/{course_id}/topics", json={"name": "Sorting"}, headers=owner
        ).json()
        client.post(f"/courses/{course_id}/members", json={"email": "member@example.com"}, headers=owner)
        ref = upload_file(client, member, course_id, "notes.txt", b"quick sort")
        client.post(
            f"/courses/{course_id}/topics/{topic['id']}/materials",
            json={"files": [ref]},
            headers=member,
        )
        client.patch(f"/topics/{topic['id']}/progress", json={"masteryLevel": 4}, headers=member)

        response = client.request("DELETE", "/auth/me", json={"confirm": "DELETE"}, headers=owner)

        assert response.status_code == 204
        assert not [key for key in fake_dynamo.items if key[0] == dynamo.course_pk(course_id)]
        assert fake_storage.objects == {}
        assert client.get("/courses", headers=member).json() == []
        member_rows = [
            key for key in fake_dynamo.items if key[0].startswith("USER#") and key[1].startswith("TPROG#")
        ]
        assert member_rows == []

    def test_leaves_a_course_owned_by_someone_else_running(
        self, fake_dynamo: FakeTable, fake_storage: FakeBucket
    ) -> None:
        owner = register("owner@example.com")
        member = register("member@example.com")
        course_id = self._course(owner)
        topic = client.post(
            f"/courses/{course_id}/topics", json={"name": "Sorting"}, headers=owner
        ).json()
        client.post(f"/courses/{course_id}/members", json={"email": "member@example.com"}, headers=owner)
        for who, name in ((owner, "owner.txt"), (member, "member.txt")):
            ref = upload_file(client, who, course_id, name, b"notes")
            client.post(
                f"/courses/{course_id}/topics/{topic['id']}/materials",
                json={"files": [ref]},
                headers=who,
            )

        response = client.request("DELETE", "/auth/me", json={"confirm": "DELETE"}, headers=member)

        assert response.status_code == 204
        assert client.get(f"/courses/{course_id}", headers=owner).status_code == 200
        remaining = client.get(
            f"/courses/{course_id}/topics/{topic['id']}/materials", headers=owner
        ).json()
        assert [material["fileName"] for material in remaining] == ["owner.txt"]
        assert len(fake_storage.objects) == 1
        members = client.get(f"/courses/{course_id}/members", headers=owner).json()
        assert [row["email"] for row in members] == ["owner@example.com"]

    @staticmethod
    def _course(headers: dict[str, str]) -> str:
        response = client.post(
            "/courses",
            json={
                "name": "Algorithms",
                "year": 2,
                "semester": "A",
                "credits": 4,
                "examDate": "2027-01-20",
                "examType": "closed",
            },
            headers=headers,
        )
        assert response.status_code == 201
        return response.json()["id"]
