import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Composer } from "../components/Composer";
import { ContextMeter } from "../components/ContextMeter";
import { EmptyState } from "../components/EmptyState";
import { MessageList } from "../components/MessageList";
import { Sidebar } from "../components/Sidebar";
import { UsageMeter } from "../components/UsageMeter";
import {
  createChat,
  fetchChat,
  fetchChats,
  fetchMe,
  logout,
  postMessage,
  regenerateMessage,
  stopChat,
} from "../lib/api";
import { consumeSse } from "../lib/sse";
import { getPrefs, setPrefs, subscribePrefs } from "../lib/store";
import type {
  Chat as ChatRow,
  ChatMessage,
  ChatMode,
  CouncilExpertView,
  CouncilView,
  HeavyEngine,
  UsageEvent,
  User,
} from "../lib/types";

type UsageSummary = { cost_usd: number };

export function Chat() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<UsageEvent | null>(null);
  const [todayCost, setTodayCost] = useState(0);
  const [engine, setEngine] = useState<HeavyEngine>("council");
  const [councils, setCouncils] = useState<Record<string, CouncilView>>({});
  const [model, setModel] = useState("grok-4.6");
  const [effort, setEffort] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const searchRef = useRef("");
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);

  async function reloadChats(q?: string) {
    const data = await fetchChats(q ?? searchRef.current);
    setChats(data.chats);
  }

  async function reloadUsage() {
    const res = await fetch("/api/usage?range=today", { credentials: "include" });
    if (!res.ok) return;
    const body = (await res.json()) as UsageSummary;
    setTodayCost(Number(body.cost_usd) || 0);
  }

  useEffect(() => {
    fetchMe()
      .then((data) => setUser(data.user))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
    reloadChats().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "失败"),
    );
    void reloadUsage();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void createChat("新会话").then((data) => {
          navigate(`/c/${data.chat.id}`);
          window.setTimeout(() => document.getElementById("composer-input")?.focus(), 0);
        });
      }
      if (meta && e.key === "\\") {
        e.preventDefault();
        setPrefs({ sidebarCollapsed: !getPrefs().sidebarCollapsed });
      }
      if (e.key === "Escape") {
        abortRef.current?.abort();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      document.documentElement.style.setProperty("--vv-bottom", `${window.innerHeight - vv.height - vv.offsetTop}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      setTitle("");
      return;
    }
    fetchChat(chatId)
      .then((data) => {
        setMessages(data.messages);
        setTitle(data.chat.title);
        setMode((data.chat.mode as ChatMode) || "auto");
        setModel(data.chat.model || "grok-4.6");
        setCouncils(replayCouncils(data.councils));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, [chatId]);

  async function onNew() {
    const data = await createChat("新会话");
    await reloadChats();
    navigate(`/c/${data.chat.id}`);
    window.setTimeout(() => document.getElementById("composer-input")?.focus(), 0);
  }

  async function onLogout() {
    abortRef.current?.abort();
    await logout();
    navigate("/login", { replace: true });
  }

  async function runStream(id: string, response: Response) {
    setStreaming(true);
    setError(null);
    setLastUsage(null);
    let assistantId = "";
    try {
      await consumeSse(response, (event, data) => {
        const payload = data as Record<string, unknown>;
        if (event === "message.start" && typeof payload.message_id === "string") {
          assistantId = payload.message_id;
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              chat_id: id,
              role: "assistant",
              content: "",
              reasoning_summary: "",
              model: null,
              mode,
              parent_id: null,
              created_at: new Date().toISOString(),
            },
          ]);
        }
        if (
          (event === "message.delta" || event === "synth.delta") &&
          typeof payload.delta === "string"
        ) {
          const delta = payload.delta;
          const replace = typeof payload.replace === "string" ? payload.replace : null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: replace ?? m.content + delta }
                : m,
            ),
          );
        }
        if (
          (event === "message.reasoning" || event === "synth.reasoning") &&
          typeof payload.delta === "string"
        ) {
          const delta = payload.delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, reasoning_summary: (m.reasoning_summary ?? "") + delta }
                : m,
            ),
          );
        }
        applyCouncilEvent(event, payload, () => assistantId, setCouncils, engine);
        if (event === "usage") {
          setLastUsage((prev) => ({
            prompt: (prev?.prompt ?? 0) + (Number(payload.prompt) || 0),
            completion: (prev?.completion ?? 0) + (Number(payload.completion) || 0),
            reasoning: (prev?.reasoning ?? 0) + (Number(payload.reasoning) || 0),
            cost_usd: (prev?.cost_usd ?? 0) + (Number(payload.cost_usd) || 0),
          }));
        }
        if (event === "error") {
          const code = String(payload.code ?? "");
          const retryAfter = Number(payload.retry_after);
          if (code === "upstream_rate_limit") {
            const secs = Number.isFinite(retryAfter) ? retryAfter : 0;
            setError(secs ? `限流，${secs} 秒后重试` : "限流，请稍候");
          } else if (code !== "stopped") {
            setError(String(payload.message ?? "生成失败"));
          }
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "生成失败");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reloadChats();
      await reloadUsage();
    }
  }

  async function onSend(text: string, attachments: string[] = []) {
    let id = chatId;
    if (!id) {
      const created = await createChat(text.slice(0, 40));
      id = created.chat.id;
      await reloadChats();
      navigate(`/c/${id}`);
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        chat_id: id,
        role: "user",
        content: text,
        reasoning_summary: null,
        model: null,
        mode,
        parent_id: null,
        created_at: new Date().toISOString(),
      },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await postMessage(
      id,
      {
        content: text,
        mode,
        model,
        effort: effort ?? undefined,
        tools,
        heavy_engine: mode === "heavy" ? engine : undefined,
        attachments,
      },
      controller.signal,
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string; retry_after?: number };
      } | null;
      if (body?.error?.code === "upstream_rate_limit") {
        const secs = body.error.retry_after ?? 0;
        setError(secs ? `限流，${secs} 秒后重试` : "限流，请稍候");
      } else {
        setError(body?.error?.message ?? "发送失败");
      }
      setStreaming(false);
      return;
    }
    await runStream(id, response);
  }

  async function onStop() {
    abortRef.current?.abort();
    if (chatId) await stopChat(chatId);
  }

  async function onEditResend(messageId: string, text: string) {
    if (!chatId) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      const src = idx >= 0 ? prev[idx] : undefined;
      if (!src) return prev;
      return [...prev.slice(0, idx), { ...src, content: text }];
    });
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await postMessage(
      chatId,
      { content: text, mode, edit_of: messageId },
      controller.signal,
    );
    if (!response.ok) {
      setError("编辑重发失败");
      return;
    }
    await runStream(chatId, response);
  }

  async function onRegenerate(messageId: string) {
    if (!chatId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const response = await regenerateMessage(chatId, messageId, controller.signal);
    if (!response.ok) {
      setError("重新生成失败");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    await runStream(chatId, response);
  }

  return (
    <AppShell
      title={chatId ? title || "會話" : "OECE-X"}
      collapsed={prefs.sidebarCollapsed}
      extraTop={
        <>
          <button type="button" className="icon-btn mobile-new" onClick={() => void onNew()} aria-label="新對話">
            +
          </button>
          <button
            type="button"
            className="icon-btn desktop-export"
            onClick={() => exportChat(title, messages)}
            disabled={!messages.length}
            aria-label="導出"
            title="導出"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
              <path d="M12 4v10M8 10l4 4 4-4M6 18h12" />
            </svg>
          </button>
        </>
      }
      sidebar={
        <Sidebar
          user={user}
          chats={chats}
          chatId={chatId}
          collapsed={false}
          onNew={() => void onNew()}
          onLogout={() => void onLogout()}
          onReload={() => reloadChats()}
          onSearch={(q) => {
            searchRef.current = q;
            void reloadChats(q);
          }}
        />
      }
    >
      {error ? <p className="error">{error}</p> : null}
      {messages.length === 0 ? (
        <EmptyState onPick={setDraft} />
      ) : (
        <MessageList
          messages={messages}
          onRegenerate={(id) => void onRegenerate(id)}
          onEditResend={(id, text) => void onEditResend(id, text)}
          streaming={streaming}
          councils={councils}
        />
      )}
      {mode === "heavy" ? (
        <label className="engine-toggle">
          <input
            type="checkbox"
            checked={engine === "native"}
            onChange={(e) => setEngine(e.target.checked ? "native" : "council")}
          />
          原生 Heavy（子智能體過程不可見）
        </label>
      ) : null}
      <ContextMeter chars={messages.reduce((n, m) => n + m.content.length, 0)} />
      <UsageMeter last={lastUsage} today={todayCost} />
      <Composer
        mode={mode}
        onMode={setMode}
        model={model}
        onModel={setModel}
        effort={effort}
        onEffort={setEffort}
        streaming={streaming}
        tools={tools}
        onTools={setTools}
        text={draft}
        onText={setDraft}
        onSend={(text, attachments) => void onSend(text, attachments)}
        onStop={() => void onStop()}
      />
    </AppShell>
  );
}

function exportChat(title: string, messages: ChatMessage[]) {
  const base = (title || "chat").replace(/[^\w\u4e00-\u9fff-]+/g, "_");
  const fmt = window.prompt("导出格式：md / txt / json", "md");
  if (!fmt) return;
  let body = "";
  let mime = "text/plain";
  if (fmt === "json") {
    body = JSON.stringify({ title, messages }, null, 2);
    mime = "application/json";
  } else if (fmt === "txt") {
    body = messages.map((m) => `${m.role}:\n${m.content}\n`).join("\n");
  } else {
    body = `# ${title}\n\n` + messages.map((m) => `**${m.role}**\n\n${m.content}\n`).join("\n");
    mime = "text/markdown";
  }
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.${fmt === "json" ? "json" : fmt === "txt" ? "txt" : "md"}`;
  a.click();
  URL.revokeObjectURL(url);
}

function gateExperts(gate: unknown): { id: string; name: string; emoji?: string; tools: string[] }[] {
  const rows = Array.isArray(gate)
    ? gate
    : gate && typeof gate === "object" && Array.isArray((gate as { experts?: unknown }).experts)
      ? (gate as { experts: unknown[] }).experts
      : [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? row.expert_id ?? ""),
      name: String(row.name || row.id || ""),
      emoji: typeof row.emoji === "string" ? row.emoji : undefined,
      tools: Array.isArray(row.tools) ? row.tools.map(String) : [],
    }))
    .filter((row) => row.id);
}

function replayCouncils(raw: unknown): Record<string, CouncilView> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, CouncilView> = {};
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as {
      message_id?: string;
      engine?: string;
      gate?: unknown;
      experts?: {
        expert_id?: string;
        content?: string;
        reasoning?: string;
        error?: string | null;
      }[];
      citations?: { url?: string; title?: string; source_type?: string }[];
    };
    const messageId = item.message_id;
    if (!messageId) continue;
    const gated = gateExperts(item.gate);
    const names = new Map(gated.map((g) => [g.id, g.name]));
    const emojis = new Map(gated.map((g) => [g.id, g.emoji]));
    const tools = new Map(gated.map((g) => [g.id, g.tools]));
    out[messageId] = {
      message_id: messageId,
      engine: item.engine === "native" ? "native" : "council",
      gating: false,
      synthesizing: false,
      note: item.engine === "native" ? "原生模式下子智能体过程不可见" : undefined,
      experts: (item.experts ?? []).map((ex) => ({
        id: String(ex.expert_id),
        name: names.get(String(ex.expert_id)) || String(ex.expert_id),
        content: ex.content ?? "",
        reasoning: ex.reasoning ?? "",
        status: ex.error ? "error" : "done",
        error: ex.error ?? undefined,
        tools: tools.get(String(ex.expert_id)) ?? [],
        emoji: emojis.get(String(ex.expert_id)),
      })),
      citations: (item.citations ?? [])
        .filter((c) => c.url)
        .map((c) => ({
          url: String(c.url),
          title: String(c.title || c.url),
          source_type: c.source_type,
        })),
    };
  }
  return out;
}

function applyCouncilEvent(
  event: string,
  payload: Record<string, unknown>,
  getAssistantId: () => string,
  setCouncils: Dispatch<SetStateAction<Record<string, CouncilView>>>,
  engine: HeavyEngine,
) {
  const patchExpert = (
    expertId: string,
    updater: (expert: CouncilExpertView) => CouncilExpertView,
  ) => {
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
  };

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
            status: "pending" as const,
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
    }
  }
  if (event === "expert.start" && typeof payload.expert_id === "string") {
    patchExpert(payload.expert_id, (ex) => ({ ...ex, status: "running" }));
  }
  if (event === "expert.delta" && typeof payload.expert_id === "string" && typeof payload.delta === "string") {
    const delta = payload.delta;
    patchExpert(payload.expert_id, (ex) => ({ ...ex, content: ex.content + delta }));
  }
  if (
    event === "expert.reasoning" &&
    typeof payload.expert_id === "string" &&
    typeof payload.delta === "string"
  ) {
    const delta = payload.delta;
    patchExpert(payload.expert_id, (ex) => ({ ...ex, reasoning: ex.reasoning + delta }));
  }
  if (event === "expert.done" && typeof payload.expert_id === "string") {
    const err = typeof payload.error === "string" ? payload.error : undefined;
    patchExpert(payload.expert_id, (ex) => ({
      ...ex,
      status: err ? "error" : "done",
      error: err,
    }));
  }
  if (event === "tool.call" && typeof payload.expert_id === "string" && typeof payload.tool === "string") {
    const tool = payload.tool;
    patchExpert(payload.expert_id, (ex) => ({
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
}
