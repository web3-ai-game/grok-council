export type ThinkMark = {
  draw: (now: number) => void;
  burst: () => void;
};

export function mountThink(canvas: HTMLCanvasElement, size = 36, count = 6, speed = 0.85): ThinkMark {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { draw() {}, burst() {} };
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dots = Array.from({ length: count }, (_, i) => ({
    a: (i / count) * Math.PI * 2,
    r: 0.42 + (i % 3) * 0.16,
    s: 0.55 + (i % 4) * 0.22,
    phase: i * 1.7,
    w: i % 3 === 0 ? 2.1 : 1.35,
  }));
  let boost = 0;

  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  function draw(now: number) {
    boost *= 0.9;
    ctx!.clearRect(0, 0, size, size);
    const t = now * 0.001 * (reduce ? 0 : 1);
    const pts = dots.map((d) => {
      const ang = d.a + t * d.s * speed * (1 + boost);
      const rad = (d.r + Math.sin(t * 1.4 + d.phase) * 0.07) * size * 0.34 * (1 + boost * 0.4);
      return {
        x: size / 2 + Math.cos(ang) * rad,
        y: size / 2 + Math.sin(ang * 0.82 + d.phase) * rad * 0.7,
        w: d.w,
      };
    });
    ctx!.lineWidth = 0.6;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const dx = pts[i]!.x - pts[j]!.x;
        const dy = pts[i]!.y - pts[j]!.y;
        const dist = Math.hypot(dx, dy);
        if (dist > size * 0.42) continue;
        ctx!.strokeStyle = `rgba(255,255,255,${(0.22 * (1 - dist / (size * 0.42))).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.moveTo(pts[i]!.x, pts[i]!.y);
        ctx!.lineTo(pts[j]!.x, pts[j]!.y);
        ctx!.stroke();
      }
    }
    for (const p of pts) {
      const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8);
      g.addColorStop(0, `rgba(255,255,255,${0.55 + boost * 0.3})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = "#fff";
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.w, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  return {
    draw,
    burst() {
      if (!reduce) boost = 1;
    },
  };
}
