import { useEffect, useState } from "react";
import { fetchModels } from "../lib/api";
import type { Model } from "../lib/types";

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => {
    fetchModels()
      .then((data) => setModels(data.models.filter((m) => m.kind === "text")))
      .catch(() => setModels([]));
  }, []);
  return (
    <label className="composer-mini picker">
      <span className="sr-only">模型</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {models.length === 0 ? <option value={value}>{value}</option> : null}
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available}>
            {m.id}
          </option>
        ))}
      </select>
    </label>
  );
}
