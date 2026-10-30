import { useState } from "react";
import type { CouncilExpertView, CouncilView } from "../lib/types";
import { Citations } from "./Citations";

const EMOJI: Record<string, string> = {
  analyst: "🔍",
  researcher: "🛰️",
  engineer: "🛠️",
  critic: "🧨",
  strategist: "🧭",
  writer: "✍️",
  quant: "🧮",
  leader: "⚖️",
  e1: "🔍",
  e2: "🛰️",
  e3: "🛠️",
  e4: "🧨",
  e5: "🧭",
  e6: "✍️",
};

function expertEmoji(expert: CouncilExpertView, index: number): string {
  if (expert.emoji) return expert.emoji;
  return EMOJI[expert.id] ?? ["🔍", "🛰️", "🛠️", "🧨", "🧭", "✍️"][index % 6];
}

function lastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[\n。！？!?]/).map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) || trimmed;
}

export function CouncilPanel({
  council,
  live = false,
}: {
  council: CouncilView;
  live?: boolean;
}) {
  const [peekId, setPeekId] = useState<string | null>(null);
  if (council.engine === "native") {
    return (
      <aside className="council native">
        <p className="muted">{council.note || "原生模式下子智能体过程不可见"}</p>
      </aside>
    );
  }

  const experts = council.experts;
  const n = experts.length;
  const allSettled =
    n > 0 && experts.every((e) => e.status === "done" || e.status === "error");
  const collapsed = Boolean(council.synthesizing) || (allSettled && !live);
  const running = experts.filter((e) => e.status === "running");
  const tickerSrc =
    [...running].reverse().find((e) => e.reasoning) ?? running[0];
  const ticker = tickerSrc ? lastSentence(tickerSrc.reasoning) : "";
  const peek = peekId ? experts.find((e) => e.id === peekId) : undefined;
  const summary = council.synthesizing && live
    ? `${n || 6} 位已完成 · 判官汇总中`
    : `${n || 6} 位已完成`;

  return (
    <aside className="council">
      {council.gating ? (
        <div className="think-sweep">
          <span className="think-sweep-status">
            <span className="think-dot pulse" />
            思考中 · 正在组建专家团
          </span>
        </div>
      ) : collapsed && !peekId ? (
        <div className="think-sweep">
          <span className="think-sweep-status">
            <span className="think-dot" />
            {summary}
          </span>
        </div>
      ) : (
        <div className="think-sweep">
          {experts.map((expert, index) => (
            <button
              key={expert.id}
              type="button"
              className={`think-pill ${expert.status}${peekId === expert.id ? " peeking" : ""}`}
              onClick={() => setPeekId(peekId === expert.id ? null : expert.id)}
            >
              <span className="pill-emoji">{expertEmoji(expert, index)}</span>
              <span className="pill-name">{expert.name}</span>
              <span className={`pill-dot ${expert.status}`} />
            </button>
          ))}
          {ticker && live ? (
            <span className="think-ticker" title={ticker}>
              <span className="think-ticker-inner">{ticker}</span>
            </span>
          ) : null}
        </div>
      )}
      {peek ? (
        <div className="think-peek">
          <header>
            <strong>{peek.name}</strong>
            <span className="muted">{statusLabel(peek.status)}</span>
            {peek.tools.map((tool) => (
              <span key={tool} className="tool-badge">
                {tool}
              </span>
            ))}
          </header>
          <p>{peek.error || peek.content || peek.reasoning || "尚无输出"}</p>
        </div>
      ) : null}
      <Citations items={council.citations} />
    </aside>
  );
}

function statusLabel(status: CouncilExpertView["status"]): string {
  if (status === "running") return "思考中";
  if (status === "done") return "已處理";
  if (status === "error") return "失敗";
  return "等待";
}
