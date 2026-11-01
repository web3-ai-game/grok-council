from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.security import (
    COOKIE_NAME,
    cookie_kwargs,
    current_user,
    hash_password,
    hash_session_token,
    issue_session_token,
    session_expiry,
    verify_password,
)
from app.store.db import Database
from app.xai.errors import AppError

router = APIRouter(prefix="/auth")
_USERNAME = re.compile(r"^[a-zA-Z0-9_]{2,32}$")


class AuthBody(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=8, max_length=128)


def _db(request: Request) -> Database:
    return request.app.state.db


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.post("/register")
async def register(body: AuthBody, request: Request, response: Response) -> dict[str, object]:
    settings = _settings(request)
    if not settings.allow_registration:
        raise AppError("registration_closed", "已关闭注册", status_code=403)
    username = body.username.strip()
    if not _USERNAME.match(username):
        raise AppError("invalid_username", "用户名限 2–32 位字母数字下划线", status_code=400)
    db = _db(request)
    existing = await db.get_user_by_username(username)
    if existing is not None:
        raise AppError("username_taken", "用户名已被占用", status_code=409)
    user = await db.create_user(username, hash_password(body.password))
    await _set_session(db, settings, response, str(user["id"]))
    return {"user": {"id": user["id"], "username": user["username"]}}


@router.post("/login")
async def login(body: AuthBody, request: Request, response: Response) -> dict[str, object]:
    db = _db(request)
    settings = _settings(request)
    row = await db.get_user_by_username(body.username.strip())
    if row is None or not verify_password(str(row["password_hash"]), body.password):
        raise AppError("invalid_credentials", "用户名或密码错误", status_code=401)
    await _set_session(db, settings, response, str(row["id"]))
    return {"user": {"id": row["id"], "username": row["username"]}}


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await _db(request).delete_session(hash_session_token(token))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    return {"user": user}


async def _set_session(
    db: Database, settings: Settings, response: Response, user_id: str
) -> None:
    token = issue_session_token()
    expires = session_expiry(settings.session_days)
    await db.create_session(user_id, hash_session_token(token), expires.isoformat())
    response.set_cookie(value=token, **cookie_kwargs(settings))
