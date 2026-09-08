"""Registration and login."""

from __future__ import annotations

from typing import Any

from shared.auth import repository
from shared.auth.security import hash_password, verify_password


class EmailAlreadyRegistered(Exception):
    pass


class InvalidCredentials(Exception):
    pass


def register_user(email: str, password: str) -> dict[str, Any]:
    if repository.find_by_email(email) is not None:
        raise EmailAlreadyRegistered(email)

    return repository.create_user(email, hash_password(password))


def authenticate_user(email: str, password: str) -> dict[str, Any]:
    user = repository.find_by_email(email)
    if user is None:
        raise InvalidCredentials(email)

    # No stored hash means the account came from Google sign-in. There is no
    # password to check, so a password login has to fail.
    password_hash = user.get("passwordHash")
    if not password_hash or not verify_password(password, password_hash):
        raise InvalidCredentials(email)
    return user
