from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

from app.orchestrator.experts import (
    COUNCIL_SIZE,
    EXPERT_BY_ID,
    FALLBACK_IDS,
    FANOUT_IDS,
    emoji_for,
)
from app.xai.client import XaiClient
from app.xai.registry import DEFAULT_MODEL_ID
from app.xai.responses import output_text_from_response, usage_from_response

logger = logging.getLogger(__name__)

_ALLOWED_TOOLS = frozenset({"web_search", "x_search", "code_execution", "collections_search"})
_GENERIC_TASK = "从你的职责出发回答"

_FALLBACK_ANGLES = (
    "先拆解结构、变量与约束，列出未知项，不要急着给方案。",
    "核对关键事实与时间点；不确定就标明，不要编造来源。",
    "给出可落地步骤、接口取舍与风险，需要时给最小可行片段。",
    "专门找漏洞、反例、失败模式与被忽略的约束，语气直接。",
    "权衡 2–3 条路径并给出推荐，写清假设与代价。",
    "把结论组织成人类可读结构，不新增未经讨论的事实。",
)


@dataclass
class ExpertBrief:
    id: str
    name: str
    prompt: str
    tools: tuple[str, ...] = ()
    emoji: str = "•"
    effort: str = "medium"
    model: str = DEFAULT_MODEL_ID


@dataclass
class CouncilPlan:
    experts: list[ExpertBrief]
    judge_prompt: str
    usage: dict[str, Any] | None = None
    source: str = "generator"


def gate_public(plan: CouncilPlan) -> list[dict[str, str]]:
    """gate.done 载荷：发生器给出的 id / name（可附 emoji）。"""
    return [
        {"id": e.id, "name": e.name, "emoji": e.emoji} for e in plan.experts
    ]


def plan_to_gate_json(plan: CouncilPlan) -> dict[str, Any]:
    return {
        "experts": [
            {
                "id": e.id,
                "name": e.name,
                "prompt": e.prompt,
                "tools": list(e.tools),
                "emoji": e.emoji,
            }
            for e in plan.experts
        ],
        "judge_prompt": plan.judge_prompt,
        "source": plan.source,
    }


async def generate_council_plan(
    client: XaiClient, question: str, count: int = COUNCIL_SIZE
) -> CouncilPlan:
    n = COUNCIL_SIZE
    if count != COUNCIL_SIZE:
        logger.info("council generator count=%s clamped to %s", count, n)
    payload: dict[str, Any] = {
        "model": DEFAULT_MODEL_ID,
        "input": [{"role": "user", "content": _generator_prompt(question, n)}],
        "reasoning": {"effort": "low"},
    }
    usage: dict[str, Any] | None = None
    parsed: dict[str, Any] | None = None
    try:
        body = await client.create_response(payload)
        usage = usage_from_response(body)
        text = output_text_from_response(body)
        parsed = _parse_json(text)
    except Exception:
        logger.exception("council prompt generator failed; using fallback briefs")
        parsed = None
    plan = _normalize(parsed, question, n, usage)
    if plan.source == "fallback":
        logger.info("council prompts fallback n=%s", n)
    else:
        logger.info("council prompts generated n=%s", n)
    return plan


def _generator_prompt(question: str, n: int) -> str:
    catalog = ", ".join(FANOUT_IDS)
    return (
        "你是专家议会的提示词发生器。根据用户问题生成恰好 "
        f"{n} 位互不相同的专家 brief，以及一份本次专用的判官提示。\n"
        "只返回 JSON，不要 markdown 围栏，不要解释。\n\n"
        "格式：\n"
        '{"experts":[{"id":"e1","name":"短中文名",'
        '"prompt":"该专家本轮完整任务指令（含对本题的具体切入点，禁止与其他专家雷同）",'
        '"tools":[]}],"judge_prompt":"本次判官指令"}\n\n'
        "约束：\n"
        f"- experts 恰好 {n} 项\n"
        f"- id 用 e1..e{n}，或下列 archetype：{catalog}\n"
        "- 六份 prompt 必须互不相同；禁止「从你的职责出发回答」这类万能套话\n"
        "- 每位 prompt 写清本轮视角、要产出什么，并写入用户原题\n"
        "- tools 只能是 web_search / x_search / code_execution / collections_search；"
        "需要时才给，否则 []\n"
        "- judge_prompt 必须要求：指出分歧、标注共识、给出终稿；"
        "措辞与侧重点贴合本题，禁止固定开场白\n\n"
        f"用户问题：\n{question[:6000]}"
    )


