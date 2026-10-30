export type ThemePref = "system" | "dark" | "light";

export type Prefs = {
  theme: ThemePref;
  sidebarCollapsed: boolean;
  enterToSend: boolean;
};

const KEY = "oece-x-prefs";

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { theme: "system", sidebarCollapsed: false, enterToSend: true };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      enterToSend: parsed.enterToSend !== false,
    };
  } catch {
    return { theme: "system", sidebarCollapsed: false, enterToSend: true };
  }
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(KEY, JSON.stringify(prefs));
  applyTheme(prefs.theme);
  listeners.forEach((fn) => fn());
}

export function applyTheme(theme: ThemePref): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function initTheme(): void {
  applyTheme(getPrefs().theme);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getPrefs().theme === "system") applyTheme("system");
  });
}
