from __future__ import annotations

import json
from typing import Any

from app.store.db import Database, new_id, now_iso


def parse_settings(raw: object) -> dict[str, Any]:
    data: Any = {}
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    enabled = data.get("memory_enabled")
    return {"memory_enabled": True if enabled is None else bool(enabled)}


class MemoryRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def get_settings(self, user_id: str) -> dict[str, Any]:
        cur = await self._db.conn.execute(
            "SELECT settings_json FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return {"memory_enabled": True}
        return parse_settings(row["settings_json"])

    async def update_settings(self, user_id: str, *, memory_enabled: bool) -> dict[str, Any]:
        current = await self.get_settings(user_id)
        current["memory_enabled"] = memory_enabled
        await self._db.conn.execute(
            "UPDATE users SET settings_json = ? WHERE id = ?",
            (json.dumps(current, ensure_ascii=False), user_id),
        )
        await self._db.conn.commit()
        return current

    async def list_memories(self, user_id: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, content, source_chat_id, pinned, created_at
            FROM memories
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY pinned DESC, created_at DESC
            """,
            (user_id,),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def memories_for_prompt(self, user_id: str, *, recent: int = 20) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, content, pinned, created_at
            FROM memories
            WHERE user_id = ? AND deleted_at IS NULL AND pinned = 1
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        pinned = [dict(r) for r in await cur.fetchall()]
        pinned_ids = {str(r["id"]) for r in pinned}
        cur = await self._db.conn.execute(
            """
            SELECT id, content, pinned, created_at
            FROM memories
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, recent),
        )
        recent_rows = [dict(r) for r in await cur.fetchall()]
        merged = list(pinned)
        for row in recent_rows:
            if str(row["id"]) not in pinned_ids:
                merged.append(row)
        return merged

    async def add_memory(
        self,
        user_id: str,
        content: str,
        *,
        source_chat_id: str | None = None,
        pinned: bool = False,
    ) -> dict[str, Any]:
        mid = new_id()
        ts = now_iso()
        await self._db.conn.execute(
            """
            INSERT INTO memories (id, user_id, content, source_chat_id, pinned, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (mid, user_id, content, source_chat_id, int(pinned), ts),
        )
        await self._db.conn.commit()
        row = await self.get_memory(user_id, mid)
        assert row is not None
        return row

    async def get_memory(self, user_id: str, memory_id: str) -> dict[str, Any] | None:
        cur = await self._db.conn.execute(
            """
            SELECT id, user_id, content, source_chat_id, pinned, created_at
            FROM memories
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (memory_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def has_same_content(self, user_id: str, content: str) -> bool:
        cur = await self._db.conn.execute(
            """
            SELECT 1 FROM memories
            WHERE user_id = ? AND deleted_at IS NULL AND lower(content) = lower(?)
            LIMIT 1
            """,
            (user_id, content.strip()),
        )
        return await cur.fetchone() is not None

    async def update_memory(
        self,
        user_id: str,
        memory_id: str,
        *,
        content: str | None = None,
        pinned: bool | None = None,
    ) -> dict[str, Any] | None:
        row = await self.get_memory(user_id, memory_id)
        if row is None:
            return None
        fields: list[str] = []
        params: list[Any] = []
        if content is not None:
            fields.append("content = ?")
            params.append(content)
        if pinned is not None:
            fields.append("pinned = ?")
            params.append(int(pinned))
        if not fields:
            return row
        params.extend([memory_id, user_id])
        await self._db.conn.execute(
            f"""
            UPDATE memories SET {', '.join(fields)}
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            params,
        )
        await self._db.conn.commit()
        return await self.get_memory(user_id, memory_id)

    async def soft_delete(self, user_id: str, memory_id: str) -> bool:
        cur = await self._db.conn.execute(
            """
            UPDATE memories SET deleted_at = ?
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), memory_id, user_id),
        )
        await self._db.conn.commit()
        return cur.rowcount > 0

    async def soft_delete_all(self, user_id: str) -> int:
        cur = await self._db.conn.execute(
            """
            UPDATE memories SET deleted_at = ?
            WHERE user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), user_id),
        )
        await self._db.conn.commit()
        return cur.rowcount
