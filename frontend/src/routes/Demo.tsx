import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { applyCouncilEvent } from "../lib/councilEvents";
import type { CouncilExpertView, CouncilView } from "../lib/types";
import { applyLights, readLights, switchLights, type Lights } from "../demo/lights";
import { buildTimeline } from "../demo/player";
import { SCENARIOS, scenarioById } from "../demo/scenarios";
import { SEATS, seatName, seatShort, type Lang } from "../demo/seats";
import type { Phase } from "../demo/types";

const LANG_KEY = "oece-lang";
const DEMO_ID = "demo";

const COPY = {
  zh: {
    title: "grok-council · 離線回放",
    kicker: "離線回放",
    language: "語言",
    phase: "階段",
    topics: "議題",
    playback: "播放",
    phases: [
      ["gate", "門控"],
      ["parallel", "平行"],
      ["review", "互怼"],
      ["synth", "合成"],
    ] as const,
    standby: "未出場",
    skipFallback: "這一題沒有喚醒。結論不會引用這一席。",
    reasoning: "推理鏈",
    position: "立場",
    review: "互怼",
    critique: (name: string) => `[ ⚔ 質疑 → ${name} ]`,
    challenged: (name: string) => `[ 收到${name}質疑 ]`,
    selecting: "門控點名中",
    waiting: "等待合成",
    writing: "書寫中",
    settled: "已落筆",
    failed: "失敗",
    idle: "等待",
    pause: "暫停",
    resume: "繼續",
    replay: "重播",
    portfolio: "作品集",
    source: "原始碼",
    note: "策展回放，不是實扣。不需要 Key。",
    lightsOn: "關燈",
    lightsOff: "開燈",
    awake: "全席",
    gated: "門控跳過 2 席",
    verdict: "議長結論",
    verdictReason: "議長推理",
    verdictWait: "出場的席還在寫。結論在互怼之後。",
    nowGate: "正在點名。",
    nowWrite: "席位正在寫。",
    nowReview: "席位正在互怼。",
    table: "席位記錄",
    speed: "速度",
  },
  en: {
    title: "grok-council · Offline replay",
    kicker: "Offline replay",
    language: "Language",
    phase: "Phase",
    topics: "Topics",
    playback: "Playback",
    phases: [
      ["gate", "Gate"],
      ["parallel", "Parallel"],
      ["review", "Review"],
      ["synth", "Synthesis"],
    ] as const,
    standby: "Not called",
    skipFallback: "This topic did not wake this seat. The verdict will not cite it.",
    reasoning: "Reasoning",
    position: "Position",
    review: "Cross-review",
    critique: (name: string) => `[ Critique → ${name} ]`,
    challenged: (name: string) => `[ Challenged by ${name} ]`,
    selecting: "Gate is choosing",
    waiting: "Waiting to synthesize",
    writing: "Writing",
    settled: "Settled",
    failed: "Failed",
    idle: "Waiting",
    pause: "Pause",
    resume: "Resume",
    replay: "Replay",
    portfolio: "Portfolio",
    source: "Source",
    note: "Curated replay, not a live capture. No key required.",
    lightsOn: "Lights off",
    lightsOff: "Lights on",
    awake: "Full table",
    gated: "Gate skipped 2",
    verdict: "Chair's verdict",
    verdictReason: "Chair's reasoning",
    verdictWait: "The seats are still writing. The verdict comes after review.",
    nowGate: "The gate is choosing.",
    nowWrite: "The seats are writing.",
    nowReview: "The seats are reviewing.",
    table: "The table",
    speed: "Speed",
  },
} as const;

type Copy = (typeof COPY)[Lang];

function blankCouncil(): CouncilView {
  return {
    message_id: DEMO_ID,
    engine: "council",
    gating: true,
    experts: [],
    citations: [],
  };
}

function readLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === "en" ? "en" : "zh";
}

function statusWord(status: CouncilExpertView["status"] | undefined, copy: Copy): string {
  if (status === "running") return copy.writing;
  if (status === "done") return copy.settled;
  if (status === "error") return copy.failed;
  return copy.idle;
}

