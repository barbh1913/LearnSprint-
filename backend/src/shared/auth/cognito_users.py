"""Cognito as the single identity provider (ADR 0014).

Email/password accounts live in the same user pool as the Google sign-in.
Cognito holds the credentials; LearnSprint holds only the profile and the
academic data. Every call here is a thin boto3 wrapper that turns Cognito's
error codes into the handful of exceptions the service layer reasons about.
"""

from __future__ import annotations

import boto3
from botocore.exceptions import ClientError

from shared.config import settings


class CognitoUnavailable(Exception):
    """The pool isn't configured, or Cognito could not be reached."""


class EmailAlreadyRegistered(Exception):
    pass


class InvalidCredentials(Exception):
    pass


class WeakPassword(Exception):
    """Cognito's password policy rejected the password; the message says why."""


class InvalidCode(Exception):
    """The reset code is wrong or expired."""


class UserNotFound(Exception):
    pass


_client = None


def _cognito():
    global _client
    if _client is None:
        _client = boto3.client("cognito-idp", region_name=settings.cognito_region)
    return _client


def is_configured() -> bool:
    return bool(settings.cognito_user_pool_id and settings.cognito_client_id)


def sign_up(email: str, password: str) -> None:
    """Create a confirmed user with a permanent password - no verification email at sign-up."""
    _require_configured()
    try:
        _cognito().admin_create_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            MessageAction="SUPPRESS",
        )
        _cognito().admin_set_user_password(
            UserPoolId=settings.cognito_user_pool_id, Username=email, Password=password, Permanent=True
        )
    except ClientError as exc:
        _raise_for(exc)


def verify_password(email: str, password: str) -> None:
    """Raise InvalidCredentials unless the password is right for this email."""
    _require_configured()
    try:
        _cognito().initiate_auth(
            ClientId=settings.cognito_client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )
    except ClientError as exc:
        _raise_for(exc, not_authorized=InvalidCredentials, user_not_found=InvalidCredentials)


def set_password(email: str, password: str) -> None:
    """Replace the password outright - used after the current one has been verified."""
    _require_configured()
    try:
        _cognito().admin_set_user_password(
            UserPoolId=settings.cognito_user_pool_id, Username=email, Password=password, Permanent=True
        )
    except ClientError as exc:
        _raise_for(exc)


def forgot_password(email: str) -> None:
    """Ask Cognito to email a reset code. Unknown emails are a no-op, on purpose."""
    _require_configured()
    try:
        _cognito().forgot_password(ClientId=settings.cognito_client_id, Username=email)
    except ClientError as exc:
        if _code(exc) == "UserNotFoundException":
            return
        _raise_for(exc)


def confirm_forgot_password(email: str, code: str, password: str) -> None:
    _require_configured()
    try:
        _cognito().confirm_forgot_password(
            ClientId=settings.cognito_client_id, Username=email, ConfirmationCode=code, Password=password
        )
    except ClientError as exc:
        _raise_for(exc)


def has_password(email: str) -> bool:
    """False for an account that only ever signed in with Google - there is no password to change."""
    _require_configured()
    try:
        response = _cognito().list_users(
            UserPoolId=settings.cognito_user_pool_id, Filter=f'email = "{email}"'
        )
    except ClientError as exc:
        _raise_for(exc)
    return any(not user["Username"].startswith("google_") for user in response.get("Users", []))


def delete_user(email: str) -> None:
    """Remove every Cognito user with this email - the native one and a Google-federated one alike."""
    _require_configured()
    try:
        response = _cognito().list_users(
            UserPoolId=settings.cognito_user_pool_id, Filter=f'email = "{email}"'
        )
        for user in response.get("Users", []):
            _cognito().admin_delete_user(UserPoolId=settings.cognito_user_pool_id, Username=user["Username"])
    except ClientError as exc:
        _raise_for(exc)


def _require_configured() -> None:
    if not is_configured():
        raise CognitoUnavailable("Cognito is not configured on this server")


def _code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def _message(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Message", "")


def _raise_for(
    exc: ClientError,
    *,
    not_authorized: type[Exception] = InvalidCredentials,
    user_not_found: type[Exception] = UserNotFound,
) -> None:
    """Translate a Cognito error into the service layer's vocabulary."""
    code = _code(exc)
    if code == "UsernameExistsException":
        raise EmailAlreadyRegistered() from exc
    if code == "NotAuthorizedException":
        raise not_authorized() from exc
    if code == "UserNotFoundException":
        raise user_not_found() from exc
    if code in ("InvalidPasswordException", "InvalidParameterException"):
        # Cognito sometimes reports password-policy and attribute validation
        # failures as InvalidParameterException. Preserve its actionable message
        # instead of reducing it to a generic service-unavailable error.
        raise WeakPassword(_message(exc) or "The account details do not meet Cognito's policy") from exc
    if code in ("CodeMismatchException", "ExpiredCodeException"):
        raise InvalidCode() from exc
    raise CognitoUnavailable(f"Cognito refused the request ({code or 'unknown error'})") from exc
