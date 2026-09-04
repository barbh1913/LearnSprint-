"""Auth endpoints: register, login, and "who am I"."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from shared.auth.dependencies import get_current_user
from shared.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
from shared.auth.security import create_access_token
from shared.auth.service import (
    EmailAlreadyRegistered,
    InvalidCredentials,
    authenticate_user,
    register_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> TokenResponse:
    try:
        user = register_user(payload.email, payload.password)
    except EmailAlreadyRegistered as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from exc

    return TokenResponse(access_token=create_access_token(user["id"]))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest) -> TokenResponse:
    try:
        user = authenticate_user(payload.email, payload.password)
    except InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        ) from exc

    return TokenResponse(access_token=create_access_token(user["id"]))


@router.get("/me", response_model=UserOut)
def me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return current_user