export function Demo() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [lights, setLights] = useState<Lights>(readLights);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<Phase>("gate");
  const [council, setCouncil] = useState<CouncilView>(blankCouncil);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const waitRef = useRef(0);

  const scenario = scenarioById(scenarioId);
  const copy = COPY[lang];
  const script = useMemo(() => buildTimeline(scenario, lang), [scenario, lang]);
  const side = scenario[lang];
  const skipped = Object.values(side.seats).filter((item) => item.standby).length;

  useEffect(() => {
    applyLights(lights);
  }, [lights]);

  useEffect(() => {
    document.title = copy.title;
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant";
  }, [copy.title, lang]);

  useEffect(() => {
    setIndex(0);
    setPhase("gate");
    setCouncil(blankCouncil());
    setRevealed({});
    setPaused(false);
    waitRef.current = 0;
  }, [runId, script]);

  useEffect(() => {
    const event = script[index];
    if (!event || paused) return;
    const prevAt = index === 0 ? 0 : script[index - 1]?.at ?? 0;
    const full = Math.max(0, (event.at - prevAt) / speed);
    const wait = waitRef.current || full;
    const started = performance.now();
    const timer = window.setTimeout(() => {
      waitRef.current = 0;
      if (event.event === "expert.step" && typeof event.data.expert_id === "string") {
        const id = event.data.expert_id;
        const stepIndex = Number(event.data.index);
        setRevealed((prev) => ({
          ...prev,
          [id]: Math.max(prev[id] ?? 0, Number.isFinite(stepIndex) ? stepIndex + 1 : 0),
        }));
      } else if (event.event === "phase" && typeof event.data.phase === "string") {
        setPhase(event.data.phase as Phase);
      } else {
        applyCouncilEvent(
          event.event,
          event.data,
          () => DEMO_ID,
          (updater) => {
            setCouncil((prev) => {
              const bag = { [DEMO_ID]: prev };
              const next = typeof updater === "function" ? updater(bag) : updater;
              return next[DEMO_ID] ?? prev;
            });
          },
          "council",
        );
      }
      setIndex((value) => value + 1);
    }, wait);
    return () => {
      waitRef.current = Math.max(0, wait - (performance.now() - started));
      window.clearTimeout(timer);
    };
  }, [index, paused, script, speed]);

  function chooseLang(next: Lang) {
    localStorage.setItem(LANG_KEY, next);
    document.documentElement.lang = next === "en" ? "en" : "zh-Hant";
    setLang(next);
    setRunId((value) => value + 1);
  }

  function onLamp(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = lights === "on" ? "off" : "on";
    switchLights(next, {
      x: event.clientX || rect.left + rect.width / 2,
      y: event.clientY || rect.top + rect.height / 2,
    });
    setLights(next);
  }

  const experts = council.experts;
  const chair = experts.find((item) => item.id === "leader");
  const wakeLabel = skipped ? (lang === "zh" ? `門控跳過 ${skipped} 席` : `Gate skipped ${skipped}`) : copy.awake;
  const verdictReady = Boolean(chair?.content);
  const statusLine =
    phase === "review" ? copy.nowReview : phase === "parallel" ? copy.nowWrite : phase === "gate" ? copy.nowGate : copy.verdictWait;

  return (
    <div className="sandbox">
      <header className="topbar">
        <div className="brand">
          <strong>grok-council</strong>
          <span>{copy.kicker}</span>
        </div>
        <div className="top-actions">
          <div className="seg" role="group" aria-label={copy.language}>
            <button type="button" className={lang === "en" ? "on" : ""} onClick={() => chooseLang("en")}>
              EN
            </button>
            <button type="button" className={lang === "zh" ? "on" : ""} onClick={() => chooseLang("zh")}>
              繁
            </button>
          </div>
          <button type="button" className={`lamp ${lights}`} onClick={onLamp} aria-pressed={lights === "on"}>
            <LampIcon on={lights === "on"} />
            <span>{lights === "on" ? copy.lightsOn : copy.lightsOff}</span>
          </button>
          <a href="https://portfolio.oece-x.com">{copy.portfolio}</a>
          <a href="https://github.com/web3-ai-game/grok-council">{copy.source}</a>
        </div>
      </header>

      <section className="prompt">
        <p className="eyebrow">{wakeLabel}</p>
        <h1>{side.title}</h1>
        <p className="question">{side.question}</p>
      </section>

      <div className="topic-scroller">
        <div className="topics" role="group" aria-label={copy.topics}>
          {SCENARIOS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === scenarioId ? "on" : ""}
              onClick={() => {
                setScenarioId(item.id);
                setRunId((value) => value + 1);
              }}
            >
              {item[lang].title}
            </button>
          ))}
        </div>
      </div>

      <div className="rail" aria-label={copy.phase}>
        {copy.phases.map(([id, label]) => (
          <span key={id} className={phase === id || (phase === "done" && id === "synth") ? "now" : ""}>
            {label}
          </span>
        ))}
      </div>

      <div className="controls">
        <div className="transport" role="group" aria-label={copy.playback}>
          <button type="button" onClick={() => setPaused((value) => !value)}>
            {paused ? copy.resume : copy.pause}
          </button>
          <button type="button" onClick={() => setRunId((value) => value + 1)}>
            {copy.replay}
          </button>
          <button type="button" className={speed === 1 ? "on" : ""} onClick={() => setSpeed(1)} aria-label={`${copy.speed} 1×`}>
            1×
          </button>
          <button type="button" className={speed === 2 ? "on" : ""} onClick={() => setSpeed(2)} aria-label={`${copy.speed} 2×`}>
            2×
          </button>
        </div>
      </div>

      <p className="table-label">{copy.table}</p>
      <div className="board">
        {SEATS.map((seat) => (
          <ExpertCard
            key={seat.id}
            seatId={seat.id}
            emoji={seat.emoji}
            name={seatName(seat.id, lang)}
            expert={experts.find((item) => item.id === seat.id)}
            steps={seat.id === "leader" ? side.chair.steps : side.seats[seat.id]?.steps ?? []}
            skip={side.seats[seat.id]?.skip}
            revealed={revealed[seat.id] ?? 0}
            gating={council.gating || experts.length === 0}
            copy={copy}
            lang={lang}
          />
        ))}
      </div>

      <section className="verdict" aria-label={copy.verdict}>
        <StepChain
          steps={side.chair.steps}
          revealed={revealed.leader ?? 0}
          active={phase === "synth" && !chair?.content}
        />
        <div className="verdict-copy">
          <p className="eyebrow">{verdictReady ? copy.verdict : copy.phase}</p>
          <p className="answer">
            {chair?.content || (phase === "synth" ? "" : statusLine)}
            {phase === "synth" ? <i /> : null}
          </p>
        </div>
      </section>
      <p className="footnote">{copy.note}</p>
    </div>
  );
}

