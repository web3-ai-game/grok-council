from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.demo_replay import public_catalog, scenario_by_id, timeline_with_delay
from app.xai.errors import AppError

router = APIRouter()


def _sse(event: str, data: dict[str, Any], event_id: int) -> str:
    return f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/demo/scenarios")
async def list_scenarios(lang: str = Query(default="zh")) -> dict[str, Any]:
    chosen = "en" if lang == "en" else "zh"
    return {"lang": chosen, "scenarios": public_catalog(chosen)}


@router.get("/demo/play")
async def play_scenario(
    id: str = Query(...),
    lang: str = Query(default="zh"),
    speed: float = Query(default=1),
) -> StreamingResponse:
    scenario = scenario_by_id(id)
    if scenario is None:
        raise AppError("not_found", "议题不存在", status_code=404)
    chosen = "en" if lang == "en" else "zh"
    pace = 2.0 if speed >= 2 else 1.0
    timeline = timeline_with_delay(scenario, chosen)

    async def generate() -> AsyncIterator[str]:
        prev = 0
        for index, (at, event, data) in enumerate(timeline, start=1):
            wait = max(0, (at - prev) / pace) / 1000
            if wait:
                await asyncio.sleep(wait)
            prev = at
            yield _sse(event, data, index)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
