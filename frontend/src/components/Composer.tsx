import { FormEvent, useMemo, useRef, useState } from "react";
import { ModeSwitcher } from "./ModeSwitcher";
import { ToolChips } from "./ToolChips";
import { ModelPicker } from "./ModelPicker";
import { EffortDial } from "./EffortDial";
import { uploadFile } from "../lib/api";
import { PROMPT_PRESETS } from "../lib/prompts";
import { getPrefs } from "../lib/store";
import type { ChatMode, UploadedFile } from "../lib/types";

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

function speechCtor(): SpeechCtor | undefined {
  const w = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function Composer({
  mode,
  onMode,
  model,
  onModel,
  effort,
  onEffort,
  streaming,
  tools,
  onTools,
  onSend,
  onStop,
  text,
  onText,
}: {
  mode: ChatMode;
  onMode: (mode: ChatMode) => void;
  model: string;
  onModel: (id: string) => void;
  effort: string | null;
  onEffort: (effort: string | null) => void;
  streaming: boolean;
  tools: string[];
  onTools: (tools: string[]) => void;
  onSend: (text: string, attachments: string[]) => void;
  onStop: () => void;
  text: string;
  onText: (text: string) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ abort: () => void } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const slash = text.startsWith("//");
  const query = slash ? text.slice(2).trim().toLowerCase() : "";
  const matches = useMemo(
    () =>
      slash
        ? PROMPT_PRESETS.filter(
            (p) => p.title.includes(query) || p.id.includes(query) || !query,
          )
        : [],
    [slash, query],
  );
  const canSpeech = Boolean(typeof window !== "undefined" && speechCtor());
  const canSend = (text.trim().length > 0 || files.length > 0) && !streaming && !uploading;

  function resize() {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = text.trim();
    if ((!value && files.length === 0) || streaming || uploading) return;
    onSend(value, files.map((f) => f.id));
    onText("");
    setFiles([]);
    window.setTimeout(resize, 0);
  }

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of Array.from(list)) {
        const res = await uploadFile(file);
        uploaded.push(res.file);
      }
      setFiles((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.abort();
      recRef.current = null;
      setListening(false);
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "zh-TW";
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const chunk = ev.results[0]?.[0]?.transcript ?? "";
      const cur = textRef.current;
      if (chunk) onText(cur ? `${cur} ${chunk}` : chunk);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <form className="composer" onSubmit={submit}>
      {matches.length ? (
        <ul className="slash-list">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="link" onClick={() => onText(p.body)}>
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="attach-list">
          {files.map((f) => (
            <li key={f.id}>
              {f.filename}
              <button
                type="button"
                className="link"
                onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {uploading ? <span className="muted">上傳中…</span> : null}
      <div className="composer-box">
        <textarea
          id="composer-input"
          ref={areaRef}
          rows={1}
          value={text}
          placeholder="輸入訊息…"
          onChange={(e) => {
            onText(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            const enterSend = getPrefs().enterToSend;
            if (e.key === "Enter" && !e.shiftKey && enterSend) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <div className="composer-tools">
            <label className="icon-btn attach-btn" title="附件">
              <span className="sr-only">附件</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                <path d="M8 12.5v5.2a4 4 0 0 0 8 0V8.2a3 3 0 0 0-6 0v8.6a2 2 0 1 0 4 0V9" />
              </svg>
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.py,.js,.json"
                onChange={(e) => {
                  void onPick(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className={`icon-btn${listening ? " active" : ""}`}
              title={canSpeech ? (listening ? "停止語音" : "語音輸入") : "此瀏覽器不支援語音輸入"}
              disabled={!canSpeech}
              onClick={toggleMic}
              aria-label="語音輸入"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                <rect x="9" y="4" width="6" height="10" rx="3" />
                <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3" />
              </svg>
            </button>
            <ModeSwitcher value={mode} onChange={onMode} />
            <ModelPicker value={model} onChange={onModel} />
            <EffortDial value={effort} onChange={onEffort} />
            <details className="composer-pop">
              <summary className="icon-btn" title="工具" aria-label="工具">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 5v2M12 17v2M5 12h2M17 12h2" />
                </svg>
              </summary>
              <div className="composer-pop-panel">
                <ToolChips value={tools} onChange={onTools} />
              </div>
            </details>
          </div>
          {streaming ? (
            <button id="stop-btn" className="send-btn" type="button" onClick={onStop} aria-label="停止" title="停止">
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button id="send-btn" className="send-btn" type="submit" disabled={!canSend} aria-label="發送" title="發送">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M12 18V7M7.5 11.5 12 7l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
