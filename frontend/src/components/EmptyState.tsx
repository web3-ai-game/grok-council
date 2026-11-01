const SUGGESTIONS = [
  { label: "幫我寫一份簡潔簡報", fill: "用條目列出要點、風險與下一步，控制在 200 字內。" },
  { label: "協助我規劃一個小專案", fill: "給出可執行步驟、依賴與驗收標準。" },
  { label: "對比兩個方案並給推薦", fill: "對比選項的取捨，指出分歧並給推薦。" },
] as const;

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden>
        <svg viewBox="0 0 80 80">
          <defs>
            <linearGradient id="oece-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7af0ff" />
              <stop offset="1" stopColor="#4d7dff" />
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="20" fill="none" stroke="url(#oece-mark)" strokeWidth="2.4" />
          <path
            d="M29 29 L51 51 M51 29 L29 51"
            stroke="url(#oece-mark)"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h1>需要什麼協助？</h1>
      <p className="empty-sub">可以提問、搜尋網頁，或開啟專家議會。</p>
      <div className="suggest-list">
        {SUGGESTIONS.map((item) => (
          <button key={item.label} type="button" className="suggest-chip" onClick={() => onPick(item.fill)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
