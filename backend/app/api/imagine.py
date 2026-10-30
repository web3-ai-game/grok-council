from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.security import current_user
from app.store.db import Database
from app.store.media import MediaRepo
from app.xai.client import XaiClient
from app.xai.errors import AppError
from app.xai.imagine import (
    ASPECT_RATIOS,
    IMAGE_MODELS,
    VIDEO_MODELS,
    cost_from_usage,
    first_image_item,
    generate_or_edit_image,
    wait_video,
)
from app.xai.registry import IMAGINE_BY_ID

router = APIRouter(prefix="/imagine")

VIDEO_ASPECT = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}


class ImageBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = "grok-imagine-image"
    n: int = Field(default=1, ge=1, le=4)
    aspect_ratio: str | None = None
    resolution: str | None = None
    image_url: str | None = None
    file_id: str | None = None


class VideoBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    model: str = "grok-imagine-video"
    duration: int = Field(default=2, ge=1, le=15)
    aspect_ratio: str | None = None
    resolution: str | None = None
    image_url: str | None = None


def _media(request: Request) -> MediaRepo:
    settings = request.app.state.settings
    return MediaRepo(request.app.state.db, settings.media_root)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "prompt": row["prompt"],
        "model": row["model"],
        "mime": row.get("mime"),
        "cost_usd": row["cost_usd"],
        "created_at": row["created_at"],
        "url": f"/api/imagine/{row['id']}/file",
    }


def _ext(mime: str | None, kind: str) -> str:
    if mime == "image/png":
        return "png"
    if mime == "image/webp":
        return "webp"
    if mime in ("video/mp4", "video/quicktime"):
        return "mp4"
    return "mp4" if kind == "video" else "jpg"


async def _source_data_uri(media: MediaRepo, user_id: str, file_id: str) -> str:
    rec = await media.get_file(user_id, file_id)
    if rec is None:
        raise AppError("not_found", "文件不存在", status_code=404)
    raw = (media.root / rec["path"]).read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{rec['mime']};base64,{b64}"


async def _save_blob(
    media: MediaRepo,
    db: Database,
    user_id: str,
    kind: str,
    prompt: str,
    model: str,
    blob: bytes,
    mime: str,
    cost: float,
) -> dict[str, Any]:
    rel_dir = f"generations/{user_id}"
    (media.root / rel_dir).mkdir(parents=True, exist_ok=True)
    row = await media.insert_generation(user_id, kind, prompt, model, "tmp", cost, mime)
    rel_path = f"{rel_dir}/{row['id']}.{_ext(mime, kind)}"
    (media.root / rel_path).write_bytes(blob)
    await media.set_generation_path(user_id, row["id"], rel_path)
    await db.insert_usage(
        user_id,
        None,
        model,
        prompt_tokens=0,
        cached_tokens=0,
        completion_tokens=0,
        reasoning_tokens=0,
        cost_usd=cost,
    )
    saved = await media.get_generation(user_id, row["id"])
    assert saved is not None
    return saved


@router.get("")
async def list_generations(
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    rows = await _media(request).list_generations(str(user["id"]))
    return {"generations": [_public(r) for r in rows]}


@router.post("/image")
async def post_image(
    body: ImageBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    if body.model not in IMAGE_MODELS:
        raise AppError("invalid_model", "不是图像模型", status_code=400)
    if body.aspect_ratio and body.aspect_ratio not in ASPECT_RATIOS:
        raise AppError("invalid_argument", "不支持的 aspect_ratio", status_code=400)
    if body.resolution and body.resolution not in {"1k", "2k"}:
        raise AppError("invalid_argument", "resolution 只能是 1k 或 2k", status_code=400)
    uid = str(user["id"])
    media = _media(request)
    source_url = body.image_url
    if body.file_id:
        source_url = await _source_data_uri(media, uid, body.file_id)
    client: XaiClient = request.app.state.xai
    db: Database = request.app.state.db
    upstream = await generate_or_edit_image(
        client,
        model=body.model,
        prompt=body.prompt,
        n=body.n,
        aspect_ratio=body.aspect_ratio,
        resolution=body.resolution,
        source_url=source_url,
    )
    item = first_image_item(upstream)
    blob, dl_mime = await client.download_url(str(item["url"]))
    mime = str(item.get("mime_type") or dl_mime or "image/jpeg")
    saved = await _save_blob(
        media, db, uid, "image", body.prompt, body.model, blob, mime, cost_from_usage(upstream)
    )
    return {"generation": _public(saved)}


@router.post("/video")
async def post_video(
    body: VideoBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    if body.model not in VIDEO_MODELS:
        raise AppError("invalid_model", "不是视频模型", status_code=400)
    if body.aspect_ratio and body.aspect_ratio not in VIDEO_ASPECT:
        raise AppError("invalid_argument", "不支持的 aspect_ratio", status_code=400)
    if body.resolution and body.resolution not in {"480p", "720p", "1080p"}:
        raise AppError("invalid_argument", "resolution 只能是 480p/720p/1080p", status_code=400)
    uid = str(user["id"])
    media = _media(request)
    client: XaiClient = request.app.state.xai
    db: Database = request.app.state.db
    payload: dict[str, Any] = {
        "model": body.model,
        "prompt": body.prompt,
        "duration": body.duration,
    }
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.resolution:
        payload["resolution"] = body.resolution
    if body.image_url:
        payload["image"] = {"url": body.image_url}
    started = await client.start_video(payload)
    request_id = started.get("request_id")
    if not isinstance(request_id, str):
        raise AppError("upstream_invalid", "视频响应缺少 request_id", status_code=502)
    done = await wait_video(client, request_id)
    video = done.get("video")
    if not isinstance(video, dict) or not isinstance(video.get("url"), str):
        raise AppError("upstream_invalid", "视频完成但缺少 url", status_code=502)
    blob, dl_mime = await client.download_url(str(video["url"]))
    mime = dl_mime or "video/mp4"
    cost = cost_from_usage(done)
    spec = IMAGINE_BY_ID.get(body.model)
    if cost == 0 and spec is not None:
        cost = spec.price_usd * body.duration
    saved = await _save_blob(
        media, db, uid, "video", body.prompt, body.model, blob, mime, cost
    )
    return {"generation": _public(saved)}


@router.get("/{gen_id}/file")
async def get_generation_file(
    gen_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> FileResponse:
    media = _media(request)
    row = await media.get_generation(str(user["id"]), gen_id)
    if row is None:
        raise AppError("not_found", "作品不存在", status_code=404)
    path = media.root / str(row["path"])
    if not path.is_file():
        raise AppError("not_found", "文件缺失", status_code=404)
    mime = str(row.get("mime") or "application/octet-stream")
    return FileResponse(path, media_type=mime, filename=path.name)
