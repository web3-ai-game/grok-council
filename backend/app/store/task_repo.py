from __future__ import annotations

from typing import Any

from app.store.db import Database, new_id, now_iso


class TaskRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def list_tasks(self, user_id: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, name, cron, prompt, mode, enabled,
                   last_run_at, next_run_at, created_at
            FROM tasks
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_task(self, user_id: str, task_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, name, cron, prompt, mode, enabled,
                   last_run_at, next_run_at, created_at
            FROM tasks
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (task_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def create_task(
        self,
        user_id: str,
        *,
        name: str,
        cron: str,
        prompt: str,
        mode: str,
        next_run_at: str,
        enabled: bool = True,
    ) -> dict[str, Any]:
        tid = new_id()
        ts = now_iso()
        await self._db.conn.execute(
            """
            INSERT INTO tasks (
                id, user_id, name, cron, prompt, mode, enabled,
                next_run_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (tid, user_id, name, cron, prompt, mode, int(enabled), next_run_at, ts),
        )
        await self._db.conn.commit()
        row = await self.get_task(user_id, tid)
        assert row is not None
        return row

    async def update_task(
        self,
        user_id: str,
        task_id: str,
        *,
        name: str | None = None,
        cron: str | None = None,
        prompt: str | None = None,
        mode: str | None = None,
        enabled: bool | None = None,
        last_run_at: str | None = None,
        next_run_at: str | None = None,
    ) -> dict[str, Any] | None:
        row = await self.get_task(user_id, task_id)
        if row is None:
            return None
        fields: list[str] = []
        params: list[Any] = []
        mapping: list[tuple[str, object | None]] = [
            ("name", name),
            ("cron", cron),
            ("prompt", prompt),
            ("mode", mode),
            ("last_run_at", last_run_at),
            ("next_run_at", next_run_at),
        ]
        for col, val in mapping:
            if val is not None:
                fields.append(f"{col} = ?")
                params.append(val)
        if enabled is not None:
            fields.append("enabled = ?")
            params.append(int(enabled))
        if not fields:
            return row
        params.extend([task_id, user_id])
        await self._db.conn.execute(
            f"""
            UPDATE tasks SET {', '.join(fields)}
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            params,
        )
        await self._db.conn.commit()
        return await self.get_task(user_id, task_id)

    async def soft_delete(self, user_id: str, task_id: str) -> bool:
        cur = await self._db.conn.execute(
            """
            UPDATE tasks SET deleted_at = ?
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), task_id, user_id),
        )
        await self._db.conn.commit()
        return cur.rowcount > 0

    async def due_user_ids(self, now_iso_s: str) -> list[str]:
        cur = await self._db.conn.execute(
            """
            SELECT DISTINCT user_id FROM tasks
            WHERE enabled = 1 AND deleted_at IS NULL
              AND next_run_at IS NOT NULL AND next_run_at <= ?
            """,
            (now_iso_s,),
        )
        return [str(r["user_id"]) for r in await cur.fetchall()]

    async def list_due(self, user_id: str, now_iso_s: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, name, cron, prompt, mode, enabled,
                   last_run_at, next_run_at, created_at
            FROM tasks
            WHERE user_id = ? AND enabled = 1 AND deleted_at IS NULL
              AND next_run_at IS NOT NULL AND next_run_at <= ?
            """,
            (user_id, now_iso_s),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def insert_run(
        self, user_id: str, task_id: str, status: str, output: str | None = None
    ) -> dict[str, Any]:
        rid = new_id()
        ts = now_iso()
        await self._db.conn.execute(
            """
            INSERT INTO task_runs (id, task_id, user_id, status, output, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (rid, task_id, user_id, status, output, ts),
        )
        await self._db.conn.commit()
        row = await self.get_run(user_id, rid)
        assert row is not None
        return row

    async def finish_run(
        self, user_id: str, run_id: str, status: str, output: str | None
    ) -> None:
        await self._db.conn.execute(
            """
            UPDATE task_runs SET status = ?, output = ?
            WHERE id = ? AND user_id = ?
            """,
            (status, output, run_id, user_id),
        )
        await self._db.conn.commit()

    async def get_run(self, user_id: str, run_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, task_id, user_id, status, output, created_at
            FROM task_runs
            WHERE id = ? AND user_id = ?
            """,
            (run_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def list_runs(
        self, user_id: str, task_id: str, *, limit: int = 50
    ) -> list[dict[str, Any]]:
        task = await self.get_task(user_id, task_id)
        if task is None:
            return []
        cur = await self._db.conn.execute(
            """
            SELECT id, task_id, user_id, status, output, created_at
            FROM task_runs
            WHERE user_id = ? AND task_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, task_id, limit),
        )
        return [dict(r) for r in await cur.fetchall()]
