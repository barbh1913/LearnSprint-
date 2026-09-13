"""Registration, login and password management on top of Cognito (ADR 0014).

Cognito checks the credentials; LearnSprint then issues its own session token
and keeps the user's profile row. One email is one person: a password account
and a Google sign-in for the same address resolve to the same profile.
"""

from __future__ import annotations

from typing import Any

from shared.auth import cognito_users, repository
from shared.auth.cognito_users import (  # re-exported for the router
    CognitoUnavailable,
    EmailAlreadyRegistered,
    InvalidCode,
    InvalidCredentials,
    UserNotFound,
    WeakPassword,
)

__all__ = [
    "CognitoUnavailable",
    "EmailAlreadyRegistered",
    "InvalidCode",
    "InvalidCredentials",
    "NoPasswordOnAccount",
    "UserNotFound",
    "WeakPassword",
    "authenticate_user",
    "change_password",
    "register_user",
    "request_password_reset",
    "reset_password",
]


class NoPasswordOnAccount(Exception):
    """A Google-only account has no password to change."""


def register_user(email: str, password: str) -> dict[str, Any]:
    normalized = email.lower()
    cognito_users.sign_up(normalized, password)
    return repository.find_or_create_by_email(normalized)


def authenticate_user(email: str, password: str) -> dict[str, Any]:
    normalized = email.lower()
    cognito_users.verify_password(normalized, password)
    # The Cognito account may predate this profile (e.g. created in the console);
    # first successful login creates the profile row the rest of the app keys on.
    return repository.find_or_create_by_email(normalized)


def change_password(email: str, current_password: str, new_password: str) -> None:
    """Verify the current password with Cognito, then set the new one."""
    if not cognito_users.has_password(email):
        raise NoPasswordOnAccount()
    cognito_users.verify_password(email, current_password)
    cognito_users.set_password(email, new_password)


def request_password_reset(email: str) -> None:
    cognito_users.forgot_password(email.lower())


def reset_password(email: str, code: str, new_password: str) -> None:
    cognito_users.confirm_forgot_password(email.lower(), code, new_password)