function ExpertCard({
  seatId,
  emoji,
  name,
  expert,
  steps,
  skip,
  revealed,
  gating,
  copy,
  lang,
}: {
  seatId: string;
  emoji: string;
  name: string;
  expert?: CouncilExpertView;
  steps: readonly string[];
  skip?: string;
  revealed: number;
  gating: boolean;
  copy: Copy;
  lang: Lang;
}) {
  const standby = expert?.status === "standby";
  const running = expert?.status === "running" || expert?.critiquing;
  const waiting = seatId === "leader" && expert?.status === "pending";
  const target = expert?.reviewTarget ? seatShort(expert.reviewTarget, lang) : "";
  const position =
    expert?.status === "error"
      ? expert.error || copy.failed
      : standby
        ? skip || copy.skipFallback
        : waiting
          ? copy.waiting
          : expert?.content || "";
  const review = expert?.review || (expert?.critiquing && target ? copy.critique(target) : "");
  return (
    <article className={`card${standby ? " standby" : ""}${expert?.challengedBy ? " hit" : ""}${running ? " live" : ""}${seatId === "leader" ? " chair" : ""}`}>
      <header>
        <span className="mark" aria-hidden>
          {emoji}
        </span>
        <div>
          <strong>{name}</strong>
          <em>
            {gating ? copy.selecting : standby ? copy.standby : waiting ? copy.waiting : statusWord(expert?.status, copy)}
          </em>
        </div>
      </header>
      <div className="card-body">
        <StepChain steps={steps} revealed={standby || gating ? 0 : revealed} active={Boolean(running && !position && !review)} />
        <p className="field">{copy.position}</p>
        <p className="ink">
          {position || "·"}
          {running && position ? <i /> : null}
        </p>
        {review ? (
          <>
            <p className="field">{copy.review}</p>
            <p className="review">
              {review}
              {expert?.critiquing ? <i /> : null}
            </p>
          </>
        ) : null}
      </div>
    </article>
  );
}

function StepChain({ steps, revealed, active }: { steps: readonly string[]; revealed: number; active: boolean }) {
  const rows = [15, 43, 71];
  const shown = [steps[0] ?? "", steps[1] ?? "", steps[2] ?? ""];
  const label = shown.filter((step, index) => index < revealed && step).join(" · ");
  return (
    <svg className="chain" viewBox="0 0 280 86" role="img" aria-label={label || undefined}>
      <line x1="8" y1="19" x2="8" y2="39" className={revealed > 1 ? "on" : ""} />
      <line x1="8" y1="47" x2="8" y2="67" className={revealed > 2 ? "on" : ""} />
      {rows.map((y, index) => {
        const on = index < revealed;
        const hot = active && on && index === revealed - 1;
        return (
          <g key={y}>
            <circle cx="8" cy={y} r={hot ? 4.4 : 3.5} className={on ? "on" : ""} />
            <text x="20" y={y} dominantBaseline="middle" className={on ? "on" : ""}>
              {on ? shown[index] : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LampIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={on ? "glow" : ""}>
      <path
        d="M8 10.5c0-3 1.8-5.5 4-5.5s4 2.5 4 5.5c0 1.6-.6 2.7-1.4 3.4-.4.3-.6.7-.6 1.1v.5H10v-.5c0-.4-.2-.8-.6-1.1C8.6 13.2 8 12.1 8 10.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M10 17.5h4M11 19.5h2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
