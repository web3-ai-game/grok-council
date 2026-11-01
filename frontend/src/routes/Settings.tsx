import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { AppShell } from "../components/AppShell";
import {
  clearMemories,
  createMemory,
  deleteMemory,
  fetchMemories,
  patchMemory,
  patchSettings,
} from "../lib/api";
import { getPrefs, setPrefs, subscribePrefs, type ThemePref } from "../lib/store";
import type { MemoryItem } from "../lib/types";

export function Settings() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const data = await fetchMemories();
    setMemories(data.memories);
    setEnabled(data.enabled);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, []);

  async function onToggle(next: boolean) {
    setEnabled(next);
    await patchSettings({ memory_enabled: next });
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    const res = await createMemory(content);
    setMemories((prev) => [res.memory, ...prev]);
    setDraft("");
  }

  return (
    <AppShell title="設置">
      <main className="page">
        <h1>设置</h1>
        {error ? <p className="error">{error}</p> : null}
        <label>
          主题
          <select
            value={prefs.theme}
            onChange={(e) => setPrefs({ theme: e.target.value as ThemePref })}
          >
            <option value="system">跟随系统</option>
            <option value="dark">暗色</option>
            <option value="light">亮色</option>
          </select>
        </label>
        <label className="engine-toggle">
          <input
            type="checkbox"
            checked={prefs.enterToSend}
            onChange={(e) => setPrefs({ enterToSend: e.target.checked })}
          />
          Enter 发送 / Shift+Enter 换行
        </label>
        <section className="card">
          <h2>记忆</h2>
          <label className="engine-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => void onToggle(e.target.checked)}
            />
            跨会话记忆（关闭后新会话不再注入）
          </label>
          <form onSubmit={(e) => void onAdd(e)}>
            <input
              value={draft}
              placeholder="手动添加一条记忆"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit">添加</button>
          </form>
          {memories.length ? (
            <ul className="memory-list">
              {memories.map((m) => (
                <li key={m.id}>
                  <span>{m.content}</span>
                  <span className="memory-actions">
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        void patchMemory(m.id, { pinned: !m.pinned }).then((res) =>
                          setMemories((prev) =>
                            prev
                              .map((x) => (x.id === m.id ? res.memory : x))
                              .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
                          ),
                        )
                      }
                    >
                      {m.pinned ? "取消置顶" : "置顶"}
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        void deleteMemory(m.id).then(() =>
                          setMemories((prev) => prev.filter((x) => x.id !== m.id)),
                        )
                      }
                    >
                      删除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">还没有记忆。对话里提到的偏好会自动抽取。</p>
          )}
          {memories.length ? (
            <button
              type="button"
              className="link"
              onClick={() => {
                if (!window.confirm("清空全部记忆？")) return;
                void clearMemories().then(() => setMemories([]));
              }}
            >
              一键清空
            </button>
          ) : null}
        </section>
      </main>
    </AppShell>
  );
}