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

// Shared builder for a single-metric cross-election line series.
const buildMetricSeries = (opts: {
  tool: string;
  n: number;
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
  // take the last n (most recent) but keep chronological order for the x-axis
  const picked = chrono.slice(Math.max(0, chrono.length - opts.n));

  // title range: "since <year>" when the series covers the whole history,
  // otherwise "last N elections"
  const coversAll = picked.length >= chrono.length;
  const startYear = picked[0]?.name.slice(0, 4) ?? "";
  const range = coversAll
    ? { bg: `от ${startYear} насам`, en: `since ${startYear}` }
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
    lang: ctx.lang,
    seriesKey: "turnoutPct",
    seriesLabel: { bg: "Избирателна активност %", en: "Turnout %" },
    titleBase: {
      bg: "Избирателна активност",
      en: "Voter turnout",
    },
    value: turnoutPct,
  });
