from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py → 仓库根目录（.env 所在处）
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    xai_api_key: str
    xai_base_url: str = "https://api.x.ai/v1"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allow_registration: bool = True
    cookie_secure: bool = False
    session_days: int = 30
    sqlite_path: str = ""
    max_council_experts: int = 6
    council_parallel: int = 2
    daily_spend_alert_usd: float = 20.0
    media_path: str = ""

    @property
    def database_path(self) -> Path:
        if self.sqlite_path:
            return Path(self.sqlite_path)
        return REPO_ROOT / "data" / "oece-x.db"

    @property
    def media_root(self) -> Path:
        if self.media_path:
            return Path(self.media_path)
        return REPO_ROOT / "data" / "media"


@lru_cache
def get_settings() -> Settings:
    return Settings()
