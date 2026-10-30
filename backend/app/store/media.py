from __future__ import annotations

from pathlib import Path
from typing import Any

from app.store.db import Database, new_id, now_iso


class MediaRepo:
    def __init__(self, db: Database, media_root: Path) -> None:
        self._db = db
        self.root = media_root
        self.root.mkdir(parents=True, exist_ok=True)

    async def create_project(
        self, user_id: str, name: str, instructions: str = ""
    ) -> dict[str, Any]:
        pid = new_id()
        ts = now_iso()
        await self._db.conn.execute(
            """
            INSERT INTO projects (id, user_id, name, instructions, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (pid, user_id, name, instructions, ts),
        )
        await self._db.conn.commit()
        row = await self.get_project(user_id, pid)
        assert row is not None
        return row

    async def list_projects(self, user_id: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, name, instructions, created_at
            FROM projects
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_project(self, user_id: str, project_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, name, instructions, created_at
            FROM projects
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (project_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def update_project(
        self,
        user_id: str,
        project_id: str,
        *,
        name: str | None = None,
        instructions: str | None = None,
    ) -> dict[str, Any] | None:
        row = await self.get_project(user_id, project_id)
        if row is None:
            return None
        fields: list[str] = []
        params: list[Any] = []
        if name is not None:
            fields.append("name = ?")
            params.append(name)
        if instructions is not None:
            fields.append("instructions = ?")
            params.append(instructions)
        if fields:
            params.extend([project_id, user_id])
            await self._db.conn.execute(
                f"UPDATE projects SET {', '.join(fields)} WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                params,
            )
            await self._db.conn.commit()
        return await self.get_project(user_id, project_id)

    async def soft_delete_project(self, user_id: str, project_id: str) -> bool:
        cur = await self._db.conn.execute(
            """
            UPDATE projects SET deleted_at = ?
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), project_id, user_id),
        )
        await self._db.conn.commit()
        return cur.rowcount > 0

    async def insert_file(
        self,
        user_id: str,
        filename: str,
        mime: str,
        size: int,
        rel_path: str,
        *,
        project_id: str | None = None,
        xai_file_id: str | None = None,
    ) -> dict[str, Any]:
        fid = new_id()
        await self._db.conn.execute(
            """
            INSERT INTO files (
                id, user_id, project_id, filename, mime, size, path, xai_file_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fid,
                user_id,
                project_id,
                filename,
                mime,
                size,
                rel_path,
                xai_file_id,
                now_iso(),
            ),
        )
        await self._db.conn.commit()
        row = await self.get_file(user_id, fid)
        assert row is not None
        return row

    async def list_files(
        self, user_id: str, project_id: str | None = None
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT id, user_id, project_id, filename, mime, size, path, xai_file_id, created_at
            FROM files
            WHERE user_id = ? AND deleted_at IS NULL
        """
        params: list[Any] = [user_id]
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        sql += " ORDER BY created_at DESC"
        cur = await self._db.conn.execute(sql, params)
        return [dict(r) for r in await cur.fetchall()]

    async def get_file(self, user_id: str, file_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, project_id, filename, mime, size, path, xai_file_id, created_at
            FROM files
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (file_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def set_file_path(self, user_id: str, file_id: str, rel_path: str) -> None:
        await self._db.conn.execute(
            "UPDATE files SET path = ? WHERE id = ? AND user_id = ?",
            (rel_path, file_id, user_id),
        )
        await self._db.conn.commit()

    async def set_xai_file_id(self, user_id: str, file_id: str, xai_file_id: str) -> None:
        await self._db.conn.execute(
            "UPDATE files SET xai_file_id = ? WHERE id = ? AND user_id = ?",
            (xai_file_id, file_id, user_id),
        )
        await self._db.conn.commit()

    async def soft_delete_file(self, user_id: str, file_id: str) -> bool:
        cur = await self._db.conn.execute(
            """
            UPDATE files SET deleted_at = ?
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), file_id, user_id),
        )
        await self._db.conn.commit()
        return cur.rowcount > 0

    async def insert_generation(
        self,
        user_id: str,
        kind: str,
        prompt: str,
        model: str,
        rel_path: str,
        cost_usd: float,
        mime: str | None,
    ) -> dict[str, Any]:
        gid = new_id()
        await self._db.conn.execute(
            """
            INSERT INTO generations (
                id, user_id, kind, prompt, model, path, mime, cost_usd, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (gid, user_id, kind, prompt, model, rel_path, mime, cost_usd, now_iso()),
        )
        await self._db.conn.commit()
        row = await self.get_generation(user_id, gid)
        assert row is not None
        return row

    async def list_generations(self, user_id: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, kind, prompt, model, path, mime, cost_usd, created_at
            FROM generations
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def set_generation_path(
        self, user_id: str, gen_id: str, rel_path: str
    ) -> None:
        await self._db.conn.execute(
            "UPDATE generations SET path = ? WHERE id = ? AND user_id = ?",
            (rel_path, gen_id, user_id),
        )
        await self._db.conn.commit()

    async def get_generation(self, user_id: str, gen_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, kind, prompt, model, path, mime, cost_usd, created_at
            FROM generations
            WHERE id = ? AND user_id = ?
            """,
            (gen_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None
