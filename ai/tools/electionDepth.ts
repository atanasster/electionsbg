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

// ---- machine-vs-flash-memory reconciliation, per party ----------------------
// Answers "which parties lost/gained the most from flash-memory issues" by
// summing each party's official machine count vs its СУЕМГ flash-memory record
// across every section (region_votes carries machineVotes/suemgVotes per party).
// change = machineVotes − suemgVotes: negative = the official count came out
// below the flash record (votes removed), positive = above it (recovered, e.g.
// the missing-flash sections where the paper recount restored the tally).

type SuemgVote = {
  partyNum: number;
  totalVotes?: number;
  machineVotes?: number;
  suemgVotes?: number;
  paperVotes?: number;
};
type SuemgRegion = { key: string; results?: { votes?: SuemgVote[] } };

export const flashMemoryByParty = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const [regions, ns] = await Promise.all([
    fetchRegionVotes<SuemgRegion[]>(election),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const names = new Map(ns.parties.map((p) => [p.partyNum, p.nickName]));
  const tally = new Map<number, { machine: number; flash: number }>();
  for (const r of regions) {
    for (const v of r.results?.votes ?? []) {
      if (v.machineVotes == null && v.suemgVotes == null) continue;
      const cur = tally.get(v.partyNum) ?? { machine: 0, flash: 0 };
      cur.machine += v.machineVotes ?? 0;
      cur.flash += v.suemgVotes ?? 0;
      tally.set(v.partyNum, cur);
    }
  }
  const all = [...tally]
    .map(([num, t]) => ({
      party: names.get(num) ?? `#${num}`,
      machine: t.machine,
      flash: t.flash,
      delta: t.machine - t.flash,
    }))
    .filter((r) => (r.machine || r.flash) && r.delta !== 0);

  if (all.length === 0) {
    return {
      tool: "flashMemoryByParty",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма разлики от флаш памет по партия — ${electionFullLabel(election, "bg")}`
        : `No flash-memory differences by party — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/region_votes.json`],
    };
  }

  const signed = (n: number): string =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtInt(Math.abs(n), ctx.lang)}`;
  const byLoss = [...all].sort((a, b) => a.delta - b.delta); // most negative first
  const biggestLoser = byLoss[0];
  const biggestGainer = byLoss[byLoss.length - 1];
  // show the parties with the largest absolute reconciliation, losers on top
  const top = [...all]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 14)
    .sort((a, b) => a.delta - b.delta);

  const rows: Row[] = top.map((r) => ({
    party: r.party,
    machine: r.machine,
    flash: r.flash,
    delta: signed(r.delta),
  }));
  return {
    tool: "flashMemoryByParty",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Машинни гласове срещу флаш памет по партия — ${electionFullLabel(election, "bg")}`
      : `Machine votes vs flash memory by party — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Разлика между официалното машинно преброяване и записа от флаш паметта (СУЕМГ), сумирана по партия за всички секции"
      : "Difference between the official machine count and the СУЕМГ flash-memory record, summed per party across all sections",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "machine",
        label: bg ? "Машинни" : "Machine",
        numeric: true,
        format: "int",
      },
      {
        key: "flash",
        label: bg ? "Флаш памет" : "Flash memory",
        numeric: true,
        format: "int",
      },
      {
        key: "delta",
        label: bg ? "Разлика" : "Change",
        numeric: true,
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      biggest_loser: biggestLoser
        ? `${biggestLoser.party} (${signed(biggestLoser.delta)})`
        : "—",
      biggest_gainer:
        biggestGainer && biggestGainer.delta > 0
          ? `${biggestGainer.party} (${signed(biggestGainer.delta)})`
          : "—",
    },
    provenance: [`${election}/region_votes.json`],
  };
};

// ---- machine-vote adoption, per party ---------------------------------------
// Answers "which parties vote on machines vs paper" by summing each party's
// machine and paper votes across every section. share = machine / (machine +
// paper): older/rural electorates skew to paper, urban/reformist to machines.

export const machineVoteByParty = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const [regions, ns] = await Promise.all([
    fetchRegionVotes<SuemgRegion[]>(election),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const names = new Map(ns.parties.map((p) => [p.partyNum, p.nickName]));
  const tally = new Map<number, { machine: number; paper: number }>();
  for (const r of regions) {
    for (const v of r.results?.votes ?? []) {
      if (v.machineVotes == null && v.paperVotes == null) continue;
      const cur = tally.get(v.partyNum) ?? { machine: 0, paper: 0 };
      cur.machine += v.machineVotes ?? 0;
      cur.paper += v.paperVotes ?? 0;
      tally.set(v.partyNum, cur);
    }
  }
  // drop fringe noise: a party needs a meaningful vote volume for its share to
  // mean anything
  const MIN_VOTES = 5000;
  const all = [...tally]
    .map(([num, t]) => {
      const total = t.machine + t.paper;
      return {
        party: names.get(num) ?? `#${num}`,
        machine: t.machine,
        paper: t.paper,
        share: total > 0 ? round2((100 * t.machine) / total) : 0,
        total,
      };
    })
    .filter((r) => r.total >= MIN_VOTES);

  if (all.length === 0) {
    return {
      tool: "machineVoteByParty",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за машинно гласуване по партия — ${electionFullLabel(election, "bg")}`
        : `No machine-vote-by-party data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/region_votes.json`],
    };
  }

  all.sort((a, b) => b.share - a.share);
  const top = all.slice(0, 16);
  const highest = all[0];
  const lowest = all[all.length - 1];
  const rows: Row[] = top.map((r) => ({
    party: r.party,
    machine: r.machine,
    paper: r.paper,
    share: r.share,
  }));
  return {
    tool: "machineVoteByParty",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Машинно срещу хартиено гласуване по партия — ${electionFullLabel(election, "bg")}`
      : `Machine vs paper voting by party — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Дял на машинните гласове от всички гласове за партията (по секции)"
      : "Share of each party's votes cast on a machine (across all sections)",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "machine",
        label: bg ? "Машинни" : "Machine",
        numeric: true,
        format: "int",
      },
      {
        key: "paper",
        label: bg ? "Хартиени" : "Paper",
        numeric: true,
        format: "int",
      },
      {
        key: "share",
        label: bg ? "Машинен дял" : "Machine %",
        numeric: true,
        format: "pct",
      },
    ],
    rows,
    categories: rows.map((r) => String(r.party)),
    series: [
      {
        key: "share",
        label: bg ? "Машинен дял" : "Machine %",
        points: rows.map((r) => ({ x: String(r.party), y: r.share as number })),
      },
    ],
    viz: "bar",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      most_machine: highest
        ? `${highest.party} (${fmtPct(highest.share, ctx.lang)})`
        : "—",
      most_paper: lowest
        ? `${lowest.party} (${fmtPct(lowest.share, ctx.lang)})`
        : "—",
    },
    provenance: [`${election}/region_votes.json`],
  };
};

// ---- wasted (below-threshold) votes, per party ------------------------------
// "which party wasted the most votes" — rank the parties that fell below the 4%
// threshold by the votes that didn't translate into seats (national_summary
// already carries the below-threshold party list).

type WastedNS = {
  wastedVotes?: {
    wastedVotes?: number;
    share?: number;
    parties?: { partyNum: number; totalVotes: number; pct: number }[];
  };
  parties: NSParty[];
};

export const wastedVotesByParty = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const ns = await fetchNationalSummary<WastedNS>(election);
  const names = new Map(ns.parties.map((p) => [p.partyNum, p.nickName]));
  const list = ns.wastedVotes?.parties ?? [];
  if (list.length === 0) {
    return {
      tool: "wastedVotesByParty",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма прахосани гласове под прага — ${electionFullLabel(election, "bg")}`
        : `No below-threshold wasted votes — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/national_summary.json`],
    };
  }
  const ranked = [...list]
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 14);
  const rows: Row[] = ranked.map((p) => ({
    party: names.get(p.partyNum) ?? `#${p.partyNum}`,
    votes: p.totalVotes,
    pct: round2(p.pct),
  }));
  const top = ranked[0];
  return {
    tool: "wastedVotesByParty",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Прахосани гласове по партия (под прага) — ${electionFullLabel(election, "bg")}`
      : `Wasted votes by party (below threshold) — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Партии под 4% прага, подредени по брой гласове, които не дадоха мандат"
      : "Parties below the 4% threshold, ranked by votes that won no seat",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "votes",
        label: bg ? "Гласове" : "Votes",
        numeric: true,
        format: "int",
      },
      { key: "pct", label: "%", numeric: true, format: "pct" },
    ],
    rows,
    categories: rows.map((r) => String(r.party)),
    series: [
      {
        key: "votes",
        label: bg ? "Гласове" : "Votes",
        points: rows.map((r) => ({ x: String(r.party), y: r.votes as number })),
      },
    ],
    viz: "bar",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      top_wasted: top
        ? `${names.get(top.partyNum) ?? `#${top.partyNum}`} (${fmtInt(top.totalVotes, ctx.lang)})`
        : "—",
      total_wasted: fmtInt(ns.wastedVotes?.wastedVotes ?? 0, ctx.lang),
      share:
        ns.wastedVotes?.share != null
          ? fmtPct(ns.wastedVotes.share, ctx.lang)
          : "—",
    },
    provenance: [`${election}/national_summary.json`],
  };
};

