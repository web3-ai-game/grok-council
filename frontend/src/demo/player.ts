import { SEATS, seatName } from "./seats";
import type { Lang } from "./seats";
import type { Phase, ScenarioFile, TimedEvent } from "./types";

export const TICK_MS = 56;
export const STAGGER_MS = 320;
export const GATE_MS = 1200;
export const PHASE_GAP_MS = 460;
const LEAD_MS = 90;

export function advanceCost(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const base = code > 127 ? 28 : 12;
  const jitter = ((index * 13) % 7) - 3;
  const ch = text[index] ?? "";
  const pause = "。！？.!?".includes(ch) ? 120 : "，、,;；".includes(ch) ? 48 : ch === "\n" ? 36 : 0;
  return Math.max(8, base + jitter + pause);
}

export function textDuration(text: string): number {
  let ms = LEAD_MS;
  for (let i = 0; i < text.length; i += 1) ms += advanceCost(text, i);
  return ms;
}

export function typedCount(text: string, elapsed: number): number {
  let ms = LEAD_MS;
  if (elapsed < ms) return 0;
  for (let i = 0; i < text.length; i += 1) {
    ms += advanceCost(text, i);
    if (elapsed < ms) return i;
  }
  return text.length;
}

export function interruptedThought(text: string): string {
  const cut = Math.max(18, Math.floor(text.length * 0.58));
  let end = cut;
  for (let i = cut; i >= Math.floor(text.length * 0.35); i -= 1) {
    const ch = text[i] ?? "";
    if ("。！？.!?，、,;；".includes(ch)) {
      end = i;
      break;
    }
  }
  return text.slice(0, end).trimEnd();
}

let seq = 0;

function push(events: TimedEvent[], at: number, event: string, data: Record<string, unknown> = {}): void {
  events.push({ at, seq: seq++, event, data });
}

