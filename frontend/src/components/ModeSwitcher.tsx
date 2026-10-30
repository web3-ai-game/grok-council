import type { ChatMode } from "../lib/types";

const MODES: { id: ChatMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "fast", label: "Fast" },
  { id: "expert", label: "Expert" },
  { id: "heavy", label: "Heavy" },
];

export function ModeSwitcher({
  value,
  onChange,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  return (
    <label className="composer-mini">
      <span className="sr-only">模式</span>
      <select value={value} onChange={(e) => onChange(e.target.value as ChatMode)}>
        {MODES.map((mode) => (
          <option key={mode.id} value={mode.id}>
            {mode.label}
          </option>
        ))}
      </select>
    </label>
  );
}
