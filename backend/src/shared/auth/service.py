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
    if user is None or not verify_password(password, user["passwordHash"]):
        raise InvalidCredentials(email)
    return user
