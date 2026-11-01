from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.security import current_user
from app.store.council_repo import CouncilRepo
from app.store.db import Database
from app.xai.errors import AppError
from app.xai.registry import DEFAULT_MODEL_ID

router = APIRouter(prefix="/chats")


class CreateChatBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    temporary: bool = False
    mode: str = "auto"
    model: str | None = None
    project_id: str | None = None


class PatchChatBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    pinned: bool | None = None


def _db(request: Request) -> Database:
    return request.app.state.db


def _public_chat(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "mode": row["mode"],
        "model": row["model"],
        "pinned": bool(row["pinned"]),
        "temporary": bool(row["temporary"]),
        "project_id": row.get("project_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _public_message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "role": row["role"],
        "content": row["content"],
        "reasoning_summary": row["reasoning_summary"],
        "model": row["model"],
        "mode": row["mode"],
        "parent_id": row["parent_id"],
        "created_at": row["created_at"],
    }


@router.get("")
async def list_chats(
    request: Request,
    q: str | None = None,
    project_id: str | None = None,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    rows = await _db(request).list_chats(str(user["id"]), q=q, project_id=project_id)
    return {"chats": [_public_chat(r) for r in rows]}


@router.post("")
async def create_chat(
    body: CreateChatBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _db(request).create_chat(
        str(user["id"]),
        (body.title or "新会话").strip() or "新会话",
        mode=body.mode,
        model=body.model or DEFAULT_MODEL_ID,
        temporary=body.temporary,
        project_id=body.project_id,
    )
    return {"chat": _public_chat(row)}


@router.get("/{chat_id}")
async def get_chat(
    chat_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    db = _db(request)
    chat = await db.get_chat(str(user["id"]), chat_id)
    if chat is None:
        raise AppError("not_found", "会话不存在", status_code=404)
    messages = await db.list_messages(str(user["id"]), chat_id)
    councils = await CouncilRepo(db).list_for_chat(str(user["id"]), chat_id)
    return {
        "chat": _public_chat(chat),
        "messages": [_public_message(m) for m in messages],
        "councils": councils,
    }


@router.patch("/{chat_id}")
async def patch_chat(
    chat_id: str,
    body: PatchChatBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _db(request).update_chat(
        str(user["id"]),
        chat_id,
        title=body.title,
        pinned=body.pinned,
    )
    if row is None:
        raise AppError("not_found", "会话不存在", status_code=404)
    return {"chat": _public_chat(row)}


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    ok = await _db(request).soft_delete_chat(str(user["id"]), chat_id)
    if not ok:
        raise AppError("not_found", "会话不存在", status_code=404)
    return {"ok": True}
