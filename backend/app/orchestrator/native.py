from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

from app.orchestrator import events
from app.store.council_repo import CouncilRepo
from app.xai.client import XaiClient
from app.xai.modes import NATIVE_HEAVY_MODEL
from app.xai.responses import map_upstream_sse

_INTERNAL = re.compile(
    r"(?i)confidence score|confidence_score|must include a confidence|internal role",
)


def clean_native_text(text: str) -> str:
    """多智能体实测会漏内部指令残留，上屏前清洗（plan.md §1.2.1）。"""
    lines = [line for line in text.splitlines() if not _INTERNAL.search(line)]
    return "\n".join(lines).strip()


async def stream_native(
    client: XaiClient,
    question: str,
    effort: str,
    repo: CouncilRepo,
    user_id: str,
    chat_id: str,
    message_id: str,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    run_id = await repo.insert_run(user_id, chat_id, message_id, "native", None)
    yield events.sse_tuple(
        events.SYNTH_START,
        {"note": "原生模式下子智能体过程不可见"},
    )
    payload: dict[str, Any] = {
        "model": NATIVE_HEAVY_MODEL,
        "stream": True,
        "input": [{"role": "user", "content": question}],
        "reasoning": {"effort": effort if effort in {"low", "medium", "high", "xhigh"} else "medium"},
    }
    content: list[str] = []
    reasoning: list[str] = []
    async for event_name, data in client.stream_responses(payload):
        for name, mapped in map_upstream_sse(event_name, data):
            if name == "message.delta":
                delta = clean_native_text(str(mapped.get("delta") or ""))
                if not delta:
                    continue
                content.append(delta)
                yield events.sse_tuple(events.SYNTH_DELTA, {"delta": delta})
            elif name == "message.reasoning":
                delta = str(mapped.get("delta") or "")
                if delta:
                    reasoning.append(delta)
                    yield events.sse_tuple(events.SYNTH_REASONING, {"delta": delta})
            elif name == "usage":
                yield events.sse_tuple(events.USAGE, mapped)
            elif name == "done":
                yield events.sse_tuple(events.DONE, mapped)
            elif name == "error":
                yield events.sse_tuple(events.ERROR, mapped)
    final = clean_native_text("".join(content))
    if final != "".join(content):
        yield events.sse_tuple(events.SYNTH_DELTA, {"delta": "", "replace": final})
    await repo.finish_run(
        user_id, run_id, json.dumps({"content": final}, ensure_ascii=False)
    )
