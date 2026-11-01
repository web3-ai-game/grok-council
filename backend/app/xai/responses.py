from __future__ import annotations

from typing import Any

from app.xai.registry import COST_USD_TICKS_DIVISOR


def output_text_from_response(response: dict[str, Any]) -> str:
    chunks: list[str] = []
    output = response.get("output")
    if not isinstance(output, list):
        return ""
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "output_text":
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
    return "".join(chunks)


def usage_from_response(response: dict[str, Any]) -> dict[str, Any] | None:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return None
    ticks_raw = usage.get("cost_in_usd_ticks") or 0
    try:
        ticks = int(ticks_raw)
    except (TypeError, ValueError):
        ticks = 0
    details_out = usage.get("output_tokens_details")
    details_in = usage.get("input_tokens_details")
    reasoning = 0
    cached = 0
    if isinstance(details_out, dict):
        reasoning = int(details_out.get("reasoning_tokens") or 0)
    if isinstance(details_in, dict):
        cached = int(details_in.get("cached_tokens") or 0)
    return {
        "prompt": int(usage.get("input_tokens") or 0),
        "completion": int(usage.get("output_tokens") or 0),
        "reasoning": reasoning,
        "cached": cached,
        "cost_usd": ticks / COST_USD_TICKS_DIVISOR,
        "cost_in_usd_ticks": ticks,
    }


def map_upstream_sse(event_name: str | None, data: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """把实测的 xAI SSE 事件名映射到 plan.md §4.3 的对外事件。"""
    etype = event_name or (data.get("type") if isinstance(data.get("type"), str) else None)
    mapped: list[tuple[str, dict[str, Any]]] = []
    if etype == "response.web_search_call.in_progress":
        mapped.append(("tool.call", {"tool": "web_search", "args": {}}))
        return mapped
    if etype == "response.web_search_call.completed":
        mapped.append(("tool.result", {"tool": "web_search", "summary": "完成"}))
        return mapped
    if etype == "response.output_text.annotation.added":
        ann = data.get("annotation")
        if isinstance(ann, dict) and isinstance(ann.get("url"), str):
            mapped.append(
                (
                    "citations",
                    {
                        "items": [
                            {
                                "url": ann["url"],
                                "title": ann.get("title") if isinstance(ann.get("title"), str) else ann["url"],
                                "source_type": "web",
                            }
                        ]
                    },
                )
            )
        return mapped
    if etype == "response.reasoning_summary_text.delta":
        delta = data.get("delta")
        if isinstance(delta, str) and delta:
            mapped.append(("message.reasoning", {"delta": delta}))
        return mapped
    if etype == "response.output_text.delta":
        delta = data.get("delta")
        if isinstance(delta, str) and delta:
            mapped.append(("message.delta", {"delta": delta}))
        return mapped
    if etype == "response.completed":
        response = data.get("response")
        if not isinstance(response, dict):
            response = data
        if response.get("error"):
            err = response["error"]
            message = err if isinstance(err, str) else str(err.get("message") or err)
            mapped.append(("error", {"code": "upstream_error", "message": message}))
            return mapped
        usage = usage_from_response(response)
        if usage is not None:
            mapped.append(("usage", usage))
        rid = response.get("id")
        mapped.append(("done", {"response_id": rid if isinstance(rid, str) else None}))
        return mapped
    return mapped
