"""模型注册表 + 定价表。

来源：plan.md §1.2（2026-09-05 核实于 docs.x.ai）。
价格单位：文本为美元 / 百万 token，两档为提示词 <200k 与 ≥200k；
一旦提示词达到 200k，整个请求按高档计费。
事后记账用 usage.cost_in_usd_ticks / COST_USD_TICKS_DIVISOR，不要用本表。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# plan.md §1.2.1：cost_usd = cost_in_usd_ticks / 1e10
COST_USD_TICKS_DIVISOR = 10_000_000_000

DEFAULT_MODEL_ID = "grok-4.6"

Kind = Literal["text", "imagine"]


@dataclass(frozen=True)
class TextModel:
    id: str
    context_window: int
    # (低于 200k, 达到/超过 200k)
    input_per_mtok: tuple[float, float]
    cached_input_per_mtok: tuple[float, float]
    output_per_mtok: tuple[float, float]
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class ImagineModel:
    id: str
    unit: Literal["image", "second"]
    price_usd: float
    capabilities: tuple[str, ...]


# 7 个文本模型 —— ID 与价格必须与 plan.md §1.2 逐字一致
TEXT_MODELS: tuple[TextModel, ...] = (
    TextModel(
        id="grok-4.6",
        context_window=500_000,
        input_per_mtok=(2.00, 4.00),
        cached_input_per_mtok=(0.50, 1.00),
        output_per_mtok=(6.00, 12.00),
        capabilities=("text", "reasoning", "tools"),
    ),
    TextModel(
        id="grok-4.5",
        context_window=500_000,
        input_per_mtok=(2.00, 4.00),
        cached_input_per_mtok=(0.30, 0.60),
        output_per_mtok=(6.00, 12.00),
        capabilities=("text", "tools"),
    ),
    TextModel(
        id="grok-4.3",
        context_window=1_000_000,
        input_per_mtok=(1.25, 2.50),
        cached_input_per_mtok=(0.20, 0.40),
        output_per_mtok=(2.50, 5.00),
        capabilities=("text", "tools"),
    ),
    TextModel(
        id="grok-4.20-0309-reasoning",
        context_window=1_000_000,
        input_per_mtok=(1.25, 2.50),
        cached_input_per_mtok=(0.20, 0.40),
        output_per_mtok=(2.50, 5.00),
        capabilities=("text", "reasoning"),
    ),
    TextModel(
        id="grok-4.20-0309-non-reasoning",
        context_window=1_000_000,
        input_per_mtok=(1.25, 2.50),
        cached_input_per_mtok=(0.20, 0.40),
        output_per_mtok=(2.50, 5.00),
        capabilities=("text",),
    ),
    TextModel(
        id="grok-build-0.1",
        context_window=256_000,
        input_per_mtok=(1.00, 2.00),
        cached_input_per_mtok=(0.20, 0.40),
        output_per_mtok=(2.00, 4.00),
        capabilities=("coding",),
    ),
    TextModel(
        id="grok-4.20-multi-agent-0309",
        context_window=1_000_000,
        input_per_mtok=(1.25, 2.50),
        cached_input_per_mtok=(0.20, 0.40),
        output_per_mtok=(2.50, 5.00),
        capabilities=("text", "multi_agent"),
    ),
)

# 5 个 imagine 模型 —— ID 与价格必须与 plan.md §1.2 逐字一致
IMAGINE_MODELS: tuple[ImagineModel, ...] = (
    ImagineModel(
        id="grok-imagine-image",
        unit="image",
        price_usd=0.02,
        capabilities=("image",),
    ),
    ImagineModel(
        id="grok-imagine-image-2.0",
        unit="image",
        price_usd=0.04,
        capabilities=("image",),
    ),
    ImagineModel(
        id="grok-imagine-image-quality",
        unit="image",
        price_usd=0.05,
        capabilities=("image",),
    ),
    ImagineModel(
        id="grok-imagine-video",
        unit="second",
        price_usd=0.050,
        capabilities=("video",),
    ),
    ImagineModel(
        id="grok-imagine-video-1.5",
        unit="second",
        price_usd=0.080,
        capabilities=("video",),
    ),
)

TEXT_BY_ID: dict[str, TextModel] = {m.id: m for m in TEXT_MODELS}
IMAGINE_BY_ID: dict[str, ImagineModel] = {m.id: m for m in IMAGINE_MODELS}
ALL_MODEL_IDS: tuple[str, ...] = tuple(m.id for m in TEXT_MODELS) + tuple(
    m.id for m in IMAGINE_MODELS
)


def ticks_to_usd(cost_in_usd_ticks: int) -> float:
    return cost_in_usd_ticks / COST_USD_TICKS_DIVISOR
