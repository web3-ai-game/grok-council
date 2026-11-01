const OPTIONS = ["low", "medium", "high", "xhigh"] as const;

export function EffortDial({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (effort: string | null) => void;
}) {
  return (
    <label className="composer-mini picker">
      <span className="sr-only">effort</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">effort</option>
        {OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}