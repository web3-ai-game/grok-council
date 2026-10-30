from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import Settings
from app.xai.errors import AppError, mask_key

logger = logging.getLogger(__name__)

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_BASE_BACKOFF_S = 0.5


class XaiClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._http = httpx.AsyncClient(
            base_url=settings.xai_base_url.rstrip("/"),
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0),
            trust_env=False,
            headers={
                "Authorization": f"Bearer {settings.xai_api_key}",
                "Accept": "application/json",
            },
        )
        logger.info("xAI client ready, key=%s", mask_key(settings.xai_api_key))

    async def aclose(self) -> None:
        await self._http.aclose()

    async def list_models(self) -> list[str]:
        payload = await self._request("GET", "/models")
        data = payload.get("data")
        if not isinstance(data, list):
            raise AppError(
                "upstream_invalid",
                "xAI /v1/models 响应缺少 data 数组",
                status_code=502,
            )
        ids: list[str] = []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                ids.append(item["id"])
        return ids

    async def stream_responses(
        self, payload: dict[str, Any]
    ) -> AsyncIterator[tuple[str | None, dict[str, Any]]]:
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        try:
            async with self._http.stream(
                "POST",
                "/responses",
                json=payload,
                timeout=timeout,
                headers={"Accept": "text/event-stream"},
            ) as response:
                if response.status_code >= 400:
                    raw = await response.aread()
                    fake = httpx.Response(
                        response.status_code,
                        headers=response.headers,
                        content=raw,
                    )
                    raise self._error_from_response(fake)
                event_name: str | None = None
                data_lines: list[str] = []
                async for line in response.aiter_lines():
                    if line == "":
                        if event_name or data_lines:
                            joined = "\n".join(data_lines)
                            parsed: dict[str, Any]
                            try:
                                loaded = json.loads(joined) if joined else {}
                            except json.JSONDecodeError:
                                loaded = {"raw": joined}
                            parsed = loaded if isinstance(loaded, dict) else {"raw": loaded}
                            yield event_name, parsed
                        event_name = None
                        data_lines = []
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
        except asyncio.CancelledError:
            logger.info("xAI upstream stream closed (cancelled)")
            raise

    async def create_response(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = {**payload, "stream": False}
        return await self._request(
            "POST",
            "/responses",
            json_body=body,
            timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0),
        )

    async def generate_image(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/images/generations",
            json_body=payload,
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=10.0),
        )

    async def edit_image(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/images/edits",
            json_body=payload,
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=10.0),
        )

    async def start_video(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/videos/generations",
            json_body=payload,
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0),
        )

    async def get_video(self, request_id: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/videos/{request_id}",
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0),
        )

    async def upload_file(self, filename: str, content: bytes, mime: str) -> dict[str, Any]:
        last_error: AppError | None = None
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0)
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._http.post(
                    "/files",
                    files={"file": (filename, content, mime)},
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                last_error = AppError(
                    "upstream_timeout",
                    "xAI 请求超时",
                    retryable=True,
                    status_code=504,
                )
                logger.warning("xAI timeout POST /files: %s", exc)
            except httpx.HTTPError as exc:
                last_error = AppError(
                    "upstream_network",
                    "无法连接 xAI",
                    retryable=True,
                    status_code=502,
                )
                logger.warning("xAI network error POST /files: %s", exc)
            else:
                if response.status_code < 400:
                    body = response.json()
                    if not isinstance(body, dict):
                        raise AppError(
                            "upstream_invalid",
                            "xAI 返回了非对象 JSON",
                            status_code=502,
                        )
                    return body
                last_error = self._error_from_response(response)
                if response.status_code not in _RETRYABLE_STATUS:
                    raise last_error
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF_S * (2**attempt))
        assert last_error is not None
        raise last_error

    async def transcribe_audio(
        self, filename: str, content: bytes, mime: str
    ) -> dict[str, Any]:
        # 实测：POST /v1/stt multipart file，见 docs/xai-notes.md
        last_error: AppError | None = None
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0)
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._http.post(
                    "/stt",
                    files={"file": (filename, content, mime)},
                    timeout=timeout,
                )
            except httpx.TimeoutException as exc:
                last_error = AppError(
                    "upstream_timeout",
                    "xAI 请求超时",
                    retryable=True,
                    status_code=504,
                )
                logger.warning("xAI timeout POST /stt: %s", exc)
            except httpx.HTTPError as exc:
                last_error = AppError(
                    "upstream_network",
                    "无法连接 xAI",
                    retryable=True,
                    status_code=502,
                )
                logger.warning("xAI network error POST /stt: %s", exc)
            else:
                if response.status_code < 400:
                    body = response.json()
                    if not isinstance(body, dict):
                        raise AppError(
                            "upstream_invalid",
                            "xAI 返回了非对象 JSON",
                            status_code=502,
                        )
                    return body
                last_error = self._error_from_response(response)
                if response.status_code not in _RETRYABLE_STATUS:
                    raise last_error
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF_S * (2**attempt))
        assert last_error is not None
        raise last_error

    async def synthesize_speech(
        self, text: str, *, voice_id: str = "eve", language: str = "zh"
    ) -> tuple[bytes, str]:
        # 实测：POST /v1/tts JSON → audio/mpeg，见 docs/xai-notes.md
        last_error: AppError | None = None
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._http.post(
                    "/tts",
                    json={"text": text, "voice_id": voice_id, "language": language},
                    timeout=timeout,
                    headers={"Accept": "audio/mpeg, application/json"},
                )
            except httpx.TimeoutException as exc:
                last_error = AppError(
                    "upstream_timeout",
                    "xAI 请求超时",
                    retryable=True,
                    status_code=504,
                )
                logger.warning("xAI timeout POST /tts: %s", exc)
            except httpx.HTTPError as exc:
                last_error = AppError(
                    "upstream_network",
                    "无法连接 xAI",
                    retryable=True,
                    status_code=502,
                )
                logger.warning("xAI network error POST /tts: %s", exc)
            else:
                if response.status_code < 400:
                    mime = response.headers.get("content-type") or "audio/mpeg"
                    return response.content, mime.split(";")[0].strip()
                last_error = self._error_from_response(response)
                if response.status_code not in _RETRYABLE_STATUS:
                    raise last_error
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF_S * (2**attempt))
        assert last_error is not None
        raise last_error

    async def download_url(self, url: str) -> tuple[bytes, str | None]:
        # 临时 CDN URL 不要带 API Key
        timeout = httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as raw:
            response = await raw.get(url)
        if response.status_code >= 400:
            raise AppError(
                "upstream_error",
                f"下载生成结果失败 ({response.status_code})",
                status_code=502,
            )
        mime = response.headers.get("content-type")
        return response.content, mime.split(";")[0].strip() if mime else None

    async def _request(
        self,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> dict[str, Any]:
        last_error: AppError | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._http.request(
                    method, path, json=json_body, timeout=timeout
                )
            except httpx.TimeoutException as exc:
                last_error = AppError(
                    "upstream_timeout",
                    "xAI 请求超时",
                    retryable=True,
                    status_code=504,
                )
                logger.warning("xAI timeout %s %s: %s", method, path, exc)
            except httpx.HTTPError as exc:
                last_error = AppError(
                    "upstream_network",
                    "无法连接 xAI",
                    retryable=True,
                    status_code=502,
                )
                logger.warning("xAI network error %s %s: %s", method, path, exc)
            else:
                if response.status_code < 400:
                    try:
                        body = response.json()
                    except ValueError as exc:
                        raise AppError(
                            "upstream_invalid",
                            "xAI 返回了非 JSON",
                            status_code=502,
                        ) from exc
                    if not isinstance(body, dict):
                        raise AppError(
                            "upstream_invalid",
                            "xAI 返回了非对象 JSON",
                            status_code=502,
                        )
                    return body
                last_error = self._error_from_response(response)
                if response.status_code not in _RETRYABLE_STATUS:
                    raise last_error

            if attempt < _MAX_RETRIES - 1:
                delay = _BASE_BACKOFF_S * (2**attempt)
                if last_error and last_error.retry_after:
                    delay = max(delay, float(last_error.retry_after))
                await asyncio.sleep(delay)

        assert last_error is not None
        raise last_error

    def _error_from_response(self, response: httpx.Response) -> AppError:
        message = _extract_upstream_message(response)
        retry_after = _parse_retry_after(response)
        status = response.status_code
        # 实测：错误 Key 走 GET /v1/models 返回 HTTP 400 + error 字符串
        # "Incorrect API key provided..."，不是 401。
        if status in (401, 403) or _looks_like_bad_key(status, message):
            return AppError(
                "upstream_auth",
                message or "xAI API Key 无效或无权限",
                retryable=False,
                status_code=401,
            )
        if status == 429:
            return AppError(
                "upstream_rate_limit",
                message or "限流，请稍候",
                retryable=True,
                status_code=429,
                retry_after=retry_after,
            )
        if status >= 500:
            return AppError(
                "upstream_error",
                message or f"xAI 服务端错误 ({status})",
                retryable=True,
                status_code=502,
            )
        return AppError(
            "upstream_error",
            message or f"xAI 返回 {status}",
            retryable=False,
            status_code=502,
        )


def _looks_like_bad_key(status: int, message: str) -> bool:
    if status != 400:
        return False
    lowered = message.lower()
    return "api key" in lowered or "incorrect api key" in lowered


def _extract_upstream_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        text = response.text.strip()
        return text[:300] if text else ""
    if not isinstance(body, dict):
        return ""
    err = body.get("error")
    if isinstance(err, dict) and isinstance(err.get("message"), str):
        return err["message"]
    if isinstance(err, str):
        return err
    if isinstance(body.get("message"), str):
        return body["message"]
    return ""


def _parse_retry_after(response: httpx.Response) -> int | None:
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None
