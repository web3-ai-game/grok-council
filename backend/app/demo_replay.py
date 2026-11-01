from __future__ import annotations

import json
from typing import Any

from app.config import REPO_ROOT

TICK_MS = 56
STAGGER_MS = 320
GATE_MS = 1200
PHASE_GAP_MS = 460
STEP_MS = 480

SEATS = (
    ("analyst", "🔍", "分析師", "Analyst"),
    ("researcher", "🛰️", "情報官", "Intel"),
    ("engineer", "🛠️", "工程師", "Systems Engineer"),
    ("critic", "🧨", "紅隊", "Red Team"),
    ("strategist", "🧭", "策略家", "Strategist"),
    ("writer", "✍️", "表達者", "Communicator"),
    ("quant", "🧮", "量化員", "Quant"),
    ("leader", "⚖️", "議長", "Chair"),
)

SCENARIO_DIR = REPO_ROOT / "demo" / "scenarios"


def chunk_text(text: str) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(text):
        n = 2 if ord(text[i]) > 127 else 8
        out.append(text[i : i + n])
        i += n
    return out


def load_scenarios() -> list[dict[str, Any]]:
    files = sorted(SCENARIO_DIR.glob("*.json"))
    return [json.loads(path.read_text(encoding="utf-8")) for path in files]


def scenario_by_id(scenario_id: str) -> dict[str, Any] | None:
    for row in load_scenarios():
        if row.get("id") == scenario_id:
            return row
    return None


def _stream(
    events: list[tuple[int, int, str, dict[str, Any]]],
    at: int,
    seq: int,
    event: str,
    base: dict[str, Any],
    text: str,
) -> tuple[int, int]:
    for delta in chunk_text(text):
        events.append((at, seq, event, {**base, "delta": delta}))
        seq += 1
        at += TICK_MS
    return at, seq


def _steps(script: dict[str, Any]) -> list[str]:
    raw = script.get("steps")
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw[:3] if str(item)]


def _play_steps(
    events: list[tuple[int, int, str, dict[str, Any]]],
    at: int,
    seq: int,
    expert_id: str,
    steps: list[str],
    limit: int | None = None,
) -> tuple[int, int]:
    shown = steps if limit is None else steps[:limit]
    for index, label in enumerate(shown):
        events.append((at, seq, "expert.step", {"expert_id": expert_id, "index": index, "label": label}))
        seq += 1
        at += STEP_MS
    return at, seq


def _timed_events(scenario: dict[str, Any], lang: str) -> list[tuple[int, int, str, dict[str, Any]]]:
    side = scenario.get("en" if lang == "en" else "zh")
    if not isinstance(side, dict):
        side = scenario["zh"]
    seats = side.get("seats") if isinstance(side.get("seats"), dict) else {}
    events: list[tuple[int, int, str, dict[str, Any]]] = []
    seq = 0

    def push(at: int, event: str, data: dict[str, Any] | None = None) -> None:
        nonlocal seq
        events.append((at, seq, event, data or {}))
        seq += 1

    push(0, "phase", {"phase": "gate"})
    push(0, "gate.start", {})
    experts = []
    for seat_id, emoji, zh, en in SEATS:
        script = seats.get(seat_id) if isinstance(seats.get(seat_id), dict) else {}
        standby = seat_id != "leader" and bool(script.get("standby"))
        experts.append(
            {
                "id": seat_id,
                "name": en if lang == "en" else zh,
                "emoji": emoji,
                "status": "standby" if standby else "pending",
            }
        )
    push(GATE_MS, "gate.done", {"experts": experts})
    push(GATE_MS, "phase", {"phase": "parallel"})

    awake = []
    for seat_id, *_rest in SEATS:
        if seat_id == "leader":
            continue
        script = seats.get(seat_id) if isinstance(seats.get(seat_id), dict) else {}
        if script.get("standby"):
            continue
        awake.append((seat_id, script))

    parallel_end = GATE_MS
    for index, (seat_id, script) in enumerate(awake):
        t = GATE_MS + 80 + index * STAGGER_MS
        push(t, "expert.start", {"expert_id": seat_id})
        t += 140
        steps = _steps(script)
        failed = bool(script.get("error"))
        t, seq = _play_steps(events, t, seq, seat_id, steps, min(2, len(steps)) if failed else None)
        t += 120
        if failed:
            push(t, "expert.done", {"expert_id": seat_id, "error": str(script.get("error") or "")})
        else:
            t, seq = _stream(events, t, seq, "expert.delta", {"expert_id": seat_id}, str(script.get("answer") or ""))
            t += 40
            push(t, "expert.done", {"expert_id": seat_id})
        parallel_end = max(parallel_end, t)

    reviews = [
        (seat_id, script)
        for seat_id, script in awake
        if script.get("review") and script.get("review_target") and not script.get("error")
    ]
    cursor = parallel_end + PHASE_GAP_MS
    push(cursor, "phase", {"phase": "review"})
    for offset in range(0, len(reviews), 2):
        pair_end = cursor
        for seat_id, script in reviews[offset : offset + 2]:
            target = str(script.get("review_target"))
            t = cursor
            push(t, "review.start", {"expert_id": seat_id, "target_id": target})
            t += 80
            t, seq = _stream(
                events,
                t,
                seq,
                "review.delta",
                {"expert_id": seat_id, "target_id": target},
                str(script.get("review") or ""),
            )
            t += 40
            push(t, "review.done", {"expert_id": seat_id, "target_id": target})
            pair_end = max(pair_end, t)
        cursor = pair_end + 220

    chair = side.get("chair") if isinstance(side.get("chair"), dict) else {}
    synth_at = cursor + PHASE_GAP_MS
    push(synth_at, "phase", {"phase": "synth"})
    push(synth_at, "synth.start", {})
    push(synth_at, "expert.start", {"expert_id": "leader"})
    t = synth_at + 160
    t, seq = _play_steps(events, t, seq, "leader", _steps(chair))
    t += 160
    t, seq = _stream(events, t, seq, "synth.delta", {}, str(chair.get("answer") or ""))
    t += 40
    push(t, "expert.done", {"expert_id": "leader"})
    push(t, "done", {})
    push(t, "phase", {"phase": "done"})
    events.sort(key=lambda item: (item[0], item[1]))
    return events


def build_timeline(scenario: dict[str, Any], lang: str) -> list[tuple[str, dict[str, Any]]]:
    return [(event, data) for _at, _seq, event, data in _timed_events(scenario, lang)]


def timeline_with_delay(scenario: dict[str, Any], lang: str) -> list[tuple[int, str, dict[str, Any]]]:
    return [(at, event, data) for at, _seq, event, data in _timed_events(scenario, lang)]


def public_catalog(lang: str) -> list[dict[str, Any]]:
    catalog = []
    for row in load_scenarios():
        side = row.get("en" if lang == "en" else "zh")
        if not isinstance(side, dict):
            continue
        seats = side.get("seats") if isinstance(side.get("seats"), dict) else {}
        skipped = [seat_id for seat_id, script in seats.items() if isinstance(script, dict) and script.get("standby")]
        catalog.append(
            {
                "id": row.get("id"),
                "title": side.get("title"),
                "question": side.get("question"),
                "wake": row.get("wake"),
                "skipped": skipped,
            }
        )
    return catalog
