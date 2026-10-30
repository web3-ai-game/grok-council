from __future__ import annotations

import json
from typing import Any

from app.store.db import Database, new_id, now_iso


class CouncilRepo:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def insert_run(
        self,
        user_id: str,
        chat_id: str,
        message_id: str,
        engine: str,
        gate_json: str | None,
    ) -> str:
        run_id = new_id()
        await self._db.conn.execute(
            """
            INSERT INTO council_runs (
                id, user_id, chat_id, message_id, engine, gate_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (run_id, user_id, chat_id, message_id, engine, gate_json, now_iso()),
        )
        await self._db.conn.commit()
        return run_id

    async def finish_run(self, user_id: str, run_id: str, synthesis_json: str) -> None:
        await self._db.conn.execute(
            """
            UPDATE council_runs SET synthesis_json = ?
            WHERE id = ? AND user_id = ?
            """,
            (synthesis_json, run_id, user_id),
        )
        await self._db.conn.commit()

    async def insert_expert(
        self,
        user_id: str,
        run_id: str,
        expert_id: str,
        content: str,
        reasoning: str,
        usage: dict[str, Any] | None,
        error: str | None,
        duration_ms: int,
    ) -> None:
        await self._db.conn.execute(
            """
            INSERT INTO council_experts (
                id, user_id, council_run_id, expert_id, content, reasoning,
                usage_json, error, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                user_id,
                run_id,
                expert_id,
                content,
                reasoning,
                json.dumps(usage) if usage else None,
                error,
                duration_ms,
            ),
        )
        await self._db.conn.commit()

    async def insert_citation(
        self,
        user_id: str,
        message_id: str,
        url: str,
        title: str,
        source_type: str,
    ) -> None:
        await self._db.conn.execute(
            """
            INSERT INTO citations (id, user_id, message_id, url, title, source_type)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (new_id(), user_id, message_id, url, title, source_type),
        )
        await self._db.conn.commit()

    async def list_for_chat(self, user_id: str, chat_id: str) -> list[dict[str, Any]]:
        cur = await self._db.conn.execute(
            """
            SELECT id, message_id, engine, gate_json, synthesis_json, created_at
            FROM council_runs
            WHERE user_id = ? AND chat_id = ?
            ORDER BY created_at ASC
            """,
            (user_id, chat_id),
        )
        runs = [dict(r) for r in await cur.fetchall()]
        out: list[dict[str, Any]] = []
        for run in runs:
            ecur = await self._db.conn.execute(
                """
                SELECT expert_id, content, reasoning, usage_json, error, duration_ms
                FROM council_experts
                WHERE user_id = ? AND council_run_id = ?
                """,
                (user_id, run["id"]),
            )
            experts = []
            for row in await ecur.fetchall():
                item = dict(row)
                if item.get("usage_json"):
                    try:
                        item["usage"] = json.loads(item["usage_json"])
                    except json.JSONDecodeError:
                        item["usage"] = None
                experts.append(item)
            ccur = await self._db.conn.execute(
                """
                SELECT url, title, source_type
                FROM citations
                WHERE user_id = ? AND message_id = ?
                """,
                (user_id, run["message_id"]),
            )
            out.append(
                {
                    "id": run["id"],
                    "message_id": run["message_id"],
                    "engine": run["engine"],
                    "gate": json.loads(run["gate_json"]) if run.get("gate_json") else None,
                    "experts": experts,
                    "citations": [dict(c) for c in await ccur.fetchall()],
                }
            )
        return out
