from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.security import current_user
from app.xai.client import XaiClient
from app.xai.errors import AppError

router = APIRouter(prefix="/voice")

_MAX_AUDIO = 8 * 1024 * 1024


class SpeakBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: str | None = Field(default=None, max_length=16)


def _client(request: Request) -> XaiClient:
    return request.app.state.xai


@router.post("/transcribe")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    user: dict[str, object] = Depends(current_user),
) -> dict[str, Any]:
    del user
    data = await file.read()
    if not data:
        raise AppError("invalid_argument", "音频为空", status_code=400)
    if len(data) > _MAX_AUDIO:
        raise AppError("invalid_argument", "音频过大", status_code=400)
    filename = file.filename or "audio.webm"
    mime = file.content_type or "application/octet-stream"
    body = await _client(request).transcribe_audio(filename, data, mime)
    text = body.get("text")
    if not isinstance(text, str):
        raise AppError("upstream_invalid", "转写结果缺少 text", status_code=502)
    language = body.get("language") if isinstance(body.get("language"), str) else None
    duration = body.get("duration")
    return {
        "text": text,
        "language": language,
        "duration": duration if isinstance(duration, (int, float)) else None,
    }


@router.post("/speak")
async def speak(
    body: SpeakBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> Response:
    del user
    text = body.text.strip()
    if not text:
        raise AppError("invalid_argument", "文本为空", status_code=400)
    language = body.language or ("zh" if any("\u4e00" <= ch <= "\u9fff" for ch in text) else "en")
    audio, mime = await _client(request).synthesize_speech(text, language=language)
    return Response(content=audio, media_type=mime or "audio/mpeg")
