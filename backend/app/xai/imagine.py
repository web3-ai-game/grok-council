from __future__ import annotations

import asyncio
from typing import Any

from app.xai.client import XaiClient
from app.xai.errors import AppError
from app.xai.registry import IMAGINE_BY_ID, ticks_to_usd

IMAGE_MODELS = {
    "grok-imagine-image",
    "grok-imagine-image-2.0",
    "grok-imagine-image-quality",
}
VIDEO_MODELS = {"grok-imagine-video", "grok-imagine-video-1.5"}
ASPECT_RATIOS = {
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "2:1",
    "1:2",
    "auto",
}


def cost_from_usage(body: dict[str, Any]) -> float:
    usage = body.get("usage")
    if isinstance(usage, dict) and usage.get("cost_in_usd_ticks") is not None:
        return ticks_to_usd(int(usage["cost_in_usd_ticks"]))
    return 0.0


def first_image_item(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise AppError("upstream_invalid", "图像响应缺少 data", status_code=502)
    item = data[0]
    if not isinstance(item.get("url"), str):
        raise AppError("upstream_invalid", "图像响应缺少 url", status_code=502)
    return item


async def generate_or_edit_image(
    client: XaiClient,
    *,
    model: str,
    prompt: str,
    n: int = 1,
    aspect_ratio: str | None = None,
    resolution: str | None = None,
    source_url: str | None = None,
) -> dict[str, Any]:
    if model not in IMAGE_MODELS:
        raise AppError("invalid_model", "不是图像模型", status_code=400)
    payload: dict[str, Any] = {"model": model, "prompt": prompt, "n": n}
    if aspect_ratio:
        payload["aspect_ratio"] = aspect_ratio
    if resolution:
        payload["resolution"] = resolution
    if source_url:
        payload["image"] = {"url": source_url, "type": "image_url"}
        return await client.edit_image(payload)
    return await client.generate_image(payload)


async def wait_video(client: XaiClient, request_id: str, timeout_s: float = 600.0) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_s
    last: dict[str, Any] | None = None
    while loop.time() < deadline:
        last = await client.get_video(request_id)
        status = last.get("status")
        if status == "done":
            return last
        if status in ("failed", "expired"):
            err = last.get("error")
            msg = "视频生成失败"
            if isinstance(err, dict) and isinstance(err.get("message"), str):
                msg = err["message"]
            raise AppError("upstream_error", msg, status_code=502)
        await asyncio.sleep(3)
    raise AppError("upstream_timeout", "视频生成超时", retryable=True, status_code=504)


def estimate_image(model: str) -> float:
    spec = IMAGINE_BY_ID.get(model)
    return spec.price_usd if spec and spec.unit == "image" else 0.0
