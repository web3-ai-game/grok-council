import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Arena } from "../demo/Arena";
import { phaseAt, buildTimeline, textDuration, typedCount } from "../demo/player";
import { scenarioById } from "../demo/scenarios";
import { SEATS, seatName, seatShort, type Lang } from "../demo/seats";
import { mountThink, type ThinkMark } from "../demo/think";
import type { Phase, TimedEvent } from "../demo/types";
import { applyCouncilEvent } from "../lib/councilEvents";
import type { CouncilExpertView, CouncilView } from "../lib/types";

const LANG_KEY = "oece-lang";
const DEMO_ID = "demo";

const TOPICS = [
  { id: "key-boundary", zh: "01 金鑰邊界", en: "01 Key Boundary" },
  { id: "visible-council", zh: "02 可見議會 vs 黑盒", en: "02 Visible vs Black Box" },
  { id: "sqlite-ceiling", zh: "03 SQLite 單機天花板", en: "03 SQLite Ceiling" },
] as const;

const PHASES = [
  { id: "gate" as const, zh: "1 門控", en: "1 Gate" },
  { id: "parallel" as const, zh: "2 平行", en: "2 Parallel" },
  { id: "review" as const, zh: "3 互懟", en: "3 Review" },
  { id: "synth" as const, zh: "4 議長", en: "4 Chair" },
];

type Trace = { text: string; elapsed: number };

