from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.store.db import Database
from app.store.memory_repo import MemoryRepo
from app.xai.client import XaiClient
from app.xai.errors import AppError
from app.xai.registry import DEFAULT_MODEL_ID
from app.xai.responses import output_text_from_response, usage_from_response

logger = logging.getLogger(__name__)

EXTRACT_PROMPT = """你是记忆抽取器。根据这一轮用户与助手对话，判断有没有值得长期记住的用户偏好、身份事实或稳定指令。
只抽取用户侧的持久信息（例如「我叫…」「请用繁体中文」「不要用表格」），不要记一次性任务内容。
只输出 JSON：{"memories": ["一条一句话", ...]}
若没有值得记的，输出 {"memories": []}。不要 markdown，不要解释。"""


def _parse_memories(text: str) -> list[str]:
    raw = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return []
    items = data.get("memories") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        if isinstance(item, str):
            line = item.strip()
            if line:
                out.append(line[:500])
    return out[:8]


def format_memory_block(rows: list[dict[str, Any]]) -> str | None:
    lines = [str(r.get("content") or "").strip() for r in rows]
    lines = [x for x in lines if x]
    if not lines:
        return None
    bullets = "\n".join(f"- {x}" for x in lines)
    return (
        "以下是该用户的长期记忆，请在回答时遵守，不要主动提起「记忆系统」：\n"
        + bullets
    )


async def compose_instructions(
    db: Database,
    user_id: str,
    chat: dict[str, Any],
    project_text: str | None,
) -> str | None:
    parts: list[str] = []
    if project_text and project_text.strip():
        parts.append(project_text.strip())
    if chat.get("temporary"):
        return "\n\n".join(parts) or None
    repo = MemoryRepo(db)
    settings = await repo.get_settings(user_id)
    if not settings.get("memory_enabled"):
        return "\n\n".join(parts) or None
    rows = await repo.memories_for_prompt(user_id)
    block = format_memory_block(rows)
    if block:
        parts.append(block)
    return "\n\n".join(parts) or None


async def extract_memories_safe(
    *,
    db: Database,
    client: XaiClient,
    user_id: str,
    chat_id: str,
    user_text: str,
    assistant_text: str,
) -> None:
    """会话结束后异步抽取。失败只打日志，绝不影响主对话。"""
    try:
        await _extract(db, client, user_id, chat_id, user_text, assistant_text)
    except Exception:
        logger.exception("memory extract failed chat=%s", chat_id)


async def _extract(
    db: Database,
    client: XaiClient,
    user_id: str,
    chat_id: str,
    user_text: str,
    assistant_text: str,
) -> None:
    if not user_text.strip() or not assistant_text.strip():
        return
    repo = MemoryRepo(db)
    settings = await repo.get_settings(user_id)
    if not settings.get("memory_enabled"):
        return
    payload = {
        "model": DEFAULT_MODEL_ID,
        "input": [
            {"role": "system", "content": EXTRACT_PROMPT},
            {
                "role": "user",
                "content": f"用户：{user_text[:4000]}\n助手：{assistant_text[:4000]}",
            },
        ],
        "reasoning": {"effort": "low"},
        "max_output_tokens": 400,
    }
    try:
        response = await client.create_response(payload)
    except AppError as exc:
        logger.warning("memory extract upstream error: %s", exc.message)
        return
    if response.get("error"):
        logger.warning("memory extract response error")
        return
    usage = usage_from_response(response)
    if usage is not None:
        await db.insert_usage(
            user_id,
            chat_id,
            DEFAULT_MODEL_ID,
            prompt_tokens=int(usage.get("prompt") or 0),
            cached_tokens=int(usage.get("cached") or 0),
            completion_tokens=int(usage.get("completion") or 0),
            reasoning_tokens=int(usage.get("reasoning") or 0),
            cost_usd=float(usage.get("cost_usd") or 0),
        )
    text = output_text_from_response(response)
    for item in _parse_memories(text):
        if await repo.has_same_content(user_id, item):
            continue
        await repo.add_memory(user_id, item, source_chat_id=chat_id)
        logger.info("memory stored user=%s chat=%s", user_id[:8], chat_id[:8])
