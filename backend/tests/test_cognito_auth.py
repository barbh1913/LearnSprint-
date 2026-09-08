"""Google sign-in through Cognito.

A real Cognito token can't be minted in a test, so these sign tokens with a
throwaway RSA key and point the verifier's JWKS at its public half. What's
actually under test is our side: audience/issuer/token_use checks, creating the
user on first login, and that a Google-only user can't be logged into with a
password.
"""

from __future__ import annotations

import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwk, jwt

from main import app
from shared.auth import cognito
from shared.config import settings

client = TestClient(app)

POOL_ID = "il-central-1_TEST"
CLIENT_ID = "test-client-id"
KID = "test-key-1"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_private_pem = _private_key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
_public_pem = _private_key.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()
_public_jwk = {**jwk.construct(_public_pem, "RS256").to_dict(), "kid": KID}


@pytest.fixture(autouse=True)
def cognito_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cognito_user_pool_id", POOL_ID)
    monkeypatch.setattr(settings, "cognito_client_id", CLIENT_ID)
    monkeypatch.setattr(cognito, "_fetch_jwks", lambda: {"keys": [_public_jwk]})


def mint(email: str = "bar@gmail.com", **overrides) -> str:
    """An id_token the way Cognito would issue it for a Google user."""
    now = int(time.time())
    claims = {
        "sub": "google_123",
        "email": email,
        "token_use": "id",
        "aud": CLIENT_ID,
        "iss": cognito.issuer(),
        "iat": now,
        "exp": now + 600,
    }
    claims.update(overrides)
    return jwt.encode(claims, _private_pem, algorithm="RS256", headers={"kid": KID})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestCognitoIdToken:
    def test_valid_token_is_accepted_and_creates_the_user(self) -> None:
        response = client.get("/auth/me", headers=bearer(mint()))

        assert response.status_code == 200
        assert response.json()["email"] == "bar@gmail.com"

    def test_second_login_reuses_the_same_user(self) -> None:
        first = client.get("/auth/me", headers=bearer(mint())).json()
        second = client.get("/auth/me", headers=bearer(mint())).json()

        assert first["id"] == second["id"]

    def test_wrong_audience_is_rejected(self) -> None:
        response = client.get("/auth/me", headers=bearer(mint(aud="someone-elses-app")))

        assert response.status_code == 401

    def test_wrong_issuer_is_rejected(self) -> None:
        response = client.get(
            "/auth/me", headers=bearer(mint(iss="https://evil.example.com/pool"))
        )

        assert response.status_code == 401

    def test_access_token_is_rejected_even_when_validly_signed(self) -> None:
        # Only the id_token identifies the person; an access_token must not pass.
        response = client.get("/auth/me", headers=bearer(mint(token_use="access")))

        assert response.status_code == 401

    def test_expired_token_is_rejected(self) -> None:
        response = client.get("/auth/me", headers=bearer(mint(exp=int(time.time()) - 60)))

        assert response.status_code == 401

    def test_unknown_signing_key_is_rejected(self) -> None:
        token = jwt.encode(
            {
                "email": "x@example.com",
                "token_use": "id",
                "aud": CLIENT_ID,
                "iss": cognito.issuer(),
                "exp": int(time.time()) + 600,
            },
            _private_pem,
            algorithm="RS256",
            headers={"kid": "not-in-the-jwks"},
        )

        assert client.get("/auth/me", headers=bearer(token)).status_code == 401

    def test_cognito_user_can_use_the_whole_api(self) -> None:
        headers = bearer(mint())

        created = client.post(
            "/courses",
            json={
                "name": "Operating Systems",
                "year": 2,
                "semester": "B",
                "credits": 4,
                "examDate": "2026-12-01",
                "examType": "closed",
            },
            headers=headers,
        )
        listed = client.get("/courses", headers=headers).json()

        assert created.status_code == 201
        assert [course["id"] for course in listed] == [created.json()["id"]]


class TestCoexistence:
    def test_password_login_still_works(self) -> None:
        client.post("/auth/register", json={"email": "local@example.com", "password": "s3cret123"})

        response = client.post(
            "/auth/login", json={"email": "local@example.com", "password": "s3cret123"}
        )

        assert response.status_code == 200

    def test_google_only_user_cannot_log_in_with_a_password(self) -> None:
        client.get("/auth/me", headers=bearer(mint(email="g@gmail.com")))

        response = client.post(
            "/auth/login", json={"email": "g@gmail.com", "password": "anything123"}
        )

        assert response.status_code == 401

    def test_google_login_matches_an_existing_password_account_by_email(self) -> None:
        # Same email through two methods must be one account, or the student's
        # courses would split depending on which button they pressed.
        client.post("/auth/register", json={"email": "both@example.com", "password": "s3cret123"})
        local_token = client.post(
            "/auth/login", json={"email": "both@example.com", "password": "s3cret123"}
        ).json()["access_token"]
        local_me = client.get("/auth/me", headers=bearer(local_token)).json()

        google_me = client.get("/auth/me", headers=bearer(mint(email="both@example.com"))).json()

        assert google_me["id"] == local_me["id"]
