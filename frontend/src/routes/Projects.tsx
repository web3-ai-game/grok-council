import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import {
  createChat,
  createProject,
  fetchFiles,
  fetchProjects,
  patchProject,
  uploadFile,
} from "../lib/api";
import type { Project, UploadedFile } from "../lib/types";

export function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState("");

  async function reload() {
    const data = await fetchProjects();
    setProjects(data.projects);
    if (active) {
      const next = data.projects.find((p) => p.id === active.id) ?? data.projects[0] ?? null;
      setActive(next);
    } else if (data.projects[0]) {
      setActive(data.projects[0]);
    }
  }

  useEffect(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, []);

  useEffect(() => {
    if (!active) {
      setInstructions("");
      setFiles([]);
      return;
    }
    setInstructions(active.instructions);
    void fetchFiles(active.id)
      .then((data) => setFiles(data.files))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, [active?.id]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const title = name.trim();
    if (!title) return;
    const res = await createProject(title);
    setName("");
    setProjects((prev) => [res.project, ...prev]);
    setActive(res.project);
  }

  async function onSave() {
    if (!active) return;
    const res = await patchProject(active.id, { instructions });
    setActive(res.project);
    setProjects((prev) => prev.map((p) => (p.id === res.project.id ? res.project : p)));
  }

  async function onNewChat() {
    if (!active) return;
    const chat = await createChat(`${active.name} 会话`, active.id);
    navigate(`/c/${chat.chat.id}`);
  }

  return (
    <AppShell title="專案">
      <main className="page">
        <h1>Projects</h1>
        {error ? <p className="error">{error}</p> : null}
        <form className="card" onSubmit={(e) => void onCreate(e)}>
          <input
            value={name}
            placeholder="新项目名称"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit">创建</button>
        </form>
        <div className="modes" style={{ flexWrap: "wrap" }}>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={active?.id === p.id ? "active" : ""}
              onClick={() => setActive(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {active ? (
          <section className="card">
            <h2>{active.name}</h2>
            <label>
              自定义指令（只作用于本项目会话）
              <textarea
                rows={5}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <button type="button" onClick={() => void onSave()}>
              保存指令
            </button>
            <button type="button" onClick={() => void onNewChat()}>
              在此项目开新会话
            </button>
            <label className="link">
              上传文件
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !active) return;
                  void uploadFile(file, active.id).then((res) =>
                    setFiles((prev) => [res.file, ...prev]),
                  );
                }}
              />
            </label>
            <ul>
              {files.map((f) => (
                <li key={f.id}>
                  <a href={f.url}>{f.filename}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="muted">先创建一个项目。</p>
        )}
      </main>
    </AppShell>
  );
}
