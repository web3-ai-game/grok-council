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
    kicker: "離線回放",
    phases: [
      ["gate", "門控"],
      ["parallel", "平行"],
      ["review", "互怼"],
      ["synth", "合成"],
    ] as const,
    standby: "STANDBY · 門控跳過（省 Token）",
    reasoning: "推理鏈",
    position: "核心結論",
    review: "互怼交鋒",
    critique: (name: string) => `[ ⚔ 質疑 → ${name} ]`,
    challenged: (name: string) => `[ 收到${name}質疑 ]`,
    selecting: "門控點名中",
    waiting: "等待合成",
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
  },
  en: {
    kicker: "Offline replay",
    phases: [
      ["gate", "Gate"],
      ["parallel", "Parallel"],
      ["review", "Review"],
      ["synth", "Chair"],
    ] as const,
    standby: "STANDBY · Gate skipped",
    reasoning: "Reasoning",
    position: "Position",
    review: "Cross-Review",
    critique: (name: string) => `[ Critique → ${name} ]`,
    challenged: (name: string) => `[ Challenged by ${name} ]`,
    selecting: "Gate is choosing",
    waiting: "Waiting to synthesize",
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
  },
} as const;

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
  const waitRef = useRef(0);

  const scenario = scenarioById(scenarioId);
  const copy = COPY[lang];
  const script = useMemo(() => buildTimeline(scenario, lang), [scenario, lang]);
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    applyLights(lights);
  }, [lights]);

  useEffect(() => {
    document.title = "grok-council";
  }, []);

  useEffect(() => {
    setIndex(0);
    setPhase("gate");
    setCouncil(blankCouncil());
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
      if (event.event === "phase" && typeof event.data.phase === "string") {
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
  const room = lights === "on" ? `${base}room-on.jpg` : `${base}room-off.jpg`;

  return (
    <div className="sandbox">
      <header className="topbar">
        <div className="brand">
          <strong>grok-council</strong>
          <span>{copy.kicker}</span>
        </div>
        <div className="top-actions">
          <div className="seg" role="group" aria-label="language">
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

      <section className="hero" style={{ backgroundImage: `url(${room})` }}>
        <div className="hero-fade" />
        <p className="eyebrow">{scenario.wake === "gated" ? copy.gated : copy.awake}</p>
        <h1>{scenario[lang].title}</h1>
        <p className="question">{scenario[lang].question}</p>
      </section>

      <div className="rail" aria-label="phase">
        {copy.phases.map(([id, label]) => (
          <span key={id} className={phase === id || (phase === "done" && id === "synth") ? "now" : ""}>
            {label}
          </span>
        ))}
      </div>

      <div className="controls">
        <div className="topics">
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
        <div className="transport">
          <button type="button" onClick={() => setPaused((value) => !value)}>
            {paused ? copy.resume : copy.pause}
          </button>
          <button type="button" onClick={() => setRunId((value) => value + 1)}>
            {copy.replay}
          </button>
          <button type="button" className={speed === 1 ? "on" : ""} onClick={() => setSpeed(1)}>
            1×
          </button>
          <button type="button" className={speed === 2 ? "on" : ""} onClick={() => setSpeed(2)}>
            2×
          </button>
        </div>
      </div>

      <div className="board">
        {SEATS.map((seat) => (
          <ExpertCard
            key={seat.id}
            seatId={seat.id}
            emoji={seat.emoji}
            name={seatName(seat.id, lang)}
            expert={experts.find((item) => item.id === seat.id)}
            gating={council.gating || experts.length === 0}
            copy={copy}
            lang={lang}
          />
        ))}
      </div>
      <p className="footnote">{copy.note}</p>
    </div>
  );
}

function ExpertCard({
  seatId,
  emoji,
  name,
  expert,
  gating,
  copy,
  lang,
}: {
  seatId: string;
  emoji: string;
  name: string;
  expert?: CouncilExpertView;
  gating: boolean;
  copy: (typeof COPY)[Lang];
  lang: Lang;
}) {
  const standby = expert?.status === "standby";
  const running = expert?.status === "running" || expert?.critiquing;
  const target = expert?.reviewTarget ? seatShort(expert.reviewTarget, lang) : "";
  const attacker = expert?.challengedBy ? seatName(expert.challengedBy, lang) : "";
  return (
    <article
      className={`card${standby ? " standby" : ""}${expert?.challengedBy ? " hit" : ""}${running ? " live" : ""}`}
    >
      <header>
        <span className="mark" aria-hidden>
          {emoji}
        </span>
        <div>
          <strong>{name}</strong>
          <em>
            {gating
              ? copy.selecting
              : standby
                ? copy.standby
                : seatId === "leader" && expert?.status === "pending"
                  ? copy.waiting
                  : statusWord(expert?.status, lang)}
          </em>
        </div>
      </header>
      {expert?.critiquing && target ? <p className="aim">{copy.critique(target)}</p> : null}
      {attacker ? <p className="incoming">{copy.challenged(attacker)}</p> : null}
      {standby || gating ? null : (
        <>
          <section>
            <span>{copy.reasoning}</span>
            <p className="mono">
              {expert?.reasoning || "·"}
              {running && !expert?.content && !expert?.review ? <i /> : null}
            </p>
          </section>
          <section>
            <span>{copy.position}</span>
            <p className="ink">
              {expert?.content || ""}
              {running && expert?.content && !expert?.critiquing ? <i /> : null}
            </p>
          </section>
          {expert?.review ? (
            <section>
              <span>{copy.review}</span>
              <p className="ink review">
                {expert.review}
                {expert.critiquing ? <i /> : null}
              </p>
            </section>
          ) : null}
        </>
      )}
    </article>
  );
}

function statusWord(status: CouncilExpertView["status"] | undefined, lang: Lang): string {
  if (status === "running") return lang === "en" ? "Writing" : "書寫中";
  if (status === "done") return lang === "en" ? "Settled" : "已落筆";
  if (status === "error") return lang === "en" ? "Failed" : "失敗";
  return lang === "en" ? "Waiting" : "等待";
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
