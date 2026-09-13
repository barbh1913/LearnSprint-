"""Auth endpoints: register, login, "who am I", passwords, and account deletion (ADR 0014)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from features.academic_profile.application import account_deletion
from shared.auth import cognito_users
from shared.auth.dependencies import get_current_user
from shared.auth.schemas import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserOut,
)
from shared.auth.security import create_access_token
from shared.auth.service import (
    CognitoUnavailable,
    EmailAlreadyRegistered,
    InvalidCode,
    InvalidCredentials,
    NoPasswordOnAccount,
    UserNotFound,
    WeakPassword,
    authenticate_user,
    change_password,
    register_user,
    request_password_reset,
    reset_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

DELETE_CONFIRMATION = "DELETE"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> TokenResponse:
    try:
        user = register_user(payload.email, payload.password)
    except EmailAlreadyRegistered as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from exc
    except WeakPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CognitoUnavailable as exc:
        raise _unavailable(exc)

    return TokenResponse(access_token=create_access_token(user["id"]))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest) -> TokenResponse:
    try:
        user = authenticate_user(payload.email, payload.password)
    except InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        ) from exc
    except CognitoUnavailable as exc:
        raise _unavailable(exc)

    return TokenResponse(access_token=create_access_token(user["id"]))


@router.get("/me", response_model=UserOut)
def me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return current_user


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(payload: ForgotPasswordRequest) -> None:
    """Email a reset code. Always 204 - the response never says whether the email exists."""
    try:
        request_password_reset(payload.email)
    except CognitoUnavailable as exc:
        raise _unavailable(exc)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password_endpoint(payload: ResetPasswordRequest) -> None:
    try:
        reset_password(payload.email, payload.code, payload.newPassword)
    except (InvalidCode, UserNotFound) as exc:
        raise HTTPException(status_code=400, detail="That code is wrong or has expired") from exc
    except WeakPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CognitoUnavailable as exc:
        raise _unavailable(exc)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password_endpoint(
    payload: ChangePasswordRequest, current_user: dict[str, Any] = Depends(get_current_user)
) -> None:
    try:
        change_password(current_user["email"], payload.currentPassword, payload.newPassword)
    except NoPasswordOnAccount as exc:
        raise HTTPException(
            status_code=400, detail="This account signs in with Google and has no password to change"
        ) from exc
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail="The current password is wrong") from exc
    except WeakPassword as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CognitoUnavailable as exc:
        raise _unavailable(exc)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: DeleteAccountRequest, current_user: dict[str, Any] = Depends(get_current_user)
) -> None:
    """Remove the student's LearnSprint data, then their Cognito user.

    Data first: if Cognito then fails, the person can still sign in and retry;
    the other order could leave data nobody can reach.
    """
    if payload.confirm != DELETE_CONFIRMATION:
        raise HTTPException(status_code=400, detail=f'Type {DELETE_CONFIRMATION} to confirm')

    account_deletion.delete_account_data(current_user["id"])
    try:
        cognito_users.delete_user(current_user["email"])
    except CognitoUnavailable as exc:
        raise _unavailable(exc)


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))
