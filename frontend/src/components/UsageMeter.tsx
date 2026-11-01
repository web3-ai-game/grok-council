import type { UsageEvent } from "../lib/types";

export function UsageMeter({
  last,
  today,
}: {
  last: UsageEvent | null;
  today: number;
}) {
  return (
    <footer className="usage">
      {last ? (
        <span>
          本次 ${last.cost_usd.toFixed(6)} · in {last.prompt} · out {last.completion} ·
          think {last.reasoning}
        </span>
      ) : (
        <span>本次 —</span>
      )}
      <span className={today >= 20 ? "warn" : undefined}>今日 ${today.toFixed(4)}</span>
    </footer>
  );
}
