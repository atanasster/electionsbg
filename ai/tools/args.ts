// Small shared helpers for resolving common tool arguments.

import { ALL_ELECTIONS, isKnownElection } from "./dataset";
import type { ToolArgs, ToolContext } from "./types";

// Resolve an `election` arg to a known election name (YYYY_MM_DD), falling back
// to the context's selected election (which defaults to the latest).
//
// The arg isn't always an exact date. The keyword router pre-resolves it, but
// the LLM router can't know the exact ballot dates, so it emits a bare year
// ("2023") or a loose date ("2023-04-02", "April 2023"). We extract a 20xx year
// — plus a month, where present, to disambiguate multi-election years like
// 2021/2024 — and map it to the matching election (most recent in the year when
// no month is given, mirroring the keyword router's detectElection). Only an
// arg we can't place at all falls back to the selected election; before this,
// any non-exact election (e.g. "turnout in 2023") silently answered for the
// selected election instead.
export const resolveElection = (args: ToolArgs, ctx: ToolContext): string => {
  const a = args.election;
  if (typeof a !== "string" || !a) return ctx.election;
  if (isKnownElection(a)) return a;

  // No \b around the year: a partial internal name ("2021_07") has the year
  // flanked by underscores, which are word chars, so \b would find no boundary.
  const yearMatch = a.match(/20\d{2}/);
  if (!yearMatch) return ctx.election;
  const year = yearMatch[0];
  // ALL_ELECTIONS is newest-first, so inYear[0] is the most recent in the year.
  const inYear = ALL_ELECTIONS.filter((e) => e.name.startsWith(`${year}_`));
  if (!inYear.length) return ctx.election;

  // A month (01–12) AFTER the year — ISO-ish "2021-07", "2024_06_09" — picks the
  // exact ballot in a multi-election year (2021, 2024); a bare year takes the
  // most recent, like the keyword router's detectElection.
  const month = a.slice(yearMatch.index! + 4).match(/0[1-9]|1[0-2]/)?.[0];
  if (month) {
    const hit = inYear.find((e) => e.name.startsWith(`${year}_${month}`));
    if (hit) return hit.name;
  }
  return inYear[0].name;
};

// Resolve a positive integer count arg (e.g. "last N elections").
export const clampCount = (
  raw: unknown,
  fallback: number,
  max = 13,
): number => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};
