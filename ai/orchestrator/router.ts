// Deterministic intent router (the v1 fallback / no-model path).
//
// Maps a BG/EN question to { tool, args } using keyword + entity heuristics.
// This is intentionally simple: it's the safety net beneath the
// grammar-constrained LLM router (M3). When the model lands it replaces this as
// the primary, and this stays as the offline fallback.

import { ALL_ELECTIONS } from "../tools/dataset";
import type { ToolArgs, ToolContext } from "../tools/types";

export type Route = { tool: string; args: ToolArgs } | null;

// Longest-first so "пп-дб" wins over "пп", "герб-сдс" over "герб".
const PARTY_TOKENS = [
  "герб-сдс",
  "пп-дб",
  "възраждане",
  "величие",
  "герб",
  "дпс",
  "бсп",
  "итн",
  "вмро",
  "нфсб",
  "меч",
  "дсб",
  "пп",
  "дб",
  "gerb-sds",
  "vazrazhdane",
  "gerb",
  "dps",
  "bsp",
  "itn",
  "pp-db",
  "pp",
  "db",
].sort((a, b) => b.length - a.length);

const detectParty = (q: string): string | undefined =>
  PARTY_TOKENS.find((tok) => q.includes(tok));

// A bare year -> the most recent election in that year (heuristic; the LLM will
// disambiguate multi-election years like 2021 better in M3).
const detectElection = (q: string): string | undefined => {
  const m = q.match(/\b(20\d{2})\b/);
  if (!m) return undefined;
  const year = m[1];
  const inYear = ALL_ELECTIONS.filter((e) => e.name.startsWith(year));
  return inYear.length ? inYear[0].name : undefined; // ALL_ELECTIONS is newest-first
};

const detectCount = (q: string): number | undefined => {
  const m = q.match(/(\d{1,2})/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return n >= 2 && n <= 13 ? n : undefined;
};

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

const TREND = [
  "тренд",
  "trend",
  "през годините",
  "over time",
  "история",
  "history",
  "последните",
  "last",
  "всички",
  "all",
  "избори",
  "elections",
];

export const route = (question: string, ctx: ToolContext): Route => {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const party = detectParty(q);
  const election = detectElection(q);
  const count = detectCount(q);
  const isTrend = has(q, ...TREND) || (count !== undefined && count >= 2);
  const isMachine = has(q, "машин", "machine", "суемг", "suemg");
  const isTurnout = has(q, "активн", "turnout", "гласувал", "voters");
  const isCompare = has(q, "сравн", "compare", "срещу", " vs ", "спрямо");

  // 1. comparison of two elections
  if (isCompare) {
    const years = Array.from(q.matchAll(/\b(20\d{2})\b/g)).map((m) => m[1]);
    const pick = (y?: string) =>
      y ? ALL_ELECTIONS.find((e) => e.name.startsWith(y))?.name : undefined;
    const a = pick(years[0]);
    const b = pick(years[1]) ?? ctx.election;
    if (a) return { tool: "compareElections", args: { a, b } };
  }

  // 2. machine voting
  if (isMachine) {
    if (isTrend || !election)
      return { tool: "machineVoteSeries", args: count ? { n: count } : {} };
    return { tool: "machineVoteShare", args: { election } };
  }

  // 3. turnout
  if (isTurnout) {
    if (isTrend && !election)
      return { tool: "turnoutSeries", args: count ? { n: count } : {} };
    if (election) return { tool: "turnout", args: { election } };
    return { tool: "turnoutSeries", args: count ? { n: count } : {} };
  }

  // 4. a specific party
  if (party) {
    const wantsTimeline =
      has(q, "през годините", "over time", "история", "history", "timeline") ||
      (isTrend && !election);
    if (wantsTimeline) return { tool: "partyTimeline", args: { party } };
    return {
      tool: "partyResult",
      args: election ? { party, election } : { party },
    };
  }

  // 5. generic national results / "who won"
  if (
    has(q, "резултат", "result", "спечели", "won", "победител", "winner", "кой")
  ) {
    return { tool: "nationalResults", args: election ? { election } : {} };
  }

  return null;
};
