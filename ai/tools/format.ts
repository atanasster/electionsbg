// Bilingual formatting helpers for tool output (titles, axis labels, facts).

import type { Lang } from "./types";

const MONTHS: Record<Lang, string[]> = {
  bg: [
    "яну",
    "фев",
    "мар",
    "апр",
    "май",
    "юни",
    "юли",
    "авг",
    "сеп",
    "окт",
    "ное",
    "дек",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
};

// "2026_04_19" -> { y:2026, m:4, d:19 }
const parseElection = (name: string): { y: number; m: number; d: number } => {
  const [y, m, d] = name.split("_").map((s) => parseInt(s, 10));
  return { y, m, d };
};

// Compact axis label, e.g. "апр 2026" / "Apr 2026".
export const electionShortLabel = (name: string, lang: Lang): string => {
  const { y, m } = parseElection(name);
  const mo = MONTHS[lang][(m || 1) - 1] ?? "";
  return `${mo} ${y}`;
};

// Full label, e.g. "19 апр 2026" / "Apr 19, 2026".
export const electionFullLabel = (name: string, lang: Lang): string => {
  const { y, m, d } = parseElection(name);
  const mo = MONTHS[lang][(m || 1) - 1] ?? "";
  return lang === "bg" ? `${d} ${mo} ${y}` : `${mo} ${d}, ${y}`;
};

const LOCALE: Record<Lang, string> = { bg: "bg-BG", en: "en-US" };

export const fmtInt = (n: number, lang: Lang): string =>
  n.toLocaleString(LOCALE[lang]);

export const fmtPct = (n: number | null, lang: Lang): string =>
  n == null
    ? lang === "bg"
      ? "няма данни"
      : "n/a"
    : `${n.toLocaleString(LOCALE[lang])}%`;

// Pick the bg/en member of a bilingual record.
export const pick = <T>(rec: { bg: T; en: T }, lang: Lang): T => rec[lang];
