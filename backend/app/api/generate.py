from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.memory.extract import compose_instructions, extract_memories_safe
from app.orchestrator.council import run_council
from app.orchestrator.native import stream_native
from app.security import current_user
from app.store.council_repo import CouncilRepo
from app.store.db import Database, new_id
from app.store.media import MediaRepo
from app.xai.client import XaiClient
from app.xai.errors import AppError
from app.xai.modes import NATIVE_HEAVY_MODEL, resolve_generation
from app.xai.responses import map_upstream_sse

logger = logging.getLogger(__name__)
router = APIRouter()


class MessageBody(BaseModel):
    content: str = Field(default="", max_length=100_000)
    mode: str = "auto"
    model: str | None = None
    effort: str | None = None
    tools: list[str] = Field(default_factory=list)
    edit_of: str | None = None
    heavy_engine: str | None = None
    attachments: list[str] = Field(default_factory=list)


def _db(request: Request) -> Database:
    return request.app.state.db


def _sse(event: str, data: dict[str, Any], event_id: int) -> str:
    return f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chats/{chat_id}/messages")
async def post_message(
    chat_id: str,
    body: MessageBody,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> StreamingResponse:
    db = _db(request)
    chat = await db.get_chat(str(user["id"]), chat_id)
    if chat is None:
        raise AppError("not_found", "会话不存在", status_code=404)
    mode, model, effort = resolve_generation(body.mode, body.model, body.effort)
    if mode == "heavy" and (body.heavy_engine or "council") == "native":
        model = NATIVE_HEAVY_MODEL
    uid = str(user["id"])
    content = body.content.strip()
    if not content and not body.attachments:
        raise AppError("invalid_argument", "请输入内容或附加文件", status_code=400)
    if not content:
        content = "【附件】"
    extra_parts = await _attachment_parts(request, uid, body.attachments)
    instructions = await _full_instructions(request, uid, chat)
    if body.edit_of:
        src = await db.get_message(uid, chat_id, body.edit_of)
        if src is None or src["role"] != "user":
            raise AppError("not_found", "消息不存在", status_code=404)
        await db.update_message_content(uid, chat_id, body.edit_of, content=content)
        await db.soft_delete_other_messages(uid, chat_id, body.edit_of)
        user_msg = await db.get_message(uid, chat_id, body.edit_of)
        assert user_msg is not None
    else:
        user_msg = await db.insert_message(
            uid, chat_id, "user", content, mode=mode, model=model
        )
    if chat["title"] == "新会话":
        title = body.content.strip().replace("\n", " ")[:40] or "新会话"
        await db.update_chat(str(user["id"]), chat_id, title=title, mode=mode, model=model)
    assistant_id = new_id()
    await db.insert_message(
        str(user["id"]),
        chat_id,
        "assistant",
        "",
        model=model,
        mode=mode,
        parent_id=str(user_msg["id"]),
        message_id=assistant_id,
    )
    history = await db.list_messages(str(user["id"]), chat_id)
    if mode == "heavy":
        return _stream_response(
            request,
            user,
            chat_id,
            assistant_id,
            model,
            payload=None,
            public=_heavy_events(
                request,
                uid,
                chat_id,
                assistant_id,
                _heavy_question(content, instructions),
                body.heavy_engine or "council",
            ),
        )
    payload = _build_payload(
        history,
        assistant_id,
        model,
        effort,
        body.tools,
        instructions=instructions,
        extra_parts=extra_parts,
    )
    return _stream_response(request, user, chat_id, assistant_id, model, payload)


@router.post("/chats/{chat_id}/messages/{message_id}/regenerate")
async def regenerate(
    chat_id: str,
    message_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> StreamingResponse:
    db = _db(request)
    chat = await db.get_chat(str(user["id"]), chat_id)
    if chat is None:
        raise AppError("not_found", "会话不存在", status_code=404)
    msg = await db.get_message(str(user["id"]), chat_id, message_id)
    if msg is None or msg["role"] != "assistant":
        raise AppError("not_found", "消息不存在", status_code=404)
    await db.soft_delete_messages_after(
        str(user["id"]), chat_id, str(msg["created_at"]), include_id=message_id
    )
    mode, model, effort = resolve_generation(str(msg["mode"] or "auto"), str(msg["model"] or ""), None)
    assistant_id = new_id()
    parent_id = msg.get("parent_id")
    await db.insert_message(
        str(user["id"]),
        chat_id,
        "assistant",
        "",
        model=model,
        mode=mode,
        parent_id=str(parent_id) if parent_id else None,
        message_id=assistant_id,
    )
    history = await db.list_messages(str(user["id"]), chat_id)
    instructions = await _full_instructions(request, str(user["id"]), chat)
    if mode == "heavy":
        question = ""
        for row in reversed(history):
            if row["role"] == "user" and str(row["content"]).strip():
                question = str(row["content"])
                break
        return _stream_response(
            request,
            user,
            chat_id,
            assistant_id,
            model,
            payload=None,
            public=_heavy_events(
                request,
                str(user["id"]),
                chat_id,
                assistant_id,
                _heavy_question(question, instructions),
                "council",
            ),
        )
    payload = _build_payload(
        history, assistant_id, model, effort, [], instructions=instructions
    )
    return _stream_response(request, user, chat_id, assistant_id, model, payload)


@router.post("/chats/{chat_id}/stop")
async def stop_chat(
    chat_id: str,
    request: Request,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, bool]:
    db = _db(request)
    chat = await db.get_chat(str(user["id"]), chat_id)
    if chat is None:
        raise AppError("not_found", "会话不存在", status_code=404)
    key = f"{user['id']}:{chat_id}"
    handle = request.app.state.active_streams.get(key)
    if isinstance(handle, dict):
        task = handle.get("task")
        cancel = handle.get("cancel")
        if isinstance(cancel, asyncio.Event):
            cancel.set()
        if isinstance(task, asyncio.Task) and not task.done():
            task.cancel()
        logger.info("stop requested, cancelling xAI upstream chat=%s", chat_id)
    return {"ok": True}


def _build_payload(
    history: list[dict[str, Any]],
    assistant_id: str,
    model: str,
    effort: str,
    tools: list[str],
    *,
    instructions: str | None = None,
    extra_parts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    inputs: list[dict[str, Any]] = []
    if instructions:
        inputs.append({"role": "system", "content": instructions})
    last_user_idx = None
    rows: list[dict[str, Any]] = []
    for row in history:
        if row["id"] == assistant_id:
            continue
        if row["role"] in ("user", "assistant") and (
            str(row["content"]).strip() or extra_parts
        ):
            rows.append(row)
            if row["role"] == "user":
                last_user_idx = len(rows) - 1
    for i, row in enumerate(rows):
        text = str(row["content"])
        if extra_parts and i == last_user_idx:
            parts: list[dict[str, Any]] = []
            if text.strip():
                parts.append({"type": "input_text", "text": text})
            parts.extend(extra_parts)
            inputs.append({"role": "user", "content": parts})
        else:
            inputs.append({"role": str(row["role"]), "content": text})
    payload: dict[str, Any] = {
        "model": model,
        "stream": True,
        "input": inputs,
        "reasoning": {"effort": effort},
    }
    allowed = {"web_search", "x_search", "code_execution", "collections_search"}
    tool_objs = [{"type": t} for t in tools if t in allowed]
    if tool_objs:
        payload["tools"] = tool_objs
    return payload


async def _project_instructions(
    request: Request, user_id: str, chat: dict[str, Any]
) -> str | None:
    pid = chat.get("project_id")
    if not isinstance(pid, str) or not pid:
        return None
    media = MediaRepo(request.app.state.db, request.app.state.settings.media_root)
    proj = await media.get_project(user_id, pid)
    if proj is None:
        return None
    text = str(proj.get("instructions") or "").strip()
    return text or None


async def _full_instructions(
    request: Request, user_id: str, chat: dict[str, Any]
) -> str | None:
    project = await _project_instructions(request, user_id, chat)
    return await compose_instructions(request.app.state.db, user_id, chat, project)


def _heavy_question(question: str, instructions: str | None) -> str:
    if not instructions:
        return question
    return f"{instructions}\n\n用户问题：\n{question}"


async def _extract_after_turn(
    db: Database,
    client: XaiClient,
    user_id: str,
    chat_id: str,
    assistant_text: str,
) -> None:
    chat = await db.get_chat(user_id, chat_id)
    if chat is None or chat.get("temporary"):
        return
    history = await db.list_messages(user_id, chat_id)
    user_text = ""
    for row in reversed(history):
        if row["role"] == "user" and str(row["content"]).strip():
            user_text = str(row["content"])
            break
    await extract_memories_safe(
        db=db,
        client=client,
        user_id=user_id,
        chat_id=chat_id,
        user_text=user_text,
        assistant_text=assistant_text,
    )


async def _attachment_parts(
    request: Request, user_id: str, file_ids: list[str]
) -> list[dict[str, Any]]:
    if not file_ids:
        return []
    media = MediaRepo(request.app.state.db, request.app.state.settings.media_root)
    client: XaiClient = request.app.state.xai
    parts: list[dict[str, Any]] = []
    for fid in file_ids[:8]:
        rec = await media.get_file(user_id, fid)
        if rec is None:
            raise AppError("not_found", "附件不存在", status_code=404)
        path = media.root / str(rec["path"])
        data = path.read_bytes()
        mime = str(rec["mime"])
        if mime.startswith("image/"):
            b64 = base64.b64encode(data).decode("ascii")
            parts.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{mime};base64,{b64}",
                }
            )
            continue
        xai_id = rec.get("xai_file_id")
        if not isinstance(xai_id, str) or not xai_id:
            uploaded = await client.upload_file(str(rec["filename"]), data, mime)
            xai_id = uploaded.get("id")
            if isinstance(xai_id, str):
                await media.set_xai_file_id(user_id, fid, xai_id)
        if not isinstance(xai_id, str) or not xai_id:
            raise AppError("upstream_invalid", "文件上传到 xAI 失败", status_code=502)
        parts.append({"type": "input_file", "file_id": xai_id})
    return parts


def _heavy_events(
    request: Request,
    user_id: str,
    chat_id: str,
    assistant_id: str,
    question: str,
    engine: str,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    client: XaiClient = request.app.state.xai
    settings = request.app.state.settings
    repo = CouncilRepo(request.app.state.db)
    if engine == "native":
        return stream_native(
            client, question, "medium", repo, user_id, chat_id, assistant_id
        )
    return run_council(
        client=client,
        repo=repo,
        user_id=user_id,
        chat_id=chat_id,
        message_id=assistant_id,
        question=question,
        max_experts=int(settings.max_council_experts),
        parallel=int(settings.council_parallel),
    )


def _stream_response(
    request: Request,
    user: dict[str, object],
    chat_id: str,
    assistant_id: str,
    model: str,
    payload: dict[str, Any] | None,
    public: AsyncIterator[tuple[str, dict[str, Any]]] | None = None,
) -> StreamingResponse:
    return StreamingResponse(
        _generate(request, user, chat_id, assistant_id, model, payload, public),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _generate(
    request: Request,
    user: dict[str, object],
    chat_id: str,
    assistant_id: str,
    model: str,
    payload: dict[str, Any] | None,
    public: AsyncIterator[tuple[str, dict[str, Any]]] | None = None,
) -> AsyncIterator[str]:
    db: Database = request.app.state.db
    client: XaiClient = request.app.state.xai
    key = f"{user['id']}:{chat_id}"
    cancel = asyncio.Event()
    queue: asyncio.Queue[tuple[str, Any, Any]] = asyncio.Queue()
    previous = request.app.state.active_streams.get(key)
    if isinstance(previous, dict):
        prev_task = previous.get("task")
        prev_cancel = previous.get("cancel")
        if isinstance(prev_cancel, asyncio.Event):
            prev_cancel.set()
        if isinstance(prev_task, asyncio.Task) and not prev_task.done():
            prev_task.cancel()

    async def producer() -> None:
        try:
            if public is not None:
                async for name, data in public:
                    await queue.put(("public", name, data))
            elif payload is not None:
                async for event_name, data in client.stream_responses(payload):
                    await queue.put(("sse", event_name, data))
            await queue.put(("end", None, None))
        except asyncio.CancelledError:
            logger.info("xAI upstream stream closed (cancelled) chat=%s", chat_id)
            await queue.put(("end", None, None))
            raise
        except AppError as exc:
            await queue.put(("app_error", exc, None))
        except Exception as exc:
            logger.exception("stream failed chat=%s", chat_id)
            await queue.put(("exc", exc, None))

    task = asyncio.create_task(producer())
    request.app.state.active_streams[key] = {"task": task, "cancel": cancel}

    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    seq = 0
    logged_usage = False
    stopped = False

    def next_sse(event: str, data: dict[str, Any]) -> str:
        nonlocal seq
        seq += 1
        return _sse(event, data, seq)

    async def persist() -> None:
        await db.update_message_content(
            str(user["id"]),
            chat_id,
            assistant_id,
            content="".join(content_parts),
            reasoning_summary="".join(reasoning_parts) or None,
        )

    yield next_sse("message.start", {"message_id": assistant_id})
    try:
        while True:
            if cancel.is_set() and not task.done():
                task.cancel()
            try:
                kind, a, b = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if kind == "end":
                break
            if kind == "app_error":
                exc: AppError = a
                yield next_sse(
                    "error",
                    {
                        "code": exc.code,
                        "message": exc.message,
                        "retryable": exc.retryable,
                        "retry_after": exc.retry_after,
                    },
                )
                break
            if kind == "exc":
                yield next_sse("error", {"code": "internal_error", "message": "生成失败", "retryable": False})
                break
            event_name, data = a, b
            if kind == "public":
                mapped_events = [(event_name, data)]
            else:
                mapped_events = map_upstream_sse(event_name, data)
            for name, mapped in mapped_events:
                if name in ("message.delta", "synth.delta"):
                    if mapped.get("replace"):
                        content_parts.clear()
                        content_parts.append(str(mapped["replace"]))
                    elif mapped.get("delta"):
                        content_parts.append(str(mapped["delta"]))
                elif name in ("message.reasoning", "synth.reasoning"):
                    reasoning_parts.append(str(mapped["delta"]))
                elif name == "usage":
                    await db.insert_usage(
                        str(user["id"]),
                        chat_id,
                        model,
                        prompt_tokens=int(mapped.get("prompt") or 0),
                        cached_tokens=int(mapped.get("cached") or 0),
                        completion_tokens=int(mapped.get("completion") or 0),
                        reasoning_tokens=int(mapped.get("reasoning") or 0),
                        cost_usd=float(mapped.get("cost_usd") or 0),
                    )
                    logged_usage = True
                    await persist()
                yield next_sse(name, mapped)
        if cancel.is_set():
            stopped = True
            yield next_sse("error", {"code": "stopped", "message": "已停止生成"})
            await persist()
    except asyncio.CancelledError:
        logger.info("client abort: cancelling xAI upstream chat=%s", chat_id)
        if not task.done():
            task.cancel()
        await persist()
        raise
    finally:
        if not task.done():
            task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        handle = request.app.state.active_streams.get(key)
        if isinstance(handle, dict) and handle.get("task") is task:
            request.app.state.active_streams.pop(key, None)
        if not logged_usage and not stopped:
            await persist()
        assistant_text = "".join(content_parts).strip()
        if logged_usage and not stopped and assistant_text:
            asyncio.create_task(
                _extract_after_turn(
                    db, client, str(user["id"]), chat_id, assistant_text
                )
            )
