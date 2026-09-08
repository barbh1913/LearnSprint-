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


settings = Settings()
