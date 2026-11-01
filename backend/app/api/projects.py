from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.security import current_user
from app.store.media import MediaRepo
from app.xai.errors import AppError

router = APIRouter(prefix="/projects")


class ProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    instructions: str = Field(default="", max_length=8000)


class PatchProjectBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    instructions: str | None = Field(default=None, max_length=8000)


def _media(request: Request) -> MediaRepo:
    return MediaRepo(request.app.state.db, request.app.state.settings.media_root)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "instructions": row["instructions"],
        "created_at": row["created_at"],
    }


@router.get("")
async def list_projects(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    rows = await _media(request).list_projects(str(user["id"]))
    return {"projects": [_public(r) for r in rows]}


@router.post("")
async def create_project(
    body: ProjectBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _media(request).create_project(
        str(user["id"]), body.name.strip(), body.instructions
    )
    return {"project": _public(row)}


@router.patch("/{project_id}")
async def patch_project(
    project_id: str,
    body: PatchProjectBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    row = await _media(request).update_project(
        str(user["id"]),
        project_id,
        name=body.name.strip() if body.name else None,
        instructions=body.instructions,
    )
    if row is None:
        raise AppError("not_found", "项目不存在", status_code=404)
    return {"project": _public(row)}


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    ok = await _media(request).soft_delete_project(str(user["id"]), project_id)
    if not ok:
        raise AppError("not_found", "项目不存在", status_code=404)
    return {"ok": True}
