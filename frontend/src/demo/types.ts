export type SeatScript = {
  standby?: boolean;
  steps?: string[];
  reasoning?: string;
  answer?: string;
  review_target?: string;
  review?: string;
  error?: string;
};

export type ScriptSide = {
  title: string;
  question: string;
  seats: Record<string, SeatScript>;
  chair: {
    steps: string[];
    reasoning?: string;
    answer: string;
  };
};

export type ScenarioFile = {
  id: string;
  wake: "full" | "gated";
  zh: ScriptSide;
  en: ScriptSide;
};

export type Phase = "gate" | "parallel" | "review" | "synth" | "done";

export type TimedEvent = {
  at: number;
  seq: number;
  event: string;
  data: Record<string, unknown>;
};
