import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import {
  createTask,
  deleteTask,
  fetchTaskRuns,
  fetchTasks,
  patchTask,
} from "../lib/api";
import type { TaskItem, TaskRun } from "../lib/types";

export function Tasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [active, setActive] = useState<TaskItem | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("* * * * *");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const data = await fetchTasks();
    setTasks(data.tasks);
    if (active) {
      const next = data.tasks.find((t) => t.id === active.id) ?? data.tasks[0] ?? null;
      setActive(next);
    }
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, []);

  useEffect(() => {
    if (!active) {
      setRuns([]);
      return;
    }
    void fetchTaskRuns(active.id)
      .then((data) => setRuns(data.runs))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, [active?.id]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !prompt.trim()) return;
    const res = await createTask({
      name: name.trim(),
      cron: cron.trim() || "* * * * *",
      prompt: prompt.trim(),
      mode: "auto",
    });
    setName("");
    setPrompt("");
    setTasks((prev) => [res.task, ...prev]);
    setActive(res.task);
  }

  return (
    <AppShell title="任務">
      <main className="page">
        <h1>Tasks</h1>
        <p className="muted">5 字段 cron（分 时 日 月 周）。每分钟：* * * * *</p>
        {error ? <p className="error">{error}</p> : null}
        <form className="card" onSubmit={(e) => void onCreate(e)}>
          <input
            value={name}
            placeholder="任务名称"
            onChange={(e) => setName(e.target.value)}
          />
          <input
            value={cron}
            placeholder="cron"
            onChange={(e) => setCron(e.target.value)}
          />
          <textarea
            rows={3}
            value={prompt}
            placeholder="到点要问模型的内容"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="submit">创建</button>
        </form>
        <div className="modes" style={{ flexWrap: "wrap" }}>
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={active?.id === t.id ? "active" : ""}
              onClick={() => setActive(t)}
            >
              {t.name}
            </button>
          ))}
        </div>
        {active ? (
          <section className="card">
            <h2>{active.name}</h2>
            <p className="muted">
              {active.cron} · {active.enabled ? "启用" : "停用"}
            </p>
            <p className="muted">上次 {active.last_run_at ?? "尚未执行"}</p>
            <p className="muted">下次 {active.next_run_at ?? "—"}</p>
            <pre className="task-prompt">{active.prompt}</pre>
            <button
              type="button"
              onClick={() =>
                void patchTask(active.id, { enabled: !active.enabled }).then((res) => {
                  setActive(res.task);
                  setTasks((prev) => prev.map((t) => (t.id === res.task.id ? res.task : t)));
                })
              }
            >
              {active.enabled ? "停用" : "启用"}
            </button>
            <button
              type="button"
              className="link"
              onClick={() =>
                void deleteTask(active.id).then(() => {
                  setTasks((prev) => prev.filter((t) => t.id !== active.id));
                  setActive(null);
                })
              }
            >
              删除
            </button>
            <button type="button" className="link" onClick={() => void reload()}>
              刷新
            </button>
            <h3>执行历史</h3>
            {runs.length ? (
              <ul className="run-list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <strong>{r.status}</strong> {r.created_at}
                    {r.output ? <pre>{r.output}</pre> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">还没有执行记录。</p>
            )}
          </section>
        ) : (
          <p className="muted">创建一个定时任务。</p>
        )}
      </main>
    </AppShell>
  );
}