// Cross-election trend tools. All pure (bundled elections.json) -> no fetches.

import {
  electionsChrono,
  hadMachineVoting,
  machinePct,
  turnoutPct,
} from "./dataset";
import { electionFullLabel, electionShortLabel, fmtPct } from "./format";
import type { Envelope, ToolArgs, ToolContext } from "./types";

const DEFAULT_N = 7;

const clampN = (raw: unknown, fallback = DEFAULT_N): number => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 13);
};

// Shared builder for a single-metric cross-election line series.
const buildMetricSeries = (opts: {
  tool: string;
  n: number;
  lang: ToolContext["lang"];
  seriesKey: string;
  seriesLabel: { bg: string; en: string };
  title: { bg: string; en: string };
  value: (e: ReturnType<typeof electionsChrono>[number]) => number | null;
  onlyMachineElections?: boolean;
}): Envelope => {
  const { lang } = opts;
  let chrono = electionsChrono(); // oldest -> newest
  if (opts.onlyMachineElections) chrono = chrono.filter(hadMachineVoting);
  // take the last n (most recent) but keep chronological order for the x-axis
  const picked = chrono.slice(Math.max(0, chrono.length - opts.n));

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
    title: opts.title[lang],
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
    title: {
      bg: `Дял на машинното гласуване (последните ${clampN(args.n)} избора)`,
      en: `Machine voting share (last ${clampN(args.n)} elections)`,
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
    title: {
      bg: `Избирателна активност (последните ${clampN(args.n)} избора)`,
      en: `Voter turnout (last ${clampN(args.n)} elections)`,
    },
    value: turnoutPct,
  });
