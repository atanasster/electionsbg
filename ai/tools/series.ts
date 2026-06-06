// Cross-election trend tools. All pure (bundled elections.json) -> no fetches.

import {
  electionsChrono,
  hadMachineVoting,
  machinePct,
  turnoutPct,
} from "./dataset";
import { electionFullLabel, electionShortLabel, fmtPct } from "./format";
import type { Envelope, ToolArgs, ToolContext } from "./types";

// Total elections in the bundled dataset (2005 -> latest). Default series show
// the FULL history since 2005 — capping at a smaller number silently dropped the
// 2005 election (the oldest), which the chart then appeared to "start" in 2009.
const totalElections = (): number => electionsChrono().length;

const clampN = (raw: unknown): number => {
  const total = totalElections();
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return total; // no count -> all elections
  return Math.min(n, total);
};

const parseYears = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// Elections within the last `years` years of the most recent election, kept in
// chronological order. "Last 7 years" is a DATE window, not a slice: it can hold
// more (or fewer) elections than "last 7 elections" since several are held a year.
// Election names are zero-padded "YYYY_MM_DD", so a lexical compare is a date
// compare — the cutoff keeps the same MM_DD and rolls the year back by `years`.
const pickByYears = <T extends { name: string }>(
  chrono: T[],
  years: number,
): T[] => {
  const latest = chrono[chrono.length - 1]?.name ?? "";
  const year = Number(latest.slice(0, 4));
  if (!year) return chrono;
  const cutoff = `${year - years}${latest.slice(4)}`; // "YYYY_MM_DD"
  return chrono.filter((e) => e.name >= cutoff);
};

// Shared builder for a single-metric cross-election line series.
const buildMetricSeries = (opts: {
  tool: string;
  n: number;
  years?: number;
  lang: ToolContext["lang"];
  seriesKey: string;
  seriesLabel: { bg: string; en: string };
  titleBase: { bg: string; en: string };
  value: (e: ReturnType<typeof electionsChrono>[number]) => number | null;
  onlyMachineElections?: boolean;
}): Envelope => {
  const { lang } = opts;
  let chrono = electionsChrono(); // oldest -> newest
  if (opts.onlyMachineElections) chrono = chrono.filter(hadMachineVoting);
  // a years window filters by date; otherwise take the last n (most recent).
  // either way keep chronological order for the x-axis.
  const picked =
    opts.years != null
      ? pickByYears(chrono, opts.years)
      : chrono.slice(Math.max(0, chrono.length - opts.n));

  // title range: "since <year>" when the series covers the whole history,
  // "last N years" for a date window, otherwise "last N elections"
  const coversAll = picked.length >= chrono.length;
  const startYear = picked[0]?.name.slice(0, 4) ?? "";
  const range = coversAll
    ? { bg: `от ${startYear} насам`, en: `since ${startYear}` }
    : opts.years != null
      ? {
          bg: `последните ${opts.years} години`,
          en: `last ${opts.years} years`,
        }
      : {
          bg: `последните ${picked.length} избора`,
          en: `last ${picked.length} elections`,
        };
  const title = `${opts.titleBase[lang]} (${range[lang]})`;

  const categories = picked.map((e) => electionShortLabel(e.name, lang));
  const points = picked.map((e) => ({
    x: electionShortLabel(e.name, lang),
    y: opts.value(e),
  }));

  const valued = points.filter((p) => p.y != null) as {
    x: string;
    y: number;
  }[];
  const latest = valued.length ? valued[valued.length - 1] : undefined;
  const earliest = valued.length ? valued[0] : undefined;

  const facts: Record<string, string | number> = {
    elections_count: picked.length,
  };
  if (opts.years != null) facts.window_years = opts.years;
  picked.forEach((e) => {
    const v = opts.value(e);
    facts[`${electionFullLabel(e.name, "en")}`] = v == null ? "n/a" : v;
  });
  if (latest) facts.latest = `${latest.x}: ${fmtPct(latest.y, lang)}`;
  if (earliest && latest)
    facts.change_pts = Math.round((latest.y - earliest.y) * 100) / 100;

  return {
    tool: opts.tool,
    kind: "series",
    title,
    categories,
    series: [
      {
        key: opts.seriesKey,
        label: opts.seriesLabel[lang],
        points,
      },
    ],
    viz: "line",
    facts,
    provenance: ["elections.json"],
  };
};

export const machineVoteSeries = (args: ToolArgs, ctx: ToolContext): Envelope =>
  buildMetricSeries({
    tool: "machineVoteSeries",
    n: clampN(args.n),
    years: parseYears(args.years),
    lang: ctx.lang,
    seriesKey: "machinePct",
    seriesLabel: { bg: "Машинно гласуване %", en: "Machine voting %" },
    titleBase: {
      bg: "Дял на машинното гласуване",
      en: "Machine voting share",
    },
    value: machinePct,
    onlyMachineElections: false,
  });

export const turnoutSeries = (args: ToolArgs, ctx: ToolContext): Envelope =>
  buildMetricSeries({
    tool: "turnoutSeries",
    n: clampN(args.n),
    years: parseYears(args.years),
    lang: ctx.lang,
    seriesKey: "turnoutPct",
    seriesLabel: { bg: "Избирателна активност %", en: "Turnout %" },
    titleBase: {
      bg: "Избирателна активност",
      en: "Voter turnout",
    },
    value: turnoutPct,
  });