export function chunkText(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    const n = code > 127 ? 2 : 8;
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

function stream(
  events: TimedEvent[],
  at: number,
  event: string,
  base: Record<string, unknown>,
  text: string,
): number {
  let t = at;
  for (const delta of chunkText(text)) {
    push(events, t, event, { ...base, delta });
    t += TICK_MS;
  }
  return t;
}

function asChain(text: string): string {
  return text
    .replace(/([。！？])\s*/g, "$1\n")
    .replace(/([.!?])\s+(?=[A-Z])/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function thoughtText(script: { brief?: string[]; steps?: string[] } | undefined, failed: boolean): string {
  const brief = (script?.brief ?? []).map((item) => item.trim()).filter(Boolean);
  const text = asChain(brief.length ? brief.join("\n\n") : (script?.steps ?? []).filter(Boolean).join("\n"));
  if (!text) return "";
  return failed ? interruptedThought(text) : text;
}

function playThought(events: TimedEvent[], at: number, expertId: string, text: string): number {
  if (!text) return at;
  push(events, at, "thought.start", { expert_id: expertId, text });
  return at + textDuration(text);
}

export function buildTimeline(scenario: ScenarioFile, lang: Lang): TimedEvent[] {
  seq = 0;
  const side = scenario[lang];
  const events: TimedEvent[] = [];
  push(events, 0, "phase", { phase: "gate" satisfies Phase });
  push(events, 0, "gate.start", {});

  const experts = SEATS.map((seat) => {
    const script = side.seats[seat.id];
    const standby = seat.id !== "leader" && script?.standby === true;
    return {
      id: seat.id,
      name: seatName(seat.id, lang),
      emoji: seat.emoji,
      status: standby ? "standby" : "pending",
    };
  });
  push(events, GATE_MS, "gate.done", { experts });
  push(events, GATE_MS, "phase", { phase: "parallel" satisfies Phase });

  const awake = SEATS.filter((seat) => seat.id !== "leader" && side.seats[seat.id]?.standby !== true);
  const spans = new Map<string, { answerStart: number; done: number }>();
  let parallelEnd = GATE_MS;
  awake.forEach((seat, index) => {
    const script = side.seats[seat.id];
    let t = GATE_MS + 80 + index * STAGGER_MS;
    push(events, t, "expert.start", { expert_id: seat.id });
    t += 80;
    const failed = Boolean(script?.error);
    t = playThought(events, t, seat.id, thoughtText(script, failed));
    t += 90;
    if (failed) {
      spans.set(seat.id, { answerStart: t, done: t });
      push(events, t, "expert.done", { expert_id: seat.id, error: script?.error });
    } else {
      const answerStart = t;
      t = stream(events, t, "expert.delta", { expert_id: seat.id }, script?.answer ?? "");
      spans.set(seat.id, { answerStart, done: t });
      t += 40;
      push(events, t, "expert.done", { expert_id: seat.id });
    }
    parallelEnd = Math.max(parallelEnd, t);
  });

  const reviews = awake.filter((seat) => {
    const script = side.seats[seat.id];
    return Boolean(script?.review && script.review_target && !script.error);
  });
  const byTarget = new Map<string, typeof reviews>();
  for (const seat of reviews) {
    const target = side.seats[seat.id]?.review_target;
    if (!target) continue;
    const group = byTarget.get(target) ?? [];
    group.push(seat);
    byTarget.set(target, group);
  }
  const cuts = [...byTarget.entries()].flatMap(([target, group]) => {
    const span = spans.get(target);
    const duration = span ? Math.max(0, span.done - span.answerStart) : 0;
    const gap = group.length <= 1 ? 0 : Math.min(360, Math.max(70, Math.floor((duration - 140) / group.length)));
    return group.flatMap((seat, n) => {
      const script = side.seats[seat.id];
      if (!script?.review) return [];
      const start = span ? span.answerStart : parallelEnd;
      let at = start + Math.min(160, Math.floor(duration * 0.22)) + n * gap;
      if (span && at >= span.done) at = start + Math.min(36 + n * 28, Math.max(0, duration - 16));
      return [{ seat, target, review: script.review, at }];
    });
  });
  let reviewEnd = parallelEnd;
  if (cuts.length) {
    const firstAt = Math.min(...cuts.map((cut) => cut.at));
    push(events, firstAt, "phase", { phase: "review" satisfies Phase });
    for (const cut of cuts) {
      let t = cut.at;
      push(events, t, "review.start", { expert_id: cut.seat.id, target_id: cut.target });
      t += 60;
      t = stream(events, t, "review.delta", { expert_id: cut.seat.id, target_id: cut.target }, cut.review);
      t += 40;
      push(events, t, "review.done", { expert_id: cut.seat.id, target_id: cut.target });
      reviewEnd = Math.max(reviewEnd, t);
    }
  }

  const synthAt = Math.max(parallelEnd, reviewEnd) + PHASE_GAP_MS;
  push(events, synthAt, "phase", { phase: "synth" satisfies Phase });
  push(events, synthAt, "synth.start", {});
  push(events, synthAt, "expert.start", { expert_id: "leader" });
  let t = synthAt + 80;
  t = playThought(events, t, "leader", thoughtText(side.chair, false));
  t += 90;
  t = stream(events, t, "synth.delta", {}, side.chair.answer);
  t += 40;
  push(events, t, "expert.done", { expert_id: "leader" });
  push(events, t, "done", {});
  push(events, t, "phase", { phase: "done" satisfies Phase });

  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return events;
}

/** Timestamp of the last event that belongs to `phase`. Seek with `at <= phaseAt(...)`. */
export function phaseAt(events: TimedEvent[], phase: Phase): number {
  const last = events[events.length - 1]?.at ?? 0;
  if (phase === "synth" || phase === "done") return last;
  if (phase === "gate") {
    return events.find((event) => event.event === "gate.done")?.at ?? 0;
  }
  if (phase === "parallel") {
    let at = 0;
    for (const event of events) {
      if (event.event === "expert.done" && event.data.expert_id !== "leader") at = Math.max(at, event.at);
    }
    return at;
  }
  let at = 0;
  for (const event of events) {
    if (event.event === "review.done") at = Math.max(at, event.at);
  }
  if (at) return at;
  let parallel = 0;
  for (const event of events) {
    if (event.event === "expert.done" && event.data.expert_id !== "leader") parallel = Math.max(parallel, event.at);
  }
  return parallel;
}
