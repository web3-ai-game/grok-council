from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Expert:
    id: str
    name: str
    emoji: str
    system_prompt: str
    model: str
    effort: str
    tools: tuple[str, ...]
    domains: tuple[str, ...]


# 议会 fan-out 只用 grok-4.6（plan.md / CLAUDE.md），禁止 multi-agent 模型。
_MODEL = "grok-4.6"

EXPERTS: tuple[Expert, ...] = (
    Expert(
        id="analyst",
        name="结构分析师",
        emoji="🔍",
        system_prompt="你是结构分析师。拆解问题，列出关键变量、约束与未知项。简洁、条目化。",
        model=_MODEL,
        effort="medium",
        tools=(),
        domains=("分析", "拆解", "决策"),
    ),
    Expert(
        id="researcher",
        name="情报官",
        emoji="🛰️",
        system_prompt="你是情报官。用检索核对事实与时间点，标注不确定处。不要编造来源。",
        model=_MODEL,
        effort="medium",
        tools=("web_search",),
        domains=("事实", "检索", "新闻"),
    ),
    Expert(
        id="engineer",
        name="工程师",
        emoji="🛠️",
        system_prompt="你是工程师。给可落地的技术方案、步骤与风险。需要代码时给出最小可行片段。",
        model=_MODEL,
        effort="medium",
        tools=(),
        domains=("工程", "代码", "可行性"),
    ),
    Expert(
        id="critic",
        name="红队",
        emoji="🧨",
        system_prompt="你是红队。专门找漏洞、反例、失败模式与被忽略的约束。语气直接。",
        model=_MODEL,
        effort="medium",
        tools=(),
        domains=("风险", "反例", "审查"),
    ),
    Expert(
        id="strategist",
        name="策略家",
        emoji="🧭",
        system_prompt="你是策略家。权衡取舍，给出 2–3 条路径与推荐。说明假设。",
        model=_MODEL,
        effort="medium",
        tools=(),
        domains=("策略", "取舍", "路径"),
    ),
    Expert(
        id="writer",
        name="表达者",
        emoji="✍️",
        system_prompt="你是表达者。把结论组织成清晰结构，方便人类阅读。不新增未经讨论的事实。",
        model=_MODEL,
        effort="low",
        tools=(),
        domains=("表达", "结构", "文案"),
    ),
    Expert(
        id="quant",
        name="量化员",
        emoji="🧮",
        system_prompt="你是量化员。能算就算，给公式、数量级与敏感度。算不了就明确说缺数据。",
        model=_MODEL,
        effort="medium",
        tools=("code_execution",),
        domains=("数字", "计算", "验证"),
    ),
    Expert(
        id="leader",
        name="议长",
        emoji="⚖️",
        system_prompt="你是议长。只在合成阶段出场：指出分歧、标注共识、给出最终结论。",
        model=_MODEL,
        effort="high",
        tools=(),
        domains=("合成", "评审"),
    ),
)

EXPERT_BY_ID = {e.id: e for e in EXPERTS}
# Heavy 议会固定 6 路 fan-out；quant 仍留在注册表，发生器可映射到它。
COUNCIL_SIZE = 6
FALLBACK_IDS = (
    "analyst",
    "researcher",
    "engineer",
    "critic",
    "strategist",
    "writer",
)
FANOUT_IDS = tuple(e.id for e in EXPERTS if e.id != "leader")
_SWEEP_EMOJI = ("🔍", "🛰️", "🛠️", "🧨", "🧭", "✍️")


def emoji_for(expert_id: str, index: int = 0) -> str:
    arch = EXPERT_BY_ID.get(expert_id)
    if arch:
        return arch.emoji
    return _SWEEP_EMOJI[index % len(_SWEEP_EMOJI)]
