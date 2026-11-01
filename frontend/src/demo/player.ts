import { SEATS, seatName } from "./seats";
import type { Lang } from "./seats";
import type { Phase, ScenarioFile, SeatScript, TimedEvent } from "./types";

export const TICK_MS = 56;
export const STAGGER_MS = 320;
export const GATE_MS = 1200;
export const PHASE_GAP_MS = 460;
export const STEP_MS = 480;

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

function scriptSteps(script: SeatScript | undefined): string[] {
  return (script?.steps ?? []).filter((step) => step.length > 0).slice(0, 3);
}

function playSteps(events: TimedEvent[], at: number, expertId: string, steps: string[], limit = steps.length): number {
  let t = at;
  for (let index = 0; index < limit; index += 1) {
    push(events, t, "expert.step", { expert_id: expertId, index, label: steps[index] ?? "" });
    t += STEP_MS;
  }
  return t;
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
  let parallelEnd = GATE_MS;
  awake.forEach((seat, index) => {
    const script = side.seats[seat.id];
    let t = GATE_MS + 80 + index * STAGGER_MS;
    push(events, t, "expert.start", { expert_id: seat.id });
    t += 140;
    const steps = scriptSteps(script);
    const failed = Boolean(script?.error);
    t = playSteps(events, t, seat.id, steps, failed ? Math.min(2, steps.length) : steps.length);
    t += 120;
    if (failed) {
      push(events, t, "expert.done", { expert_id: seat.id, error: script?.error });
    } else {
      t = stream(events, t, "expert.delta", { expert_id: seat.id }, script?.answer ?? "");
      t += 40;
      push(events, t, "expert.done", { expert_id: seat.id });
    }
    parallelEnd = Math.max(parallelEnd, t);
  });

  const reviews = awake.filter((seat) => {
    const script = side.seats[seat.id];
    return Boolean(script?.review && script.review_target && !script.error);
  });
  let cursor = parallelEnd + PHASE_GAP_MS;
  push(events, cursor, "phase", { phase: "review" satisfies Phase });
  for (let i = 0; i < reviews.length; i += 2) {
    const pair = reviews.slice(i, i + 2);
    let pairEnd = cursor;
    for (const seat of pair) {
      const script = side.seats[seat.id];
      const target = script?.review_target;
      if (!script?.review || !target) continue;
      let t = cursor;
      push(events, t, "review.start", { expert_id: seat.id, target_id: target });
      t += 80;
      t = stream(events, t, "review.delta", { expert_id: seat.id, target_id: target }, script.review);
      t += 40;
      push(events, t, "review.done", { expert_id: seat.id, target_id: target });
      pairEnd = Math.max(pairEnd, t);
    }
    cursor = pairEnd + 220;
  }

  const synthAt = cursor + PHASE_GAP_MS;
  push(events, synthAt, "phase", { phase: "synth" satisfies Phase });
  push(events, synthAt, "synth.start", {});
  push(events, synthAt, "expert.start", { expert_id: "leader" });
  let t = synthAt + 160;
  t = playSteps(events, t, "leader", (side.chair.steps ?? []).slice(0, 3));
  t += 160;
  t = stream(events, t, "synth.delta", {}, side.chair.answer);
  t += 40;
  push(events, t, "expert.done", { expert_id: "leader" });
  push(events, t, "done", {});
  push(events, t, "phase", { phase: "done" satisfies Phase });

  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return events;
}
