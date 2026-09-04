"""Auth dependency shared by every feature router.

get_current_user is the single place that turns a bearer token into a user, so
no feature has to know how tokens work.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared.auth import repository
from shared.auth.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise unauthorized

    user = repository.find_by_id(user_id)
    if user is None:
        raise unauthorized

    return user


def get_current_user_id(user: dict[str, Any] = Depends(get_current_user)) -> str:
    """Most routes only need the id, not the whole record."""
    return user["id"]
