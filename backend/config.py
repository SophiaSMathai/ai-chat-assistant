"""
config.py
---------
Centralized application configuration.

Loads environment variables (from a local `.env` file in development, or
from the hosting platform's environment variable settings in production)
using pydantic-settings. This keeps secrets out of source code and gives
us validated, typed config values everywhere else in the app.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Gemini API ---
    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-3.1-flash-lite"

    # --- App / CORS ---
    # Comma-separated list of allowed frontend origins, e.g.
    # "http://localhost:5500,https://my-frontend.onrender.com"
    ALLOWED_ORIGINS: str = "*"

    # --- Chat behavior ---
    MAX_HISTORY_MESSAGES: int = 40  # safety cap on in-memory session length

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings accessor. Using lru_cache means the .env file (or real
    environment variables) are only parsed once per process, and every
    module that calls get_settings() shares the same Settings instance.
    """
    return Settings()
