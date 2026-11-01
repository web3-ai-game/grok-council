const WINDOW = 500_000;

export function ContextMeter({ chars }: { chars: number }) {
  const est = Math.ceil(chars / 4);
  const pct = Math.min(100, (est / WINDOW) * 100);
  return (
    <p className="context-meter">
      上下文 {est.toLocaleString()} / {WINDOW.toLocaleString()}
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </p>
  );
}