// ---- recount reconciliation, per party --------------------------------------
// "which parties gained/lost from the recount" — region_votes carries an
// `original` (pre-recount) block with per-party added/removed votes. Only
// elections with a manual recount (e.g. 2024-10-27) populate it; the rest return
// a no-recount scalar.

type RecountVote = {
  partyNum: number;
  addedVotes?: number;
  removedVotes?: number;
};
type RecountRegion = { key: string; original?: { votes?: RecountVote[] } };

export const recountByParty = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const [regions, ns] = await Promise.all([
    fetchRegionVotes<RecountRegion[]>(election),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const names = new Map(ns.parties.map((p) => [p.partyNum, p.nickName]));
  const tally = new Map<number, { added: number; removed: number }>();
  for (const r of regions) {
    for (const v of r.original?.votes ?? []) {
      const added = v.addedVotes ?? 0;
      const removed = v.removedVotes ?? 0; // stored negative
      if (added === 0 && removed === 0) continue;
      const cur = tally.get(v.partyNum) ?? { added: 0, removed: 0 };
      cur.added += added;
      cur.removed += removed;
      tally.set(v.partyNum, cur);
    }
  }
  const all = [...tally].map(([num, t]) => ({
    party: names.get(num) ?? `#${num}`,
    added: t.added,
    removed: t.removed,
    net: t.added + t.removed,
  }));

  if (all.length === 0) {
    return {
      tool: "recountByParty",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма преброяване наново — ${electionFullLabel(election, "bg")}`
        : `No recount — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/region_votes.json`],
    };
  }

  const signed = (n: number): string =>
    `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtInt(Math.abs(n), ctx.lang)}`;
  const byLoss = [...all].sort((a, b) => a.net - b.net); // most negative first
  const biggestLoser = byLoss[0];
  const biggestGainer = byLoss[byLoss.length - 1];
  const top = [...all]
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 14)
    .sort((a, b) => a.net - b.net);
  const rows: Row[] = top.map((r) => ({
    party: r.party,
    added: r.added,
    removed: Math.abs(r.removed),
    change: signed(r.net),
  }));
  return {
    tool: "recountByParty",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Преброяване наново по партия — ${electionFullLabel(election, "bg")}`
      : `Recount changes by party — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Промяна в гласовете на всяка партия след ръчното преброяване (добавени минус премахнати)"
      : "Each party's vote change after the manual recount (added minus removed)",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "added",
        label: bg ? "Добавени" : "Added",
        numeric: true,
        format: "int",
      },
      {
        key: "removed",
        label: bg ? "Премахнати" : "Removed",
        numeric: true,
        format: "int",
      },
      {
        key: "change",
        label: bg ? "Нетна промяна" : "Net change",
        numeric: true,
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      biggest_loser: biggestLoser
        ? `${biggestLoser.party} (${signed(biggestLoser.net)})`
        : "—",
      biggest_gainer:
        biggestGainer && biggestGainer.net > 0
          ? `${biggestGainer.party} (${signed(biggestGainer.net)})`
          : "—",
    },
    provenance: [`${election}/region_votes.json`],
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
