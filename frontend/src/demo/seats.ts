export type Lang = "zh" | "en";

export type SeatId =
  | "analyst"
  | "researcher"
  | "engineer"
  | "critic"
  | "strategist"
  | "writer"
  | "quant"
  | "leader";

export type SeatMeta = {
  id: SeatId;
  emoji: string;
  zh: string;
  en: string;
  shortZh: string;
  shortEn: string;
};

export const SEATS: readonly SeatMeta[] = [
  { id: "analyst", emoji: "🔍", zh: "分析師", en: "Analyst", shortZh: "分析師", shortEn: "Analyst" },
  { id: "researcher", emoji: "🛰️", zh: "情報官", en: "Intel", shortZh: "情報官", shortEn: "Intel" },
  { id: "engineer", emoji: "🛠️", zh: "工程師", en: "Systems Engineer", shortZh: "工程師", shortEn: "Systems" },
  { id: "critic", emoji: "🧨", zh: "紅隊", en: "Red Team", shortZh: "紅隊", shortEn: "Red Team" },
  { id: "strategist", emoji: "🧭", zh: "策略家", en: "Strategist", shortZh: "策略家", shortEn: "Strategist" },
  { id: "writer", emoji: "✍️", zh: "表達者", en: "Communicator", shortZh: "表達者", shortEn: "Communicator" },
  { id: "quant", emoji: "🧮", zh: "量化員", en: "Quant", shortZh: "量化員", shortEn: "Quant" },
  { id: "leader", emoji: "⚖️", zh: "議長", en: "Chair", shortZh: "議長", shortEn: "Chair" },
] as const;

export const SEAT_BY_ID: Record<string, SeatMeta> = Object.fromEntries(
  SEATS.map((seat) => [seat.id, seat]),
);

export function seatName(id: string, lang: Lang): string {
  const seat = SEAT_BY_ID[id];
  if (!seat) return id;
  return lang === "en" ? seat.en : seat.zh;
}

export function seatShort(id: string, lang: Lang): string {
  const seat = SEAT_BY_ID[id];
  if (!seat) return id;
  return lang === "en" ? seat.shortEn : seat.shortZh;
}
