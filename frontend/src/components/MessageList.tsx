import { lazy, Suspense, useState } from "react";
import { speakText } from "../lib/speech";
import type { ChatMessage, CouncilView } from "../lib/types";
import { CouncilPanel } from "./CouncilPanel";
import { ThinkingTrace } from "./ThinkingTrace";

const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export function MessageList({
  messages,
  onRegenerate,
  onEditResend,
  streaming,
  councils,
}: {
  messages: ChatMessage[];
  onRegenerate: (id: string) => void;
  onEditResend: (id: string, content: string) => void;
  streaming: boolean;
  councils: Record<string, CouncilView>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const lastUserId = [...messages].reverse().find((m) => m.role === "user")?.id;

  return (
    <div className="messages">
      {messages.map((msg, index) => {
        const lastAssistant =
          msg.role === "assistant" && index === messages.length - 1;
        const canEdit = msg.role === "user" && msg.id === lastUserId && !streaming;
        const council = councils[msg.id];
        return (
          <article key={msg.id} className={`msg ${msg.role}`}>
            <header>{msg.role === "user" ? "你" : "Grok"}</header>
            {msg.role === "assistant" && council ? (
              <CouncilPanel council={council} live={Boolean(streaming && lastAssistant)} />
            ) : null}
            {msg.role === "assistant" && msg.reasoning_summary ? (
              <ThinkingTrace
                text={msg.reasoning_summary}
                active={Boolean(streaming && lastAssistant)}
              />
            ) : null}
            {editingId === msg.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  onEditResend(msg.id, text);
                  setEditingId(null);
                }}
              >
                <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button type="submit">重发</button>
                <button type="button" className="link" onClick={() => setEditingId(null)}>
                  取消
                </button>
              </form>
            ) : msg.role === "assistant" ? (
              <Suspense fallback={<pre>{msg.content || "…"}</pre>}>
                <Markdown text={msg.content || (streaming && lastAssistant ? "…" : "")} />
              </Suspense>
            ) : (
              <pre>{msg.content}</pre>
            )}
            {msg.role === "assistant" && msg.content && !(streaming && lastAssistant) ? (
              <button type="button" className="link" onClick={() => speakText(msg.content)}>
                朗读
              </button>
            ) : null}
            {lastAssistant && !streaming && msg.content ? (
              <button type="button" className="link" onClick={() => onRegenerate(msg.id)}>
                重新生成
              </button>
            ) : null}
            {canEdit && editingId !== msg.id ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEditingId(msg.id);
                  setDraft(msg.content);
                }}
              >
                编辑重发
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
