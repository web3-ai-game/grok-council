export type Lights = "on" | "off";

const KEY = "oece-lights";

export function readLights(): Lights {
  const stored = localStorage.getItem(KEY);
  if (stored === "on" || stored === "off") return stored;
  const attr = document.documentElement.dataset.lights;
  if (attr === "on" || attr === "off") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "on" : "off";
}

export function applyLights(next: Lights): void {
  document.documentElement.dataset.lights = next;
  localStorage.setItem(KEY, next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "on" ? "#f4f1ea" : "#141413");
}

export function switchLights(next: Lights, origin: { x: number; y: number }): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = document.startViewTransition?.bind(document);
  if (reduced || !start) {
    applyLights(next);
    return;
  }
  const end = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );
  const transition = start(() => applyLights(next));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${end}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration: 760,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => applyLights(next));
}
