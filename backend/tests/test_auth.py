"""Auth endpoint tests. DynamoDB is faked out in conftest.py."""

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_register_then_login_then_me() -> None:
    register = client.post(
        "/auth/register", json={"email": "bar@example.com", "password": "s3cret123"}
    )
    assert register.status_code == 201
    assert "access_token" in register.json()

    login = client.post(
        "/auth/login", json={"email": "bar@example.com", "password": "s3cret123"}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "bar@example.com"


def test_register_duplicate_email_returns_409() -> None:
    client.post("/auth/register", json={"email": "dup@example.com", "password": "s3cret123"})

    response = client.post(
        "/auth/register", json={"email": "dup@example.com", "password": "other123"}
    )

    assert response.status_code == 409


def test_email_is_case_insensitive() -> None:
    client.post("/auth/register", json={"email": "Bar@Example.com", "password": "s3cret123"})

    response = client.post(
        "/auth/login", json={"email": "bar@example.com", "password": "s3cret123"}
    )

    assert response.status_code == 200


def test_login_with_wrong_password_returns_401() -> None:
    client.post("/auth/register", json={"email": "wrong@example.com", "password": "correct123"})

    response = client.post(
        "/auth/login", json={"email": "wrong@example.com", "password": "incorrect"}
    )

    assert response.status_code == 401


def test_login_for_unknown_user_returns_401() -> None:
    response = client.post(
        "/auth/login", json={"email": "ghost@example.com", "password": "whatever123"}
    )

    assert response.status_code == 401


def test_me_without_token_returns_401() -> None:
    assert client.get("/auth/me").status_code == 401


def test_me_with_garbage_token_returns_401() -> None:
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})

    assert response.status_code == 401
