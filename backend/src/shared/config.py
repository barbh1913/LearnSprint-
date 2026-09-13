from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    # Cognito user pool with Google as an identity provider. Empty means the
    # Cognito path is off and only the local email/password login works.
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    cognito_region: str = "il-central-1"

    # A separate Google OAuth client for Calendar sync (FR6.2, ADR 0010) - the
    # Cognito sign-in above never hands the app a Google token. Empty means the
    # feature is off and the Calendar page hides the Google controls.
    google_calendar_client_id: str = ""
    google_calendar_client_secret: str = ""
    google_calendar_redirect_uri: str = ""
    google_calendar_scope: str = "https://www.googleapis.com/auth/calendar.app.created"
    # The scheduler plans in naive wall-clock time; Google needs to know whose clock.
    google_calendar_time_zone: str = "Asia/Jerusalem"


settings = Settings()
