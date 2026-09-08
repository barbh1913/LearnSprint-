"""Auth dependency shared by every feature router.

get_current_user is the single place that turns a bearer token into a user, so
no feature has to know how tokens work.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from shared.auth import cognito, repository
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

    user = _resolve_user(credentials.credentials)
    if user is None:
        raise unauthorized

    return user


def _resolve_user(token: str) -> dict[str, Any] | None:
    """Turn a bearer token into a user record, whichever system issued it.

    Our own tokens are HS256; Cognito's are RS256. The header says which, so
    every token is checked against exactly one verifier and never both.
    """
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
    except JWTError:
        return None

    if algorithm == "RS256":
        claims = cognito.verify_id_token(token)
        if claims is None:
            return None
        return repository.find_or_create_by_email(claims["email"])

    user_id = decode_access_token(token)
    return repository.find_by_id(user_id) if user_id else None


def get_current_user_id(user: dict[str, Any] = Depends(get_current_user)) -> str:
    """Most routes only need the id, not the whole record."""
    return user["id"]