const COPY = {
  zh: {
    title: "Grok Council · 只讀回放",
    kicker: "只讀回放 · 模擬",
    portfolio: "作品集",
    source: "GitHub",
    language: "語言",
    stream: "八席交鋒流",
    all: "全部",
    cuts: "僅看互懟",
    pause: "暫停",
    resume: "繼續",
    replay: "重播",
    jump: "一鍵看裁決",
    chair: "議長裁決",
    wait: "等待裁決",
    idle: "待命",
    awake: "已喚醒",
    skipped: "門控跳過",
    failed: "失敗",
    chairLive: "裁決中",
    chairDone: "已裁決",
    folded: "已收斂入議長裁決",
    fold: "收斂",
    noCuts: "這一拍還沒有互懟。",
    pick: "點席位或節點看交鋒",
    wake: "喚醒",
    argue: "立論",
    cut: "質疑",
    verdictStep: "裁決",
  },
  en: {
    title: "Grok Council · read-only",
    kicker: "Read-only · simulated",
    portfolio: "Portfolio",
    source: "GitHub",
    language: "Language",
    stream: "Council Stream",
    all: "All",
    cuts: "Cuts only",
    pause: "Pause",
    resume: "Resume",
    replay: "Replay",
    jump: "Jump to verdict",
    chair: "Chair",
    wait: "Waiting on the chair",
    idle: "Idle",
    awake: "Awake",
    skipped: "Gate skipped",
    failed: "Failed",
    chairLive: "Ruling",
    chairDone: "Ruled",
    folded: "folded into the chair",
    fold: "Fold",
    noCuts: "No cut-ins on this beat.",
    pick: "Pick a seat to read the cut",
    wake: "Wake",
    argue: "Position",
    cut: "Cut",
    verdictStep: "Verdict",
  },
} as const;

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function blankCouncil(): CouncilView {
  return {
    message_id: DEMO_ID,
    engine: "council",
    gating: true,
    experts: [],
    citations: [],
  };
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstSentence(review: string): string {
  const body = review
    .replace(/^「[^」]*」\s*/u, "")
    .replace(/^"[^"]*"\s*/u, "")
    .trim();
  const sentence = body.split(/[。！？.!?]/)[0]?.trim() ?? "";
  return sentence || body.slice(0, 72);
}

function project(events: TimedEvent[]): { council: CouncilView; traces: Record<string, Trace>; phase: Phase } {
  let council = blankCouncil();
  const traces: Record<string, Trace> = {};
  let phase: Phase = "gate";
  const setCouncils: Dispatch<SetStateAction<Record<string, CouncilView>>> = (updater) => {
    const bag = { [DEMO_ID]: council };
    const next = typeof updater === "function" ? updater(bag) : updater;
    council = next[DEMO_ID] ?? council;
  };
  for (const event of events) {
    if (event.event === "thought.start" && typeof event.data.expert_id === "string") {
      const text = typeof event.data.text === "string" ? event.data.text : "";
      traces[event.data.expert_id] = { text, elapsed: textDuration(text) };
    } else if (event.event === "phase" && typeof event.data.phase === "string") {
      phase = event.data.phase as Phase;
    } else {
      applyCouncilEvent(event.event, event.data, () => DEMO_ID, setCouncils, "council");
    }
  }
  return { council, traces, phase };
}

function pillOn(phase: Phase, id: (typeof PHASES)[number]["id"]): boolean {
  if (id === "synth") return phase === "synth" || phase === "done";
  return phase === id;
}

export function Demo() {
  const [lang, setLang] = useState<Lang>(readLang);
  const [scenarioId, setScenarioId] = useState<string>(TOPICS[0].id);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<Phase>("gate");
  const [council, setCouncil] = useState<CouncilView>(blankCouncil);
  const [index, setIndex] = useState(0);
  const [traces, setTraces] = useState<Record<string, Trace>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "cuts">("all");
  const waitRef = useRef(0);
  const seekRef = useRef(false);
  const thinkRef = useRef<ThinkMark | null>(null);
  const scoreRef = useRef<HTMLParagraphElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);

  const scenario = scenarioById(scenarioId);
  const copy = COPY[lang];
  const script = useMemo(() => buildTimeline(scenario, lang), [scenario, lang]);
  const side = scenario[lang];
  const experts = council.experts;
  const chair = experts.find((item) => item.id === "leader");

  const stats = useMemo(() => {
    const roster = SEATS.filter((seat) => seat.id !== "leader");
    const skipped = roster.filter((seat) => side.seats[seat.id]?.standby).length;
    const awake = roster.length - skipped;
    const critiques = roster.filter((seat) => {
      const scripted = side.seats[seat.id];
      return Boolean(scripted?.review && scripted.review_target && !scripted.error);
    }).length;
    const save = skipped ? Math.round((skipped / roster.length) * 100) : 0;
    return { awake, critiques, save };
  }, [side]);

  useEffect(() => {
    const canvas = markRef.current;
    if (!canvas) return;
    const mark = mountThink(canvas, 36, 6, 0.85);
    thinkRef.current = mark;
    let frame = 0;
    const loop = (now: number) => {
      mark.draw(now);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(frame);
      thinkRef.current = null;
    };
  }, []);

  useEffect(() => {
    document.title = copy.title;
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant";
  }, [copy.title, lang]);

  useEffect(() => {
    setIndex(0);
    setPhase("gate");
    setCouncil(blankCouncil());
    setTraces({});
    setPaused(false);
    setFocus(null);
    waitRef.current = 0;
  }, [runId, script]);

  useEffect(() => {
    const el = scoreRef.current;
    if (!el) return;
    el.classList.remove("sweep");
    void el.offsetWidth;
    el.classList.add("sweep");
    thinkRef.current?.burst();
  }, [scenarioId, phase]);

  useEffect(() => {
    if (seekRef.current) {
      seekRef.current = false;
      waitRef.current = 0;
    }
    const event = script[index];
    if (!event || paused) return;
    const prevAt = index === 0 ? 0 : (script[index - 1]?.at ?? 0);
    const full = Math.max(0, (event.at - prevAt) / speed);
    const wait = waitRef.current || full;
    const started = performance.now();
    const timer = window.setTimeout(() => {
      waitRef.current = 0;
      if (event.event === "thought.start" && typeof event.data.expert_id === "string") {
        const id = event.data.expert_id;
        const text = typeof event.data.text === "string" ? event.data.text : "";
        setTraces((prev) => ({ ...prev, [id]: { text, elapsed: 0 } }));
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

  useEffect(() => {
    if (paused) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      setTraces((prev) => {
        let changed = false;
        const next: Record<string, Trace> = {};
        for (const [id, trace] of Object.entries(prev)) {
          if (trace.elapsed >= textDuration(trace.text)) {
            next[id] = trace;
            continue;
          }
          changed = true;
          next[id] = { text: trace.text, elapsed: trace.elapsed + dt * speed };
        }
        return changed ? next : prev;
      });
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [paused, speed]);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`seat-${focus}`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  function chooseLang(next: Lang) {
    localStorage.setItem(LANG_KEY, next);
    document.documentElement.lang = next === "en" ? "en" : "zh-Hant";
    setLang(next);
    setRunId((value) => value + 1);
  }

  function land(target: Phase) {
    const cursor = phaseAt(script, target);
    const next = project(script.filter((event) => event.at <= cursor));
    const shown: Phase =
      target === "synth" || target === "done" ? (next.phase === "done" ? "done" : "synth") : target;
    seekRef.current = true;
    waitRef.current = 0;
    setCouncil(next.council);
    setTraces(next.traces);
    setPhase(shown);
    const at = script.findIndex((event) => event.at > cursor);
    setIndex(at < 0 ? script.length : at);
    setPaused(true);
    thinkRef.current?.burst();
    const el = scoreRef.current;
    if (el) {
      el.classList.remove("sweep");
      void el.offsetWidth;
      el.classList.add("sweep");
    }
  }

  function replay() {
    setPaused(false);
    setRunId((value) => value + 1);
  }

  function rowOf(id: string): CouncilExpertView {
    return (
      experts.find((item) => item.id === id) ?? {
        id,
        name: seatName(id, lang),
        content: "",
        reasoning: "",
        status: "pending",
        tools: [],
      }
    );
  }

  function statusOf(row: CouncilExpertView): string {
    if (row.status === "standby") return copy.skipped;
    if (row.status === "error") return copy.failed;
    if (row.id === "leader") {
      if (row.status === "done" && row.content) return copy.chairDone;
      if (row.status === "running" || row.content) return copy.chairLive;
      return copy.idle;
    }
    if ((row.critiquing || row.review) && row.reviewTarget) {
      return `⚔ ${copy.cut} → ${seatShort(row.reviewTarget, lang)}`;
    }
    if (row.status === "pending") return copy.idle;
    return copy.awake;
  }

  function reasoningOf(id: string): string {
    const trace = traces[id];
    if (!trace) return "";
    return flat(trace.text.slice(0, typedCount(trace.text, trace.elapsed)));
  }

  const readout = useMemo(() => {
    if (!focus) return copy.pick;
    const name = seatShort(focus, lang);
    if (focus === "leader") {
      const text = chair?.content ? firstSentence(chair.content) : "";
      return text ? `${name} · ${text}` : name;
    }
    const row = experts.find((item) => item.id === focus);
    if (row?.status === "standby") return `${name} · ${copy.skipped}`;
    const own = row?.review && row.reviewTarget ? row : undefined;
    const incoming = experts.find((item) => item.reviewTarget === focus && item.review);
    const from = own ? name : incoming ? seatShort(incoming.id, lang) : "";
    const to = own?.reviewTarget ? seatShort(own.reviewTarget, lang) : incoming ? name : "";
    const text = firstSentence(own?.review || incoming?.review || "");
    if (!from || !text) return `${name} · ${row ? statusOf(row) : copy.idle}`;
    const tail = chair?.content ? ` · ${copy.folded}` : "";
    return `${from} → ${to} · ${text}${tail}`;
  }, [focus, experts, chair, lang, copy]);

  const rows = SEATS.filter((seat) => {
    if (filter === "all") return true;
    const row = experts.find((item) => item.id === seat.id);
    if (!row || row.id === "leader") return false;
    return Boolean(row.review || row.critiquing || row.reviewTarget || row.challengedBy || row.challengers?.length);
  });

  const phaseWord =
    phase === "gate"
      ? lang === "zh"
        ? "門控"
        : "GATE"
      : phase === "parallel"
        ? lang === "zh"
          ? "平行"
          : "PARALLEL"
        : phase === "review"
          ? lang === "zh"
            ? "互懟"
            : "REVIEW"
          : lang === "zh"
            ? "議長"
            : "CHAIR";
  const micro = `GATE ${stats.awake}/7 ACTIVE${stats.save ? ` · -${stats.save}% TOKENS` : ""} · ${stats.critiques} CRITIQUES · ${phaseWord}`;
  const progress = script.length ? Math.min(100, Math.round((index / script.length) * 100)) : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="spark" aria-hidden="true">
            <canvas ref={markRef} />
          </span>
          <div>
            <div className="name">Grok Council</div>
            <div className="badge">{copy.kicker}</div>
          </div>
        </div>
        <div className="top-side">
          <a className="quiet" href="https://portfolio.oece-x.com">
            {copy.portfolio}
          </a>
          <a className="quiet" href="https://github.com/web3-ai-game/grok-council">
            {copy.source}
          </a>
          <div className="lang" role="group" aria-label={copy.language}>
            <button type="button" aria-pressed={lang === "en"} onClick={() => chooseLang("en")}>
              EN
            </button>
            <button type="button" aria-pressed={lang === "zh"} onClick={() => chooseLang("zh")}>
              繁
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="copy">
            <div className="topics" role="group" aria-label={lang === "zh" ? "議題" : "Topics"}>
              {TOPICS.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={topic.id === scenarioId}
                  onClick={() => {
                    setScenarioId(topic.id);
                    setRunId((value) => value + 1);
                  }}
                >
                  {lang === "zh" ? topic.zh : topic.en}
                </button>
              ))}
            </div>
            <p className="fine">{side.question}</p>
            <p className="score" id="score" ref={scoreRef} aria-live="polite">
              {stats.awake}/8
            </p>
            <p className="groups">{micro}</p>
            <div className="track" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="pills">
              {PHASES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={pillOn(phase, item.id)}
                  onClick={() => land(item.id)}
                >
                  {lang === "zh" ? item.zh : item.en}
                </button>
              ))}
              <button type="button" className="jump" onClick={() => land("synth")}>
                {copy.jump}
              </button>
            </div>
            <aside className="chair">
              <p className="kicker">{copy.chair}</p>
              <p className={chair?.content ? "verdict" : "verdict wait"}>{chair?.content ? flat(chair.content) : copy.wait}</p>
            </aside>
          </div>
          <div className="orb">
            <Arena phase={phase} experts={experts} focus={focus} lang={lang} onFocus={setFocus} />
            <p className="readout" id="readout">
              {readout}
            </p>
          </div>
        </section>

        <section className="report">
          <div className="report-head">
            <span>{copy.stream}</span>
            <div className="tools">
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                {copy.all}
              </button>
              <button type="button" aria-pressed={filter === "cuts"} onClick={() => setFilter("cuts")}>
                {copy.cuts}
              </button>
              <button type="button" aria-pressed={speed === 1} onClick={() => setSpeed(1)}>
                1x
              </button>
              <button type="button" aria-pressed={speed === 2} onClick={() => setSpeed(2)}>
                2x
              </button>
              <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
                {paused ? copy.resume : copy.pause}
              </button>
              <button type="button" onClick={replay}>
                {copy.replay}
              </button>
            </div>
          </div>
          <div className="feed" role="list">
            {rows.length === 0 ? (
              <p className="line info">{copy.noCuts}</p>
            ) : (
              rows.map((seat) => {
                const row = rowOf(seat.id);
                const thought = reasoningOf(seat.id);
                const position = flat(row.content);
                const woken = row.status !== "pending" && row.status !== "standby";
                const argued = Boolean(row.content);
                const cut = Boolean(row.reviewTarget || row.review || row.critiquing);
                const third =
                  seat.id === "leader"
                    ? copy.verdictStep
                    : row.reviewTarget
                      ? `${copy.cut}${lang === "zh" ? "" : " "}${seatShort(row.reviewTarget, lang)}`
                      : copy.cut;
                return (
                  <button
                    key={seat.id}
                    id={`seat-${seat.id}`}
                    type="button"
                    role="listitem"
                    className={focus === seat.id ? "line on" : "line"}
                    onClick={() => setFocus(seat.id)}
                  >
                    <span className="who">
                      <strong>{seatShort(seat.id, lang)}</strong>
                      <em>{statusOf(row)}</em>
                    </span>
                    <span className="mid">
                      <span>{thought || "—"}</span>
                      <strong>{position || "—"}</strong>
                    </span>
                    <span className="steps">
                      <b className={woken ? "on" : ""}>{copy.wake}</b>
                      <i>→</i>
                      <b className={argued ? "on" : ""}>{seat.id === "leader" ? copy.verdictStep : copy.argue}</b>
                      <i>→</i>
                      <b className={seat.id === "leader" ? (row.status === "done" ? "on" : "") : cut ? "on" : ""}>
                        {seat.id === "leader" ? copy.fold : third}
                      </b>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
