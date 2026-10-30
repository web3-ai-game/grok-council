from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.security import current_user
from app.store.memory_repo import MemoryRepo
from app.xai.errors import AppError

router = APIRouter()


class MemoryBody(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class PatchMemoryBody(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    pinned: bool | None = None


class SettingsBody(BaseModel):
    memory_enabled: bool


def _repo(request: Request) -> MemoryRepo:
    return MemoryRepo(request.app.state.db)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "content": row["content"],
        "source_chat_id": row.get("source_chat_id"),
        "pinned": bool(row["pinned"]),
        "created_at": row["created_at"],
    }


@router.get("/memories")
async def list_memories(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    repo = _repo(request)
    uid = str(user["id"])
    rows = await repo.list_memories(uid)
    settings = await repo.get_settings(uid)
    return {
        "memories": [_public(r) for r in rows],
        "enabled": bool(settings.get("memory_enabled")),
    }


@router.post("/memories")
async def create_memory(
    body: MemoryBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _repo(request).add_memory(str(user["id"]), body.content.strip())
    return {"memory": _public(row)}


@router.patch("/memories/{memory_id}")
async def patch_memory(
    memory_id: str,
    body: PatchMemoryBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _repo(request).update_memory(
        str(user["id"]),
        memory_id,
        content=body.content.strip() if body.content else None,
        pinned=body.pinned,
    )
    if row is None:
        raise AppError("not_found", "记忆不存在", status_code=404)
    return {"memory": _public(row)}


@router.delete("/memories")
async def clear_memories(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    n = await _repo(request).soft_delete_all(str(user["id"]))
    return {"ok": True, "deleted": n}


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    ok = await _repo(request).soft_delete(str(user["id"]), memory_id)
    if not ok:
        raise AppError("not_found", "记忆不存在", status_code=404)
    return {"ok": True}


@router.get("/settings")
async def get_settings(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    return await _repo(request).get_settings(str(user["id"]))


@router.patch("/settings")
async def patch_settings(
    body: SettingsBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    return await _repo(request).update_settings(
        str(user["id"]), memory_enabled=body.memory_enabled
    )
