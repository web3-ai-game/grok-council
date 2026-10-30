from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from app.orchestrator import events
from app.orchestrator.experts import COUNCIL_SIZE, EXPERT_BY_ID, Expert
from app.orchestrator.gate import compose_council
from app.orchestrator.prompts import ExpertBrief, CouncilPlan, gate_public, plan_to_gate_json
from app.store.council_repo import CouncilRepo
from app.xai.client import XaiClient
from app.xai.registry import DEFAULT_MODEL_ID
from app.xai.responses import map_upstream_sse

LEADER_ID = "leader"
logger = logging.getLogger(__name__)

_ALLOWED_TOOLS = frozenset({"web_search", "x_search", "code_execution", "collections_search"})


def _clamp_parallel(value: int) -> int:
    return max(1, min(3, int(value)))


async def run_council(
    *,
    client: XaiClient,
    repo: CouncilRepo,
    user_id: str,
    chat_id: str,
    message_id: str,
    question: str,
    max_experts: int,
    parallel: int = 2,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    slots = COUNCIL_SIZE
    conc = _clamp_parallel(parallel)
    yield events.sse_tuple(events.GATE_START)
    plan: CouncilPlan = await compose_council(client, question, slots)
    if plan.usage:
        yield events.sse_tuple(events.USAGE, plan.usage)
    yield events.sse_tuple(events.GATE_DONE, {"experts": gate_public(plan)})
    run_id = await repo.insert_run(
        user_id,
        chat_id,
        message_id,
        "council",
        json.dumps(plan_to_gate_json(plan), ensure_ascii=False),
    )

    results: dict[str, dict[str, Any]] = {}
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    sem = asyncio.Semaphore(conc)
    logger.info(
        "council fan-out n=%s parallel=%s cap=%s source=%s",
        len(plan.experts),
        conc,
        max_experts,
        plan.source,
    )

    async def one_expert(brief: ExpertBrief) -> None:
        async with sem:
            logger.info("council expert acquire id=%s", brief.id)
            started = time.perf_counter()
            await queue.put((events.EXPERT_START, {"expert_id": brief.id}))
            for tool in brief.tools:
                if tool == "web_search":
                    await queue.put(
                        (events.TOOL_CALL, {"expert_id": brief.id, "tool": tool, "args": {}})
                    )
            content: list[str] = []
            reasoning: list[str] = []
            usage: dict[str, Any] | None = None
            err: str | None = None
            try:
                payload = _expert_payload(brief, question)
                async for event_name, data in client.stream_responses(payload):
                    for name, mapped in map_upstream_sse(event_name, data):
                        if name == "message.delta":
                            content.append(str(mapped["delta"]))
                            await queue.put(
                                (
                                    events.EXPERT_DELTA,
                                    {"expert_id": brief.id, "delta": mapped["delta"]},
                                )
                            )
                        elif name == "message.reasoning":
                            reasoning.append(str(mapped["delta"]))
                            await queue.put(
                                (
                                    events.EXPERT_REASONING,
                                    {"expert_id": brief.id, "delta": mapped["delta"]},
                                )
                            )
                        elif name == "tool.call":
                            await queue.put(
                                (events.TOOL_CALL, {"expert_id": brief.id, **mapped})
                            )
                        elif name == "tool.result":
                            await queue.put(
                                (events.TOOL_RESULT, {"expert_id": brief.id, **mapped})
                            )
                        elif name == "citations":
                            items = (
                                mapped.get("items")
                                if isinstance(mapped.get("items"), list)
                                else []
                            )
                            for item in items:
                                if isinstance(item, dict) and item.get("url"):
                                    await repo.insert_citation(
                                        user_id,
                                        message_id,
                                        str(item["url"]),
                                        str(item.get("title") or item["url"]),
                                        str(item.get("source_type") or "web"),
                                    )
                            await queue.put((events.CITATIONS, mapped))
                        elif name == "usage":
                            usage = mapped
            except Exception as exc:
                err = str(exc)
                logger.warning("council expert failed id=%s err=%s", brief.id, err)
                await queue.put(
                    (
                        events.EXPERT_DONE,
                        {"expert_id": brief.id, "error": err, "usage": None},
                    )
                )
            else:
                await queue.put(
                    (events.EXPERT_DONE, {"expert_id": brief.id, "usage": usage})
                )
            duration_ms = int((time.perf_counter() - started) * 1000)
            results[brief.id] = {
                "id": brief.id,
                "name": brief.name,
                "content": "".join(content),
                "reasoning": "".join(reasoning),
                "error": err,
            }
            await repo.insert_expert(
                user_id,
                run_id,
                brief.id,
                "".join(content),
                "".join(reasoning),
                usage,
                err,
                duration_ms,
            )
            if usage:
                await queue.put((events.USAGE, {**usage, "expert_id": brief.id}))
            logger.info("council expert release id=%s ms=%s", brief.id, duration_ms)

    tasks = [asyncio.create_task(one_expert(b)) for b in plan.experts]
    pending = len(tasks)

    async def wait_all() -> None:
        await asyncio.gather(*tasks, return_exceptions=True)
        await queue.put(None)

    waiter = asyncio.create_task(wait_all())
    while pending > 0 or not queue.empty():
        item = await queue.get()
        if item is None:
            break
        name, payload = item
        yield name, payload
        if name == events.EXPERT_DONE:
            pending = max(0, pending - 1)
    await waiter

    yield events.sse_tuple(events.SYNTH_START)
    leader = EXPERT_BY_ID[LEADER_ID]
    synth_content: list[str] = []
    try:
        async for event_name, data in client.stream_responses(
            _leader_payload(leader, plan.judge_prompt, question, results)
        ):
            for name, mapped in map_upstream_sse(event_name, data):
                if name == "message.delta":
                    synth_content.append(str(mapped["delta"]))
                    yield events.sse_tuple(events.SYNTH_DELTA, {"delta": mapped["delta"]})
                elif name == "message.reasoning":
                    yield events.sse_tuple(events.SYNTH_REASONING, {"delta": mapped["delta"]})
                elif name == "usage":
                    yield events.sse_tuple(events.USAGE, mapped)
                elif name == "done":
                    yield events.sse_tuple(events.DONE, mapped)
                elif name == "error":
                    yield events.sse_tuple(events.ERROR, mapped)
    except Exception as exc:
        yield events.sse_tuple(events.ERROR, {"code": "synth_failed", "message": str(exc)})
        fallback = _fallback_synth(results)
        synth_content.append(fallback)
        yield events.sse_tuple(events.SYNTH_DELTA, {"delta": fallback})
        yield events.sse_tuple(events.DONE, {"response_id": None})

    await repo.finish_run(
        user_id,
        run_id,
        json.dumps({"content": "".join(synth_content)}, ensure_ascii=False),
    )


def _expert_payload(brief: ExpertBrief, question: str) -> dict[str, Any]:
    content = brief.prompt.strip()
    if question not in content:
        content = f"{content}\n\n用户问题：\n{question}"
    body: dict[str, Any] = {
        "model": brief.model or DEFAULT_MODEL_ID,
        "stream": True,
        "input": [{"role": "user", "content": content}],
        "reasoning": {"effort": brief.effort},
    }
    tools = [{"type": t} for t in brief.tools if t in _ALLOWED_TOOLS]
    if tools:
        body["tools"] = tools
    return body


def _leader_payload(
    leader: Expert,
    judge_prompt: str,
    question: str,
    results: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    blocks = []
    for item in results.values():
        status = item["error"] or "ok"
        blocks.append(
            f"### {item['name']} ({item['id']}) [{status}]\n{item['content'] or '(无输出)'}"
        )
    prompt = (
        f"{judge_prompt}\n\n用户问题：{question}\n\n" + "\n\n".join(blocks)
    )
    return {
        "model": leader.model,
        "stream": True,
        "input": [{"role": "user", "content": prompt}],
        "reasoning": {"effort": leader.effort},
    }


def _fallback_synth(results: dict[str, dict[str, Any]]) -> str:
    ok = [v for v in results.values() if not v.get("error") and v.get("content")]
    if not ok:
        return "议会未能产出可用结论。"
    return "议长合成失败，以下为各专家原文摘要：\n\n" + "\n\n".join(
        f"## {v['name']}\n{v['content'][:800]}" for v in ok
    )
