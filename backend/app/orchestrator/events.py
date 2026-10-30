from __future__ import annotations

from typing import Any

# plan.md §4.3 对外事件名，禁止擅自发明。
GATE_START = "gate.start"
GATE_DONE = "gate.done"
EXPERT_START = "expert.start"
EXPERT_REASONING = "expert.reasoning"
EXPERT_DELTA = "expert.delta"
EXPERT_DONE = "expert.done"
TOOL_CALL = "tool.call"
TOOL_RESULT = "tool.result"
SYNTH_START = "synth.start"
SYNTH_REASONING = "synth.reasoning"
SYNTH_DELTA = "synth.delta"
CITATIONS = "citations"
USAGE = "usage"
DONE = "done"
ERROR = "error"
MESSAGE_START = "message.start"
MESSAGE_REASONING = "message.reasoning"
MESSAGE_DELTA = "message.delta"


def sse_tuple(event: str, data: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    return event, data or {}
