import type { Dispatch, SetStateAction } from "react";
import type { CouncilExpertView, CouncilView, HeavyEngine } from "./types";

function patchExpert(
  expertId: string,
  updater: (expert: CouncilExpertView) => CouncilExpertView,
  getAssistantId: () => string,
  setCouncils: Dispatch<SetStateAction<Record<string, CouncilView>>>,
) {
  const messageId = getAssistantId();
  if (!messageId) return;
  setCouncils((prev) => {
    const cur = prev[messageId];
    if (!cur) return prev;
    return {
      ...prev,
      [messageId]: {
        ...cur,
        experts: cur.experts.map((ex) => (ex.id === expertId ? updater(ex) : ex)),
      },
    };
  });
}

export function applyCouncilEvent(
  event: string,
  payload: Record<string, unknown>,
  getAssistantId: () => string,
  setCouncils: Dispatch<SetStateAction<Record<string, CouncilView>>>,
  engine: HeavyEngine,
) {
  const patch = (expertId: string, updater: (expert: CouncilExpertView) => CouncilExpertView) =>
    patchExpert(expertId, updater, getAssistantId, setCouncils);

  if (event === "gate.start") {
    const messageId = getAssistantId();
    if (!messageId) return;
    setCouncils((prev) => ({
      ...prev,
      [messageId]: {
        message_id: messageId,
        engine: "council",
        gating: true,
        experts: [],
        citations: [],
      },
    }));
  }
  if (event === "gate.done") {
    const messageId = getAssistantId();
    const rows = Array.isArray(payload.experts) ? payload.experts : [];
    if (!messageId) return;
    setCouncils((prev) => ({
      ...prev,
      [messageId]: {
        message_id: messageId,
        engine: "council",
        gating: false,
        experts: rows
          .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
          .map((row) => ({
            id: String(row.id),
            name: String(row.name || row.id),
            content: "",
            reasoning: "",
            review: "",
            status: row.status === "standby" ? ("standby" as const) : ("pending" as const),
            tools: Array.isArray(row.tools) ? row.tools.map(String) : [],
            emoji: typeof row.emoji === "string" ? row.emoji : undefined,
          })),
        citations: prev[messageId]?.citations ?? [],
      },
    }));
  }
  if (event === "synth.start") {
    const messageId = getAssistantId();
    if (!messageId) return;
    if (engine === "native") {
      setCouncils((prev) => ({
        ...prev,
        [messageId]: {
          message_id: messageId,
          engine: "native",
          gating: false,
          note: String(payload.note ?? "原生模式下子智能体过程不可见"),
          experts: [],
          citations: [],
        },
      }));
    } else {
      setCouncils((prev) => {
        const cur = prev[messageId];
        if (!cur) return prev;
        return { ...prev, [messageId]: { ...cur, synthesizing: true } };
      });
      patch("leader", (ex) => ({ ...ex, status: "running" }));
    }
  }
  if (event === "synth.reasoning" && typeof payload.delta === "string") {
    const delta = payload.delta;
    patch("leader", (ex) => ({ ...ex, reasoning: ex.reasoning + delta, status: "running" }));
  }
  if (event === "synth.delta" && typeof payload.delta === "string") {
    const delta = payload.delta;
    patch("leader", (ex) => ({ ...ex, content: ex.content + delta, status: "running" }));
  }
  if (event === "expert.start" && typeof payload.expert_id === "string") {
    patch(payload.expert_id, (ex) => ({ ...ex, status: "running" }));
  }
  if (event === "expert.delta" && typeof payload.expert_id === "string" && typeof payload.delta === "string") {
    const delta = payload.delta;
    patch(payload.expert_id, (ex) => ({ ...ex, content: ex.content + delta }));
  }
  if (
    event === "expert.reasoning" &&
    typeof payload.expert_id === "string" &&
    typeof payload.delta === "string"
  ) {
    const delta = payload.delta;
    patch(payload.expert_id, (ex) => ({ ...ex, reasoning: ex.reasoning + delta }));
  }
  if (event === "expert.done" && typeof payload.expert_id === "string") {
    const err = typeof payload.error === "string" ? payload.error : undefined;
    patch(payload.expert_id, (ex) => ({
      ...ex,
      status: err ? "error" : "done",
      error: err,
      critiquing: err ? false : ex.critiquing,
    }));
  }
  if (event === "review.start" && typeof payload.expert_id === "string") {
    const target = typeof payload.target_id === "string" ? payload.target_id : undefined;
    patch(payload.expert_id, (ex) => ({
      ...ex,
      critiquing: true,
      reviewTarget: target,
      review: "",
    }));
    if (target) {
      const attacker = payload.expert_id;
      patch(target, (ex) => {
        const challengers = [...(ex.challengers ?? []).filter((id) => id !== attacker), attacker];
        return { ...ex, challengedBy: attacker, challengers };
      });
    }
  }
  if (
    event === "review.delta" &&
    typeof payload.expert_id === "string" &&
    typeof payload.delta === "string"
  ) {
    const delta = payload.delta;
    patch(payload.expert_id, (ex) => ({ ...ex, review: (ex.review ?? "") + delta, critiquing: true }));
  }
  if (event === "review.done" && typeof payload.expert_id === "string") {
    const attacker = payload.expert_id;
    const target = typeof payload.target_id === "string" ? payload.target_id : undefined;
    patch(attacker, (ex) => ({ ...ex, critiquing: false }));
    if (target) {
      patch(target, (ex) => {
        const challengers = (ex.challengers ?? []).filter((id) => id !== attacker);
        return {
          ...ex,
          challengers,
          challengedBy: challengers[challengers.length - 1],
        };
      });
    }
  }
  if (event === "tool.call" && typeof payload.expert_id === "string" && typeof payload.tool === "string") {
    const tool = payload.tool;
    patch(payload.expert_id, (ex) => ({
      ...ex,
      tools: ex.tools.includes(tool) ? ex.tools : [...ex.tools, tool],
    }));
  }
  if (event === "citations") {
    const messageId = getAssistantId();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!messageId) return;
    setCouncils((prev) => {
      const cur = prev[messageId];
      if (!cur) return prev;
      const extra = items
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        .filter((row) => typeof row.url === "string")
        .map((row) => ({
          url: String(row.url),
          title: String(row.title || row.url),
          source_type: typeof row.source_type === "string" ? row.source_type : undefined,
        }));
      return {
        ...prev,
        [messageId]: { ...cur, citations: [...cur.citations, ...extra] },
      };
    });
  }
  if (event === "done") {
    const messageId = getAssistantId();
    if (!messageId) return;
    setCouncils((prev) => {
      const cur = prev[messageId];
      if (!cur) return prev;
      return { ...prev, [messageId]: { ...cur, synthesizing: false } };
    });
  }
}
