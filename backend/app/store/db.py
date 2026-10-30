from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def new_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _row(row: aiosqlite.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


class Database:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._conn: aiosqlite.Connection | None = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database not connected")
        return self._conn

    async def connect(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self._path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def create_user(self, username: str, password_hash: str) -> dict[str, Any]:
        user_id = new_id()
        created = now_iso()
        await self.conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, username, password_hash, created),
        )
        await self.conn.commit()
        return {
            "id": user_id,
            "username": username,
            "created_at": created,
        }

    async def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            "SELECT id, username, password_hash, created_at, settings_json FROM users WHERE username = ?",
            (username,),
        )
        return _row(await cur.fetchone())

    async def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            "SELECT id, username, created_at, settings_json FROM users WHERE id = ?",
            (user_id,),
        )
        return _row(await cur.fetchone())

    async def create_session(
        self, user_id: str, token_hash: str, expires_at: str
    ) -> str:
        session_id = new_id()
        await self.conn.execute(
            """
            INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, user_id, token_hash, expires_at, now_iso()),
        )
        await self.conn.commit()
        return session_id

    async def get_session_user(self, token_hash: str) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            """
            SELECT u.id, u.username, u.created_at, u.settings_json, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (token_hash,),
        )
        return _row(await cur.fetchone())

    async def delete_session(self, token_hash: str) -> None:
        await self.conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (token_hash,),
        )
        await self.conn.commit()

    async def list_chats(
        self,
        user_id: str,
        q: str | None = None,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT id, user_id, project_id, title, mode, model, pinned, temporary,
                   created_at, updated_at
            FROM chats
            WHERE user_id = ? AND deleted_at IS NULL
        """
        params: list[Any] = [user_id]
        if q:
            sql += " AND title LIKE ?"
            params.append(f"%{q}%")
        if project_id:
            sql += " AND project_id = ?"
            params.append(project_id)
        sql += " ORDER BY pinned DESC, updated_at DESC"
        cur = await self.conn.execute(sql, params)
        return [dict(r) for r in await cur.fetchall()]

    async def create_chat(
        self,
        user_id: str,
        title: str,
        *,
        mode: str = "auto",
        model: str = "grok-4.6",
        temporary: bool = False,
        project_id: str | None = None,
    ) -> dict[str, Any]:
        chat_id = new_id()
        ts = now_iso()
        await self.conn.execute(
            """
            INSERT INTO chats (
                id, user_id, project_id, title, mode, model, pinned, temporary,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (chat_id, user_id, project_id, title, mode, model, int(temporary), ts, ts),
        )
        await self.conn.commit()
        row = await self.get_chat(user_id, chat_id)
        assert row is not None
        return row

    async def get_chat(self, user_id: str, chat_id: str) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            """
            SELECT id, user_id, project_id, title, mode, model, pinned, temporary,
                   previous_response_id, created_at, updated_at
            FROM chats
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (chat_id, user_id),
        )
        return _row(await cur.fetchone())

    async def update_chat(
        self,
        user_id: str,
        chat_id: str,
        *,
        title: str | None = None,
        pinned: bool | None = None,
        mode: str | None = None,
        model: str | None = None,
        project_id: str | None = None,
        previous_response_id: str | None = None,
        touch: bool = True,
    ) -> dict[str, Any] | None:
        chat = await self.get_chat(user_id, chat_id)
        if chat is None:
            return None
        fields: list[str] = []
        params: list[Any] = []
        if title is not None:
            fields.append("title = ?")
            params.append(title)
        if pinned is not None:
            fields.append("pinned = ?")
            params.append(int(pinned))
        if mode is not None:
            fields.append("mode = ?")
            params.append(mode)
        if model is not None:
            fields.append("model = ?")
            params.append(model)
        if project_id is not None:
            fields.append("project_id = ?")
            params.append(project_id)
        if previous_response_id is not None:
            fields.append("previous_response_id = ?")
            params.append(previous_response_id)
        if touch:
            fields.append("updated_at = ?")
            params.append(now_iso())
        if not fields:
            return chat
        params.extend([chat_id, user_id])
        await self.conn.execute(
            f"UPDATE chats SET {', '.join(fields)} WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            params,
        )
        await self.conn.commit()
        return await self.get_chat(user_id, chat_id)

    async def soft_delete_chat(self, user_id: str, chat_id: str) -> bool:
        cur = await self.conn.execute(
            """
            UPDATE chats SET deleted_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (now_iso(), now_iso(), chat_id, user_id),
        )
        await self.conn.commit()
        return cur.rowcount > 0

    async def list_messages(self, user_id: str, chat_id: str) -> list[dict[str, Any]]:
        chat = await self.get_chat(user_id, chat_id)
        if chat is None:
            return []
        cur = await self.conn.execute(
            """
            SELECT id, chat_id, user_id, role, content, reasoning_summary,
                   model, mode, parent_id, created_at
            FROM messages
            WHERE chat_id = ? AND user_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC
            """,
            (chat_id, user_id),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_message(
        self, user_id: str, chat_id: str, message_id: str
    ) -> dict[str, Any] | None:
        cur = await self.conn.execute(
            """
            SELECT id, chat_id, user_id, role, content, reasoning_summary,
                   model, mode, parent_id, created_at
            FROM messages
            WHERE id = ? AND chat_id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            (message_id, chat_id, user_id),
        )
        return _row(await cur.fetchone())

    async def insert_message(
        self,
        user_id: str,
        chat_id: str,
        role: str,
        content: str,
        *,
        reasoning_summary: str | None = None,
        model: str | None = None,
        mode: str | None = None,
        parent_id: str | None = None,
        message_id: str | None = None,
    ) -> dict[str, Any]:
        mid = message_id or new_id()
        ts = now_iso()
        await self.conn.execute(
            """
            INSERT INTO messages (
                id, chat_id, user_id, role, content, reasoning_summary,
                model, mode, parent_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mid,
                chat_id,
                user_id,
                role,
                content,
                reasoning_summary,
                model,
                mode,
                parent_id,
                ts,
            ),
        )
        await self.conn.execute(
            "UPDATE chats SET updated_at = ? WHERE id = ? AND user_id = ?",
            (ts, chat_id, user_id),
        )
        await self.conn.commit()
        row = await self.get_message(user_id, chat_id, mid)
        assert row is not None
        return row

    async def update_message_content(
        self,
        user_id: str,
        chat_id: str,
        message_id: str,
        *,
        content: str | None = None,
        reasoning_summary: str | None = None,
    ) -> None:
        fields: list[str] = []
        params: list[Any] = []
        if content is not None:
            fields.append("content = ?")
            params.append(content)
        if reasoning_summary is not None:
            fields.append("reasoning_summary = ?")
            params.append(reasoning_summary)
        if not fields:
            return
        params.extend([message_id, chat_id, user_id])
        await self.conn.execute(
            f"""
            UPDATE messages SET {', '.join(fields)}
            WHERE id = ? AND chat_id = ? AND user_id = ? AND deleted_at IS NULL
            """,
            params,
        )
        await self.conn.commit()

    async def soft_delete_messages_after(
        self, user_id: str, chat_id: str, created_at: str, *, include_id: str | None = None
    ) -> None:
        if include_id:
            await self.conn.execute(
                """
                UPDATE messages SET deleted_at = ?
                WHERE chat_id = ? AND user_id = ? AND deleted_at IS NULL
                  AND (created_at > ? OR id = ?)
                """,
                (now_iso(), chat_id, user_id, created_at, include_id),
            )
        else:
            await self.conn.execute(
                """
                UPDATE messages SET deleted_at = ?
                WHERE chat_id = ? AND user_id = ? AND deleted_at IS NULL
                  AND created_at > ?
                """,
                (now_iso(), chat_id, user_id, created_at),
            )
        await self.conn.commit()

    async def soft_delete_other_messages(
        self, user_id: str, chat_id: str, keep_id: str
    ) -> None:
        await self.conn.execute(
            """
            UPDATE messages SET deleted_at = ?
            WHERE chat_id = ? AND user_id = ? AND deleted_at IS NULL AND id != ?
            """,
            (now_iso(), chat_id, user_id, keep_id),
        )
        await self.conn.commit()

    async def insert_usage(
        self,
        user_id: str,
        chat_id: str | None,
        model: str,
        *,
        prompt_tokens: int,
        cached_tokens: int,
        completion_tokens: int,
        reasoning_tokens: int,
        cost_usd: float,
        tool_calls_json: str | None = None,
    ) -> None:
        await self.conn.execute(
            """
            INSERT INTO usage_log (
                id, user_id, chat_id, model, prompt_tokens, cached_tokens,
                completion_tokens, reasoning_tokens, tool_calls_json,
                cost_usd, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                user_id,
                chat_id,
                model,
                prompt_tokens,
                cached_tokens,
                completion_tokens,
                reasoning_tokens,
                tool_calls_json,
                cost_usd,
                now_iso(),
            ),
        )
        await self.conn.commit()

    async def usage_summary(self, user_id: str, since_iso: str) -> dict[str, Any]:
        cur = await self.conn.execute(
            """
            SELECT
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens
            FROM usage_log
            WHERE user_id = ? AND created_at >= ?
            """,
            (user_id, since_iso),
        )
        row = await cur.fetchone()
        if row is None:
            return {
                "cost_usd": 0.0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "reasoning_tokens": 0,
            }
        return dict(row)
