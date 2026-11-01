import { useEffect, useRef, type MouseEvent } from "react";
import type { CouncilExpertView } from "../lib/types";
import { SEATS, seatShort, type Lang } from "./seats";
import type { Phase } from "./types";

const ORBIT = SEATS.filter((seat) => seat.id !== "leader");

type Node = { id: string; x: number; y: number; ang: number };

type Props = {
  phase: Phase;
  experts: CouncilExpertView[];
  focus: string | null;
  lang: Lang;
  onFocus: (id: string) => void;
};

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Arena({ phase, experts, focus, lang, onFocus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const centerRef = useRef({ x: 0, y: 0 });
  const propsRef = useRef({ phase, experts, focus, lang });
  propsRef.current = { phase, experts, focus, lang };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = reduceMotion();
    let frame = 0;
    let burstAt = 0;
    let lastChair = false;
    let pingAt = 0;
    let lastFocus: string | null = null;

    function resize() {
      const parent = canvas!.parentElement;
      const width = parent?.clientWidth || 420;
      const height = parent?.clientHeight || 360;
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function layout(w: number, h: number) {
      const cx = w / 2;
      const cy = h / 2;
      const rx = Math.min(w * 0.34, h * 0.36);
      const ry = rx * 0.86;
      centerRef.current = { x: cx, y: cy };
      nodesRef.current = ORBIT.map((seat, i) => {
        const ang = -Math.PI / 2 + (i / ORBIT.length) * Math.PI * 2;
        return { id: seat.id, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, ang };
      });
      return { cx, cy, rx, ry };
    }

    function expert(id: string) {
      return propsRef.current.experts.find((item) => item.id === id);
    }

    function drawArc(a: Node, b: Node, hot: boolean, now: number, cx: number, cy: number) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      if (nx * (mx - cx) + ny * (my - cy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const bow = Math.min(36, len * 0.28);
      ctx!.beginPath();
      ctx!.moveTo(a.x, a.y);
      ctx!.quadraticCurveTo(mx + nx * bow, my + ny * bow, b.x, b.y);
      ctx!.strokeStyle = hot ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.28)";
      ctx!.lineWidth = hot ? 1.35 : 0.8;
      if (hot && !reduce) {
        ctx!.setLineDash([5, 7]);
        ctx!.lineDashOffset = -((now / 28) % 24);
      } else {
        ctx!.setLineDash([]);
      }
      ctx!.stroke();
      ctx!.setLineDash([]);
      if (hot) ringAt(b.x, b.y, now - pingAt);
      else {
        ctx!.fillStyle = "rgba(255,255,255,0.45)";
        ctx!.beginPath();
        ctx!.arc(b.x, b.y, 2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function ringAt(x: number, y: number, age: number) {
      ctx!.fillStyle = "#fff";
      ctx!.beginPath();
      ctx!.arc(x, y, 3, 0, Math.PI * 2);
      ctx!.fill();
      if (age < 1600 && !reduce) {
        const t = Math.max(0, age) / 1600;
        ctx!.strokeStyle = `rgba(255,255,255,${(0.8 * (1 - t)).toFixed(3)})`;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(x, y, 6 + t * 26, 0, Math.PI * 2);
        ctx!.stroke();
      }
    }

    function draw(now: number) {
      const { phase: livePhase, focus: liveFocus, lang: liveLang } = propsRef.current;
      const width = canvas!.clientWidth;
      const height = canvas!.clientHeight;
      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = "#000";
      ctx!.fillRect(0, 0, width, height);
      const { cx, cy, rx, ry } = layout(width, height);
      const chair = livePhase === "synth" || livePhase === "done";
      if (chair && !lastChair) burstAt = now;
      lastChair = chair;
      if (liveFocus !== lastFocus) {
        pingAt = now;
        lastFocus = liveFocus;
      }

      ctx!.strokeStyle = "rgba(255,255,255,0.06)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.beginPath();
      ctx!.ellipse(cx, cy, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
      ctx!.stroke();

      if (livePhase === "gate") {
        const t = reduce ? 0.35 : (now % 1600) / 1600;
        ctx!.strokeStyle = `rgba(255,255,255,${(0.4 * (1 - t)).toFixed(3)})`;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.ellipse(cx, cy, 8 + t * rx, 8 + t * ry, 0, 0, Math.PI * 2);
        ctx!.stroke();
      }

      if (livePhase === "parallel" && !reduce) {
        for (let i = 0; i < 5; i += 1) {
          const ang = now * 0.00035 * (1 + i * 0.17) + i * 1.3;
          const x = cx + Math.cos(ang) * rx;
          const y = cy + Math.sin(ang) * ry;
          ctx!.fillStyle = "rgba(255,255,255,0.72)";
          ctx!.beginPath();
          ctx!.arc(x, y, 1.3, 0, Math.PI * 2);
          ctx!.fill();
        }
      }

      const nodes = nodesRef.current;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const showArcs = livePhase === "review" || livePhase === "synth" || livePhase === "done";
      if (showArcs) {
        const cuts = propsRef.current.experts.filter((item) => item.reviewTarget && (item.review || item.critiquing));
        for (const item of cuts) {
          const from = byId.get(item.id);
          const to = byId.get(item.reviewTarget ?? "");
          if (!from || !to) continue;
          const hot = !liveFocus || liveFocus === item.id || liveFocus === item.reviewTarget;
          if (liveFocus && !hot) drawArc(from, to, false, now, cx, cy);
        }
        for (const item of cuts) {
          const from = byId.get(item.id);
          const to = byId.get(item.reviewTarget ?? "");
          if (!from || !to) continue;
          const hot = !liveFocus || liveFocus === item.id || liveFocus === item.reviewTarget;
          if (!liveFocus || hot) drawArc(from, to, Boolean(liveFocus) || Boolean(item.critiquing), now, cx, cy);
        }
      }

      if (chair) {
        ctx!.strokeStyle = "rgba(255,255,255,0.55)";
        ctx!.lineWidth = 0.8;
        for (const node of nodes) {
          const row = expert(node.id);
          if (row?.status === "standby" || !row) continue;
          ctx!.beginPath();
          ctx!.moveTo(node.x, node.y);
          ctx!.lineTo(cx, cy);
          ctx!.stroke();
        }
        if (!reduce && now - burstAt < 900) {
          const t = (now - burstAt) / 900;
          for (let i = 0; i < 10; i += 1) {
            const ang = (i / 10) * Math.PI * 2;
            const rad = 6 + t * 28;
            ctx!.fillStyle = `rgba(255,255,255,${(0.8 * (1 - t)).toFixed(3)})`;
            ctx!.beginPath();
            ctx!.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 1.4, 0, Math.PI * 2);
            ctx!.fill();
          }
        }
      }

      const font = width < 360 ? "10px ui-monospace, monospace" : "11px ui-monospace, monospace";
      ctx!.font = font;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      for (const node of nodes) {
        const row = expert(node.id);
        const skipped = row?.status === "standby";
        const awake = Boolean(row) && !skipped && row?.status !== "pending";
        const known = Boolean(row) && row?.status !== "pending";
        if (livePhase === "parallel" && awake && !reduce) {
          const pulse = (Math.sin(now / 280 + node.ang) + 1) / 2;
          ctx!.strokeStyle = `rgba(255,255,255,${(0.28 + pulse * 0.4).toFixed(3)})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(node.x, node.y, 8 + pulse * 4, 0, Math.PI * 2);
          ctx!.stroke();
        }
        if (liveFocus === node.id) {
          ctx!.strokeStyle = "rgba(255,255,255,0.9)";
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(node.x, node.y, 11, 0, Math.PI * 2);
          ctx!.stroke();
        }
        if (skipped) {
          ctx!.save();
          ctx!.setLineDash([2, 3]);
          ctx!.strokeStyle = "rgba(255,255,255,0.2)";
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(node.x, node.y, 3.5, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.restore();
        } else if (awake || known) {
          ctx!.fillStyle = "#fff";
          ctx!.beginPath();
          ctx!.arc(node.x, node.y, 3.4, 0, Math.PI * 2);
          ctx!.fill();
        } else {
          ctx!.strokeStyle = "rgba(255,255,255,0.28)";
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(node.x, node.y, 3.2, 0, Math.PI * 2);
          ctx!.stroke();
        }
        const label = seatShort(node.id, liveLang);
        const lx = node.x + Math.cos(node.ang) * (width < 360 ? 16 : 22);
        const ly = node.y + Math.sin(node.ang) * (width < 360 ? 14 : 18);
        ctx!.fillStyle = skipped ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.78)";
        ctx!.fillText(label, lx, ly);
      }

      ctx!.fillStyle = chair ? "#fff" : "rgba(255,255,255,0.85)";
      ctx!.beginPath();
      ctx!.arc(cx, cy, liveFocus === "leader" ? 5 : 4, 0, Math.PI * 2);
      ctx!.fill();
      if (liveFocus === "leader") {
        ctx!.strokeStyle = "rgba(255,255,255,0.9)";
        ctx!.beginPath();
        ctx!.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx!.stroke();
      }
      ctx!.fillStyle = "rgba(255,255,255,0.78)";
      ctx!.font = font;
      ctx!.fillText(seatShort("leader", liveLang), cx, cy + 16);
    }

    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const loop = (now: number) => {
      draw(now);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  function pick(event: MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const center = centerRef.current;
    if (Math.hypot(x - center.x, y - center.y) < 18) {
      onFocus("leader");
      return;
    }
    let best: Node | null = null;
    let bestDist = 22;
    for (const node of nodesRef.current) {
      const dist = Math.hypot(x - node.x, y - node.y);
      if (dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    if (best) onFocus(best.id);
  }

  return <canvas ref={canvasRef} onClick={pick} aria-label="council orbit" />;
}
