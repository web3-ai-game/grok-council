const TOOLS: { id: string; label: string }[] = [
  { id: "web_search", label: "DeepSearch" },
  { id: "x_search", label: "X" },
  { id: "code_execution", label: "代码" },
];

export function ToolChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tools: string[]) => void;
}) {
  return (
    <div className="chips">
      {TOOLS.map((tool) => {
        const on = value.includes(tool.id);
        return (
          <button
            key={tool.id}
            type="button"
            className={on ? "chip on" : "chip"}
            onClick={() =>
              onChange(on ? value.filter((id) => id !== tool.id) : [...value, tool.id])
            }
          >
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}
