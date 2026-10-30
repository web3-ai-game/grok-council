from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.security import current_user
from app.store.task_repo import TaskRepo
from app.tasks.cron import CronError, next_run_after, validate_cron
from app.xai.errors import AppError

router = APIRouter(prefix="/tasks")
_MODES = {"auto", "fast", "expert", "heavy"}


class TaskBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    cron: str = Field(min_length=5, max_length=80)
    prompt: str = Field(min_length=1, max_length=8000)
    mode: str = "auto"
    enabled: bool = True


class PatchTaskBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    cron: str | None = Field(default=None, min_length=5, max_length=80)
    prompt: str | None = Field(default=None, min_length=1, max_length=8000)
    mode: str | None = None
    enabled: bool | None = None


def _repo(request: Request) -> TaskRepo:
    return TaskRepo(request.app.state.db)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "cron": row["cron"],
        "prompt": row["prompt"],
        "mode": row["mode"],
        "enabled": bool(row["enabled"]),
        "last_run_at": row.get("last_run_at"),
        "next_run_at": row.get("next_run_at"),
        "created_at": row["created_at"],
    }


def _public_run(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "status": row["status"],
        "output": row.get("output"),
        "created_at": row["created_at"],
    }


def _cron(expr: str) -> str:
    try:
        return validate_cron(expr)
    except CronError as exc:
        raise AppError("invalid_argument", str(exc), status_code=400) from exc


def _next(cron: str) -> str:
    expr = _cron(cron)
    try:
        nxt = next_run_after(expr, datetime.now(timezone.utc))
    except CronError as exc:
        raise AppError("invalid_argument", str(exc), status_code=400) from exc
    return nxt.replace(microsecond=0).isoformat()


@router.get("")
async def list_tasks(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    rows = await _repo(request).list_tasks(str(user["id"]))
    return {"tasks": [_public(r) for r in rows]}


@router.post("")
async def create_task(
    body: TaskBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    mode = body.mode if body.mode in _MODES else "auto"
    cron = _cron(body.cron)
    row = await _repo(request).create_task(
        str(user["id"]),
        name=body.name.strip(),
        cron=cron,
        prompt=body.prompt.strip(),
        mode=mode,
        next_run_at=_next(cron),
        enabled=body.enabled,
    )
    return {"task": _public(row)}


@router.patch("/{task_id}")
async def patch_task(
    task_id: str,
    body: PatchTaskBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    cron = _cron(body.cron) if body.cron else None
    mode = body.mode if body.mode in _MODES or body.mode is None else None
    if body.mode is not None and body.mode not in _MODES:
        raise AppError("invalid_argument", "未知模式", status_code=400)
    next_at = _next(cron) if cron else None
    row = await _repo(request).update_task(
        str(user["id"]),
        task_id,
        name=body.name.strip() if body.name else None,
        cron=cron,
        prompt=body.prompt.strip() if body.prompt else None,
        mode=mode,
        enabled=body.enabled,
        next_run_at=next_at,
    )
    if row is None:
        raise AppError("not_found", "任务不存在", status_code=404)
    return {"task": _public(row)}


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    ok = await _repo(request).soft_delete(str(user["id"]), task_id)
    if not ok:
        raise AppError("not_found", "任务不存在", status_code=404)
    return {"ok": True}


@router.get("/{task_id}/runs")
async def list_runs(
    task_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    repo = _repo(request)
    task = await repo.get_task(str(user["id"]), task_id)
    if task is None:
        raise AppError("not_found", "任务不存在", status_code=404)
    rows = await repo.list_runs(str(user["id"]), task_id)
    return {"runs": [_public_run(r) for r in rows]}
