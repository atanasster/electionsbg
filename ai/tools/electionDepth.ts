// D4 — election analytical drill-down: regional breakdown, anomalies, per-oblast
// turnout history, vote transitions between elections.

import { resolveElection } from "./args";
import {
  fetchData,
  fetchNationalSummary,
  fetchRegionVotes,
} from "./dataClient";
import { ALL_ELECTIONS, round2 } from "./dataset";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
import { matchParty } from "./matchParty";
import { oblastName, resolveOblast } from "./place";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// ---- regional breakdown for one party ---------------------------------------

type NSParty = {
  partyNum: number;
  nickName: string;
  name?: string;
  commonName?: string[];
};
type RegionEntry = {
  key: string;
  results: { votes: { partyNum: number; totalVotes: number }[] };
};

export const regionBreakdown = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const query = String(args.party ?? "");
  const ns = await fetchNationalSummary<{ parties: NSParty[] }>(election);
  const party = matchParty(query, ns.parties);
  if (!party) {
    return {
      tool: "regionBreakdown",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма намерена партия „${query}“`
          : `No party matched "${query}"`,
      viz: "none",
      facts: { query, election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/national_summary.json`],
    };
  }
  const regions = await fetchRegionVotes<RegionEntry[]>(election);
  const rows = regions
    .map((r) => {
      const total = r.results.votes.reduce(
        (s, v) => s + (v.totalVotes ?? 0),
        0,
      );
      const got =
        r.results.votes.find((v) => v.partyNum === party.partyNum)
          ?.totalVotes ?? 0;
      return {
        code: r.key,
        oblast: oblastName(r.key)[ctx.lang],
        votes: got,
        pct: total > 0 ? round2((100 * got) / total) : 0,
      };
    })
    .filter((r) => r.votes > 0)
    .sort((a, b) => b.pct - a.pct);
  const top = rows.slice(0, 14);

  const columns: Column[] = [
    { key: "oblast", label: ctx.lang === "bg" ? "Област" : "Oblast" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const strongest = rows[0];
  const weakest = rows[rows.length - 1];
  return {
    tool: "regionBreakdown",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `${party.nickName} по области — ${electionFullLabel(election, "bg")}`
        : `${party.nickName} by oblast — ${electionFullLabel(election, "en")}`,
    columns,
    rows: top.map((r) => ({ oblast: r.oblast, votes: r.votes, pct: r.pct })),
    categories: top.map((r) => r.oblast),
    series: [
      {
        key: "pct",
        label: party.nickName,
        points: top.map((r) => ({ x: r.oblast, y: r.pct })),
      },
    ],
    viz: "bar",
    facts: {
      party: party.nickName,
      strongest: strongest
        ? `${strongest.oblast} (${fmtPct(strongest.pct, ctx.lang)})`
        : "—",
      weakest: weakest
        ? `${weakest.oblast} (${fmtPct(weakest.pct, ctx.lang)})`
        : "—",
    },
    provenance: [`${election}/region_votes.json`],
  } as Envelope;
};

// ---- election anomalies -----------------------------------------------------

type Anomalies = {
  total?: number;
  recount?: number;
  recountZeroVotes?: number;
  suemgAdded?: number;
  suemgRemoved?: number;
  suemgMissingFlash?: number;
  problemSections?: number;
};

export const electionAnomalies = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const ns = await fetchNationalSummary<{ anomalies?: Anomalies }>(election);
  const a = ns.anomalies ?? {};
  const defs: [keyof Anomalies, { bg: string; en: string }][] = [
    ["problemSections", { bg: "Проблемни секции", en: "Problem sections" }],
    ["recount", { bg: "Преброени наново", en: "Recounted" }],
    [
      "suemgAdded",
      { bg: "Машинни добавени гласове", en: "Machine votes added" },
    ],
    [
      "suemgRemoved",
      { bg: "Машинни премахнати гласове", en: "Machine votes removed" },
    ],
    [
      "suemgMissingFlash",
      { bg: "Липсваща флаш памет", en: "Missing flash memory" },
    ],
    [
      "recountZeroVotes",
      { bg: "Преброени с нулев вот", en: "Recount zero-vote" },
    ],
  ];
  const rows: Row[] = defs
    .filter(([k]) => (a[k] ?? 0) > 0)
    .map(([k, lab]) => ({ signal: lab[ctx.lang], count: a[k] ?? 0 }));
  return {
    tool: "electionAnomalies",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Сигнали и нередности — ${electionFullLabel(election, "bg")}`
        : `Anomaly signals — ${electionFullLabel(election, "en")}`,
    columns: [
      { key: "signal", label: ctx.lang === "bg" ? "Сигнал" : "Signal" },
      {
        key: "count",
        label: ctx.lang === "bg" ? "Брой" : "Count",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      total_flagged: a.total ?? 0,
      problem_sections: a.problemSections ?? 0,
    },
    provenance: [`${election}/national_summary.json`],
  };
};

// ---- per-oblast turnout history ---------------------------------------------

type RegionHistory = {
  region: string;
  history: { election: string; turnoutPct: number }[];
};

export const regionHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const obl = resolveOblast(String(args.oblast ?? ""));
  if (!obl) {
    return {
      tool: "regionHistory",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Не намерих област „${args.oblast ?? ""}“`
          : `No oblast matched "${args.oblast ?? ""}"`,
      viz: "none",
      facts: { query: String(args.oblast ?? "") },
      provenance: ["regions/*_history.json"],
    };
  }
  let h: RegionHistory;
  try {
    h = await fetchData<RegionHistory>(`/regions/${obl.code}_history.json`);
  } catch {
    return {
      tool: "regionHistory",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за ${obl.name.bg}`
          : `No data for ${obl.name.en}`,
      viz: "none",
      facts: { oblast: obl.name[ctx.lang] },
      provenance: [`regions/${obl.code}_history.json`],
    };
  }
  const pts = [...h.history].sort((a, b) =>
    a.election.localeCompare(b.election),
  );
  const last = pts[pts.length - 1];
  return {
    tool: "regionHistory",
    domain: "elections",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `Избирателна активност — ${obl.name.bg}`
        : `Voter turnout — ${obl.name.en}`,
    categories: pts.map((p) => electionShortLabel(p.election, ctx.lang)),
    series: [
      {
        key: "turnout",
        label: ctx.lang === "bg" ? "Активност %" : "Turnout %",
        points: pts.map((p) => ({
          x: electionShortLabel(p.election, ctx.lang),
          y: p.turnoutPct,
        })),
      },
    ],
    viz: "line",
    facts: {
      oblast: obl.name[ctx.lang],
      latest_turnout: last ? fmtPct(last.turnoutPct, ctx.lang) : "—",
      elections: pts.length,
    },
    provenance: [`regions/${obl.code}_history.json`],
  };
};

// ---- vote transitions between two consecutive elections ---------------------

type Node = { id: string; label: string; labelEn?: string };
type Flow = { from: string; to: string; votes: number };
type Transition = {
  matrix: { fromNodes: Node[]; toNodes: Node[]; flows: Flow[] };
};

export const voteTransitions = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const idx = ALL_ELECTIONS.findIndex((e) => e.name === election);
  const prior =
    idx >= 0 && idx < ALL_ELECTIONS.length - 1
      ? ALL_ELECTIONS[idx + 1]
      : undefined;
  if (!prior) {
    return {
      tool: "voteTransitions",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? "Няма предходен избор за сравнение"
          : "No prior election to compare",
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: ["transitions/"],
    };
  }
  const pair = `${prior.name}_${election}`;
  let t: Transition;
  try {
    t = await fetchData<Transition>(`/transitions/${pair}/national.json`);
  } catch {
    return {
      tool: "voteTransitions",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? `Няма данни за преливане ${electionShortLabel(prior.name, "bg")} → ${electionShortLabel(election, "bg")}`
          : `No transition data ${electionShortLabel(prior.name, "en")} → ${electionShortLabel(election, "en")}`,
      viz: "none",
      facts: {},
      provenance: [`transitions/${pair}/national.json`],
    };
  }
  const label = (id: string): string => {
    const n = [...t.matrix.fromNodes, ...t.matrix.toNodes].find(
      (x) => x.id === id,
    );
    return n ? (ctx.lang === "bg" ? n.label : (n.labelEn ?? n.label)) : id;
  };
  const switches = t.matrix.flows
    .filter((f) => f.from !== f.to && f.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 12);
  const rows: Row[] = switches.map((f) => ({
    from: label(f.from),
    to: label(f.to),
    votes: f.votes,
  }));
  const biggest = switches[0];
  return {
    tool: "voteTransitions",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Преливане на гласове ${electionShortLabel(prior.name, "bg")} → ${electionShortLabel(election, "bg")}`
        : `Vote transitions ${electionShortLabel(prior.name, "en")} → ${electionShortLabel(election, "en")}`,
    columns: [
      { key: "from", label: ctx.lang === "bg" ? "От" : "From" },
      { key: "to", label: ctx.lang === "bg" ? "Към" : "To" },
      {
        key: "votes",
        label: ctx.lang === "bg" ? "Гласове" : "Votes",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      pair: `${electionShortLabel(prior.name, "en")} → ${electionShortLabel(election, "en")}`,
      biggest: biggest
        ? `${label(biggest.from)} → ${label(biggest.to)} (${fmtInt(biggest.votes, ctx.lang)})`
        : "—",
    },
    provenance: [`transitions/${pair}/national.json`],
  };
};
