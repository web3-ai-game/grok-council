from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.store.db import Database, now_iso
from app.store.task_repo import TaskRepo
from app.tasks.cron import CronError, next_run_after
from app.xai.client import XaiClient
from app.xai.errors import AppError
from app.xai.modes import resolve_generation
from app.xai.responses import output_text_from_response, usage_from_response

logger = logging.getLogger(__name__)

_POLL_S = 15.0


async def run_scheduler(db: Database, client: XaiClient, stop: asyncio.Event) -> None:
    running: set[str] = set()
    while not stop.is_set():
        try:
            await _tick(db, client, running)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("task scheduler tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=_POLL_S)
        except asyncio.TimeoutError:
            continue


async def _tick(db: Database, client: XaiClient, running: set[str]) -> None:
    repo = TaskRepo(db)
    now = now_iso()
    for user_id in await repo.due_user_ids(now):
        for task in await repo.list_due(user_id, now):
            tid = str(task["id"])
            if tid in running:
                continue
            running.add(tid)
            try:
                await _execute(db, client, repo, task)
            finally:
                running.discard(tid)


async def _execute(
    db: Database, client: XaiClient, repo: TaskRepo, task: dict
) -> None:
    user_id = str(task["user_id"])
    task_id = str(task["id"])
    cron = str(task["cron"])
    now = datetime.now(timezone.utc)
    try:
        nxt = next_run_after(cron, now).replace(microsecond=0).isoformat()
    except CronError:
        nxt = None
        await repo.update_task(user_id, task_id, enabled=False, last_run_at=now_iso())
        await repo.insert_run(user_id, task_id, "error", "非法 cron，已停用")
        return
    # 先把 next_run_at 推走，避免同一分钟重复触发
    await repo.update_task(user_id, task_id, last_run_at=now_iso(), next_run_at=nxt)
    run = await repo.insert_run(user_id, task_id, "running", None)
    mode, model, effort = resolve_generation(str(task.get("mode") or "auto"), None, None)
    payload = {
        "model": model,
        "input": [{"role": "user", "content": str(task["prompt"])}],
        "reasoning": {"effort": effort},
        "max_output_tokens": 1200,
    }
    try:
        response = await client.create_response(payload)
    except AppError as exc:
        await repo.finish_run(user_id, str(run["id"]), "error", exc.message)
        logger.warning("task run failed task=%s: %s", task_id[:8], exc.message)
        return
    if response.get("error"):
        err = response["error"]
        msg = err if isinstance(err, str) else str(err)
        await repo.finish_run(user_id, str(run["id"]), "error", msg[:2000])
        return
    usage = usage_from_response(response)
    if usage is not None:
        await db.insert_usage(
            user_id,
            None,
            model,
            prompt_tokens=int(usage.get("prompt") or 0),
            cached_tokens=int(usage.get("cached") or 0),
            completion_tokens=int(usage.get("completion") or 0),
            reasoning_tokens=int(usage.get("reasoning") or 0),
            cost_usd=float(usage.get("cost_usd") or 0),
        )
    text = output_text_from_response(response) or "(无输出)"
    await repo.finish_run(user_id, str(run["id"]), "ok", text[:8000])
    logger.info("task run ok task=%s mode=%s", task_id[:8], mode)
