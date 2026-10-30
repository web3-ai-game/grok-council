from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Request

from app.config import Settings
from app.store.db import Database
from app.xai.errors import AppError

COOKIE_NAME = "oece_session"
hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        hasher.verify(password_hash, password)
        return True
    except VerifyMismatchError:
        return False


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_session_token() -> str:
    return secrets.token_urlsafe(32)


def session_expiry(days: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days)


def cookie_kwargs(settings: Settings) -> dict[str, object]:
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "path": "/",
        "max_age": settings.session_days * 24 * 3600,
    }


async def current_user(request: Request) -> dict[str, object]:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise AppError("unauthenticated", "未登录", status_code=401)
    db: Database = request.app.state.db
    row = await db.get_session_user(hash_session_token(token))
    if row is None:
        raise AppError("unauthenticated", "未登录", status_code=401)
    expires_at = datetime.fromisoformat(str(row["expires_at"]))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise AppError("unauthenticated", "会话已过期", status_code=401)
    return {
        "id": row["id"],
        "username": row["username"],
        "created_at": row["created_at"],
    }