def _parse_json(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _normalize(
    parsed: dict[str, Any] | None,
    question: str,
    count: int,
    usage: dict[str, Any] | None,
) -> CouncilPlan:
    stamp = _stamp(question)
    fallback = _fallback_plan(question, count, stamp, usage)
    if not parsed:
        return fallback
    rows = parsed.get("experts")
    if not isinstance(rows, list):
        return fallback
    seen: set[str] = set()
    prompts_seen: set[str] = set()
    experts: list[ExpertBrief] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or len(experts) >= count:
            continue
        prompt = str(row.get("prompt") or "").strip()
        if not prompt or _GENERIC_TASK in prompt:
            continue
        key = re.sub(r"\s+", " ", prompt).lower()
        if key in prompts_seen:
            continue
        prompts_seen.add(key)
        eid = _stable_id(str(row.get("id") or ""), index, seen)
        name = str(row.get("name") or "").strip()[:24] or _name_for(eid, index)
        tools = _tools(row.get("tools"), eid)
        if question not in prompt:
            prompt = f"{prompt}\n\n用户问题：\n{question}"
        experts.append(
            ExpertBrief(
                id=eid,
                name=name,
                prompt=prompt,
                tools=tools,
                emoji=emoji_for(eid, index),
            )
        )
    if len(experts) < count:
        for spare in fallback.experts:
            if len(experts) >= count:
                break
            if spare.id in seen:
                spare = ExpertBrief(
                    id=_stable_id(f"e{len(experts)+1}", len(experts), seen),
                    name=spare.name,
                    prompt=spare.prompt,
                    tools=spare.tools,
                    emoji=spare.emoji,
                )
            else:
                seen.add(spare.id)
            experts.append(spare)
    judge = str(parsed.get("judge_prompt") or "").strip()
    if not judge or _GENERIC_TASK in judge:
        judge = fallback.judge_prompt
    return CouncilPlan(
        experts=experts[:count],
        judge_prompt=judge,
        usage=usage,
        source="generator",
    )


def _fallback_plan(
    question: str, count: int, stamp: str, usage: dict[str, Any] | None
) -> CouncilPlan:
    experts: list[ExpertBrief] = []
    seen: set[str] = set()
    ids = FALLBACK_IDS[:count]
    for index, eid in enumerate(ids):
        arch = EXPERT_BY_ID[eid]
        angle = _FALLBACK_ANGLES[index % len(_FALLBACK_ANGLES)]
        prompt = (
            f"【本轮标记 {stamp}-{eid}】你是「{arch.name}」。\n"
            f"本轮焦点：{angle}\n"
            f"领域线索：{' / '.join(arch.domains)}。\n"
            "针对本题给出你这一路的独特产出，不要套万能套话。\n\n"
            f"用户问题：\n{question}"
        )
        seen.add(eid)
        experts.append(
            ExpertBrief(
                id=eid,
                name=arch.name,
                prompt=prompt,
                tools=tuple(t for t in arch.tools if t in _ALLOWED_TOOLS),
                emoji=arch.emoji,
                effort=arch.effort,
                model=arch.model,
            )
        )
    judge = (
        f"你是本轮判官（标记 {stamp}）。本题：「{question[:180]}」。\n"
        "阅读六路意见后必须：指出分歧与依据、标注共识、给出可执行终稿。"
        "开场不要用固定套话，侧重点随本题变化。"
    )
    return CouncilPlan(
        experts=experts, judge_prompt=judge, usage=usage, source="fallback"
    )


def _stamp(question: str) -> str:
    digest = hashlib.sha256(question.encode("utf-8")).hexdigest()[:10]
    return f"{int(time.time())}-{digest}"


def _stable_id(raw: str, index: int, seen: set[str]) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", raw.strip())[:24]
    if not cleaned or cleaned.lower() == "leader":
        cleaned = f"e{index + 1}"
    base = cleaned.lower()
    candidate = base
    n = 2
    while candidate in seen:
        candidate = f"{base}{n}"
        n += 1
    seen.add(candidate)
    return candidate


def _name_for(eid: str, index: int) -> str:
    arch = EXPERT_BY_ID.get(eid)
    if arch:
        return arch.name
    return f"专家{index + 1}"


def _tools(raw: Any, eid: str) -> tuple[str, ...]:
    out: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            t = str(item).strip()
            if t in _ALLOWED_TOOLS and t not in out:
                out.append(t)
    if out:
        return tuple(out)
    arch = EXPERT_BY_ID.get(eid)
    if arch:
        return tuple(t for t in arch.tools if t in _ALLOWED_TOOLS)
    return ()
