from pydantic import BaseModel, ConfigDict, EmailStr, Field

# The frontend states the same minimum; Cognito's own policy applies on top and
# its message is passed through when it rejects a password.
MIN_PASSWORD_LENGTH = 8


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=1, max_length=20)
    newPassword: str = Field(min_length=MIN_PASSWORD_LENGTH)


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=MIN_PASSWORD_LENGTH)


class DeleteAccountRequest(BaseModel):
    # The student types the word, so a stray click can never delete an account.
    confirm: str
