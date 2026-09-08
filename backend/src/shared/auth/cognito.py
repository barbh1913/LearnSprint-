"""Verifies Cognito id_tokens, so a Google sign-in can use the same API.

The frontend sends the id_token rather than the access_token because only the
id_token carries the email claim, and email is how a user is identified across
both login methods. Verification follows the Cognito docs: RS256 against the
pool's published JWKS, audience = the app client id, issuer = the pool URL,
and token_use must be "id".
"""

from __future__ import annotations

import json
import urllib.request
from functools import lru_cache
from typing import Any

from jose import JWTError, jwt

from shared.config import settings


def is_configured() -> bool:
    return bool(settings.cognito_user_pool_id and settings.cognito_client_id)


def issuer() -> str:
    return (
        f"https://cognito-idp.{settings.cognito_region}.amazonaws.com/"
        f"{settings.cognito_user_pool_id}"
    )


@lru_cache(maxsize=1)
def _fetch_jwks() -> dict[str, Any]:
    """The pool's public keys. Cached for the process - they rotate rarely."""
    with urllib.request.urlopen(f"{issuer()}/.well-known/jwks.json", timeout=5) as response:
        return json.load(response)


def verify_id_token(token: str) -> dict[str, Any] | None:
    """Claims of a valid Cognito id_token, or None if it isn't one.

    Returns None instead of raising so the caller can answer a plain 401
    without revealing which check failed.
    """
    if not is_configured():
        return None

    try:
        kid = jwt.get_unverified_header(token).get("kid")
        key = next((k for k in _fetch_jwks()["keys"] if k.get("kid") == kid), None)
        if key is None:
            return None

        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=issuer(),
        )
    except (JWTError, OSError, ValueError, KeyError):
        return None

    if claims.get("token_use") != "id" or not claims.get("email"):
        return None

    return claims
