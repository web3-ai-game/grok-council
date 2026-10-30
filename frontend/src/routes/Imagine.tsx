import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { fetchGenerations, fetchModels, generateImage, generateVideo, uploadFile } from "../lib/api";
import type { Generation, ImagineModel } from "../lib/types";

export function Imagine() {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<ImagineModel[]>([]);
  const [model, setModel] = useState("grok-imagine-image");
  const [duration, setDuration] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Generation[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);

  useEffect(() => {
    void fetchModels().then((data) => {
      const imagine = data.models.filter((m): m is ImagineModel => m.kind === "imagine");
      setModels(imagine);
    });
    void fetchGenerations()
      .then((data) => setItems(data.generations))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "失败"));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const res =
        kind === "image"
          ? await generateImage({
              prompt: text,
              model,
              file_id: fileId ?? undefined,
            })
          : await generateVideo({ prompt: text, model, duration });
      setItems((prev) => [res.generation, ...prev]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  const imageModels = models.filter((m) => m.unit === "image");
  const videoModels = models.filter((m) => m.unit === "second");
  const options = kind === "image" ? imageModels : videoModels;

  return (
    <AppShell title="Imagine">
      <main className="page">
        <h1>Imagine</h1>
        <form className="card" onSubmit={(e) => void onSubmit(e)}>
          <div className="modes">
            <button type="button" className={kind === "image" ? "active" : ""} onClick={() => {
              setKind("image");
              setModel("grok-imagine-image");
              setFileId(null);
            }}>
              图像
            </button>
            <button type="button" className={kind === "video" ? "active" : ""} onClick={() => {
              setKind("video");
              setModel("grok-imagine-video");
              setFileId(null);
            }}>
              视频
            </button>
          </div>
          <label>
            模型
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
          {kind === "video" ? (
            <label>
              时长（秒）
              <input
                type="number"
                min={1}
                max={15}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className="link">
              图生图（可选）
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void uploadFile(file).then((res) => setFileId(res.file.id));
                }}
              />
            </label>
          )}
          {fileId ? <p className="muted">已选参考图</p> : null}
          <textarea
            rows={3}
            value={prompt}
            placeholder={kind === "image" ? "描述要生成的图像…" : "描述要生成的视频…"}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? "生成中…" : "生成"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        <section className="gallery">
          {items.map((g) => (
            <figure key={g.id} className="gallery-item">
              {g.kind === "video" ? (
                <video src={g.url} controls playsInline />
              ) : (
                <img src={g.url} alt={g.prompt} />
              )}
              <figcaption>
                <span>{g.prompt}</span>
                <span className="muted">
                  {g.model} · ${g.cost_usd.toFixed(4)}
                </span>
                <a href={g.url} download>
                  下载
                </a>
              </figcaption>
            </figure>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
