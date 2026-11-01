from __future__ import annotations

import json
import re
from typing import Any

from app.config import REPO_ROOT

TICK_MS = 56
STAGGER_MS = 320
GATE_MS = 1200
PHASE_GAP_MS = 460

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


def _advance_cost(text: str, index: int) -> int:
    code = ord(text[index])
    base = 28 if code > 127 else 12
    jitter = ((index * 13) % 7) - 3
    ch = text[index]
    pause = 120 if ch in "。！？.!?" else 48 if ch in "，、,;；" else 36 if ch == "\n" else 0
    return max(8, base + jitter + pause)


def _text_duration(text: str) -> int:
    return 90 + sum(_advance_cost(text, i) for i in range(len(text)))


def _interrupted(text: str) -> str:
    cut = max(18, int(len(text) * 0.58))
    end = cut
    for i in range(cut, int(len(text) * 0.35) - 1, -1):
        if text[i] in "。！？.!?，、,;；":
            end = i
            break
    return text[:end].rstrip()


def _as_chain(text: str) -> str:
    text = re.sub(r"([。！？])\s*", r"\1\n", text)
    text = re.sub(r"([.!?])\s+(?=[A-Z])", r"\1\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _thought_text(script: dict[str, Any], failed: bool) -> str:
    raw = script.get("brief")
    parts = [str(item).strip() for item in raw if str(item).strip()] if isinstance(raw, list) else []
    if not parts:
        steps = script.get("steps")
        parts = [str(item) for item in steps if str(item)] if isinstance(steps, list) else []
        text = "\n".join(parts)
    else:
        text = "\n\n".join(parts)
    text = _as_chain(text)
    if not text:
        return ""
    return _interrupted(text) if failed else text


def _play_thought(
    events: list[tuple[int, int, str, dict[str, Any]]],
    at: int,
    seq: int,
    expert_id: str,
    text: str,
) -> tuple[int, int]:
    if not text:
        return at, seq
    events.append((at, seq, "thought.start", {"expert_id": expert_id, "text": text}))
    return at + _text_duration(text), seq + 1


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
    spans: dict[str, tuple[int, int]] = {}
    for index, (seat_id, script) in enumerate(awake):
        t = GATE_MS + 80 + index * STAGGER_MS
        push(t, "expert.start", {"expert_id": seat_id})
        t += 80
        failed = bool(script.get("error"))
        t, seq = _play_thought(events, t, seq, seat_id, _thought_text(script, failed))
        t += 90
        if failed:
            spans[seat_id] = (t, t)
            push(t, "expert.done", {"expert_id": seat_id, "error": str(script.get("error") or "")})
        else:
            answer_start = t
            t, seq = _stream(events, t, seq, "expert.delta", {"expert_id": seat_id}, str(script.get("answer") or ""))
            spans[seat_id] = (answer_start, t)
            t += 40
            push(t, "expert.done", {"expert_id": seat_id})
        parallel_end = max(parallel_end, t)

    reviews = [
        (seat_id, script)
        for seat_id, script in awake
        if script.get("review") and script.get("review_target") and not script.get("error")
    ]
    grouped: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for seat_id, script in reviews:
        target = str(script.get("review_target"))
        grouped.setdefault(target, []).append((seat_id, script))
    cuts: list[tuple[str, str, str, int]] = []
    for target, group in grouped.items():
        answer_start, answer_done = spans.get(target, (parallel_end, parallel_end))
        duration = max(0, answer_done - answer_start)
        gap = 0 if len(group) <= 1 else min(360, max(70, (duration - 140) // len(group)))
        for n, (seat_id, script) in enumerate(group):
            at = answer_start + min(160, int(duration * 0.22)) + n * gap
            if target in spans and at >= answer_done:
                at = answer_start + min(36 + n * 28, max(0, duration - 16))
            cuts.append((seat_id, target, str(script.get("review") or ""), at))
    review_end = parallel_end
    if cuts:
        push(min(item[3] for item in cuts), "phase", {"phase": "review"})
        for seat_id, target, review, at in cuts:
            t = at
            push(t, "review.start", {"expert_id": seat_id, "target_id": target})
            t += 60
            t, seq = _stream(events, t, seq, "review.delta", {"expert_id": seat_id, "target_id": target}, review)
            t += 40
            push(t, "review.done", {"expert_id": seat_id, "target_id": target})
            review_end = max(review_end, t)

    chair = side.get("chair") if isinstance(side.get("chair"), dict) else {}
    synth_at = max(parallel_end, review_end) + PHASE_GAP_MS
    push(synth_at, "phase", {"phase": "synth"})
    push(synth_at, "synth.start", {})
    push(synth_at, "expert.start", {"expert_id": "leader"})
    t = synth_at + 80
    t, seq = _play_thought(events, t, seq, "leader", _thought_text(chair, False))
    t += 90
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
