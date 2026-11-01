from typing import Any

from fastapi import APIRouter, Request

from app.xai.client import XaiClient
from app.xai.registry import (
    DEFAULT_MODEL_ID,
    IMAGINE_MODELS,
    TEXT_MODELS,
)

router = APIRouter()


@router.get("/models")
async def list_models(request: Request) -> dict[str, Any]:
    client: XaiClient = request.app.state.xai
    upstream_ids = set(await client.list_models())

    models: list[dict[str, Any]] = []
    for item in TEXT_MODELS:
        models.append(
            {
                "id": item.id,
                "kind": "text",
                "available": item.id in upstream_ids,
                "context_window": item.context_window,
                "pricing": {
                    "input_per_mtok": list(item.input_per_mtok),
                    "cached_input_per_mtok": list(item.cached_input_per_mtok),
                    "output_per_mtok": list(item.output_per_mtok),
                },
                "capabilities": list(item.capabilities),
            }
        )
    for item in IMAGINE_MODELS:
        models.append(
            {
                "id": item.id,
                "kind": "imagine",
                "available": item.id in upstream_ids,
                "unit": item.unit,
                "pricing": {"usd": item.price_usd},
                "capabilities": list(item.capabilities),
            }
        )

    return {
        "default_model": DEFAULT_MODEL_ID,
        "models": models,
    }
