import { useState } from "react";

export function ThinkingTrace({
  text,
  active = false,
}: {
  text: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <section className="think">
      <button type="button" className="think-toggle" onClick={() => setOpen(!open)}>
        <span className={`think-dot${active ? " pulse" : ""}`} />
        <span>{active ? "思考中" : "已處理"}</span>
      </button>
      {open ? <pre className="think-body">{text}</pre> : null}
    </section>
  );
}
