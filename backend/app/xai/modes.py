from __future__ import annotations

from app.xai.registry import DEFAULT_MODEL_ID

# plan.md §4.4
MODE_PRESETS: dict[str, dict[str, str]] = {
    "auto": {"model": DEFAULT_MODEL_ID, "effort": "low"},
    "fast": {"model": DEFAULT_MODEL_ID, "effort": "low"},
    "expert": {"model": DEFAULT_MODEL_ID, "effort": "high"},
    "heavy": {"model": DEFAULT_MODEL_ID, "effort": "xhigh"},
}

NATIVE_HEAVY_MODEL = "grok-4.20-multi-agent-0309"

ALLOWED_EFFORTS = {"low", "medium", "high", "xhigh"}


def resolve_generation(
    mode: str,
    model: str | None,
    effort: str | None,
) -> tuple[str, str, str]:
    key = mode if mode in MODE_PRESETS else "auto"
    preset = MODE_PRESETS[key]
    resolved_model = model or preset["model"]
    resolved_effort = effort or preset["effort"]
    if resolved_effort not in ALLOWED_EFFORTS:
        resolved_effort = preset["effort"]
    if resolved_model == DEFAULT_MODEL_ID or resolved_model.startswith("grok-"):
        return key, resolved_model, resolved_effort
    return key, preset["model"], resolved_effort
