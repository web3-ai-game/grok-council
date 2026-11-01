from __future__ import annotations

from app.orchestrator.experts import COUNCIL_SIZE
from app.orchestrator.prompts import CouncilPlan, generate_council_plan
from app.xai.client import XaiClient


async def compose_council(
    client: XaiClient, question: str, count: int = COUNCIL_SIZE
) -> CouncilPlan:
    """门控 = 提示词发生器：一次非流式 grok-4.6 / effort:low。"""
    return await generate_council_plan(client, question, count)
