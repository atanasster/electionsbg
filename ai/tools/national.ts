// Per-election national-result tools (fetch national_summary.json).

import { resolveElection } from "./args";
import { fetchNationalSummary, fetchRegionVotes } from "./dataClient";
import { electionFullLabel, fmtInt, fmtPct } from "./format";
import { oblastChoropleth } from "./geo";
import { matchParty } from "./matchParty";
import { oblastName } from "./place";
import type {
  Column,
  Envelope,
  Lang,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

type NSParty = {
  partyNum: number;
  nickName: string;
  name: string;
  color?: string;
  totalVotes: number;
  pct: number;
  seats?: number;
  passedThreshold?: boolean;
};

type NationalSummary = {
  election: string;
  turnout?: { actual: number; registered: number; pct: number };
  parties: NSParty[];
};

type RegionVotes = {
  key: string;
  results: { votes: { partyNum: number; totalVotes: number }[] };
};

// Winning party (by votes) per oblast → an explicit-colour choropleth (each area
// filled with its leading party's colour, matching the main site's map).
const winnerByOblast = async (
  election: string,
  parties: NSParty[],
  lang: Lang,
) => {
  const regions = await fetchRegionVotes<RegionVotes[]>(election);
  const byNum = new Map(parties.map((p) => [p.partyNum, p]));
  return regions
    .map((r) => {
      const top = r.results.votes.reduce<
        { partyNum: number; totalVotes: number } | undefined
      >(
        (best, v) => (v.totalVotes > (best?.totalVotes ?? 0) ? v : best),
        undefined,
      );
      if (!top || top.totalVotes <= 0) return null;
      const p = byNum.get(top.partyNum);
      return {
        code: r.key,
        label: oblastName(r.key)[lang],
        color: p?.color,
        display: p?.nickName ?? String(top.partyNum),
      };
    })
    .filter((a): a is NonNullable<typeof a> => !!a);
};

export const nationalResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const ns = await fetchNationalSummary<NationalSummary>(election);
  const parties = [...ns.parties].sort((a, b) => b.totalVotes - a.totalVotes);
  const top = parties.slice(0, 12);

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
    {
      key: "seats",
      label: ctx.lang === "bg" ? "Мандати" : "Seats",
      numeric: true,
      format: "int",
    },
  ];
  const rows: Row[] = top.map((p) => ({
    party: p.nickName,
    votes: p.totalVotes,
    pct: p.pct,
    seats: p.seats ?? 0,
  }));

  const facts: Record<string, string | number> = {
    election: electionFullLabel(election, ctx.lang),
    parties_over_threshold: parties.filter((p) => p.passedThreshold).length,
  };
  top.slice(0, 5).forEach((p) => {
    facts[p.nickName] =
      `${fmtInt(p.totalVotes, ctx.lang)} (${fmtPct(p.pct, ctx.lang)}), ${p.seats ?? 0} ${ctx.lang === "bg" ? "мандата" : "seats"}`;
  });

  const winnerAreas = await winnerByOblast(election, ns.parties, ctx.lang);

  return {
    tool: "nationalResults",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Национални резултати — ${electionFullLabel(election, "bg")}`
        : `National results — ${electionFullLabel(election, "en")}`,
    columns,
    rows,
    // also expose a bar series for the renderer if it prefers a chart
    categories: top.map((p) => p.nickName),
    series: [
      {
        key: "votes",
        label: ctx.lang === "bg" ? "Гласове" : "Votes",
        points: top.map((p) => ({ x: p.nickName, y: p.totalVotes })),
      },
    ],
    viz: "bar",
    // Winner-per-oblast map: each oblast filled with its leading party's colour.
    geo: oblastChoropleth(winnerAreas, {
      metricLabel: ctx.lang === "bg" ? "Първа партия" : "Leading party",
      colorMode: "explicit",
    }),
    facts,
    provenance: [
      `${election}/national_summary.json`,
      `${election}/region_votes.json`,
    ],
  };
};

// Current parliament composition: seats per party, drawn as a hemicycle. Seats
// come from the selected election's national_summary (the latest election by
// default — i.e. the sitting National Assembly).
export const parliamentSeats = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const ns = await fetchNationalSummary<NationalSummary>(election);
  // Only parties that actually won seats, largest bloc first (the fill order the
  // hemicycle sweeps left → right).
  const seated = ns.parties
    .filter((p) => (p.seats ?? 0) > 0)
    .sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0));
  const total = seated.reduce((sum, p) => sum + (p.seats ?? 0), 0);
  const majority = Math.floor(total / 2) + 1;
  const leader = seated[0];
  const hasMajority = !!leader && (leader.seats ?? 0) >= majority;

  const columns: Column[] = [
    { key: "party", label: ctx.lang === "bg" ? "Партия" : "Party" },
    {
      key: "seats",
      label: ctx.lang === "bg" ? "Места" : "Seats",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  // `color` rides along on each row for the hemicycle renderer; it isn't a
  // declared column, so the data table / CSV export ignore it.
  const rows: Row[] = seated.map((p) => ({
    party: p.nickName,
    seats: p.seats ?? 0,
    pct: p.pct,
    color: p.color ?? null,
  }));

  const facts: Record<string, string | number> = {
    election: electionFullLabel(election, ctx.lang),
    total_seats: total,
    majority,
    parties_seated: seated.length,
    leader: leader ? `${leader.nickName} (${leader.seats})` : "—",
    majority_status: hasMajority
      ? ctx.lang === "bg"
        ? `${leader!.nickName} има самостоятелно мнозинство`
        : `${leader!.nickName} holds an outright majority`
      : ctx.lang === "bg"
        ? "няма самостоятелно мнозинство"
        : "no single-party majority",
  };
  seated.forEach((p) => {
    facts[p.nickName] =
      `${p.seats ?? 0} ${ctx.lang === "bg" ? "места" : "seats"} (${fmtPct(p.pct, ctx.lang)})`;
  });

  return {
    tool: "parliamentSeats",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Места в парламента — ${electionFullLabel(election, "bg")}`
        : `Seats in parliament — ${electionFullLabel(election, "en")}`,
    subtitle:
      ctx.lang === "bg"
        ? `${total} мандата · мнозинство ${majority}`
        : `${total} seats · majority ${majority}`,
    columns,
    rows,
    viz: "hemicycle",
    facts,
    provenance: [`${election}/national_summary.json`],
  };
};

export const partyResult = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const query = String(args.party ?? "");
  const ns = await fetchNationalSummary<NationalSummary>(election);
  const p = matchParty(query, ns.parties);

  if (!p) {
    return {
      tool: "partyResult",
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

  return {
    tool: "partyResult",
    kind: "scalar",
    title:
      ctx.lang === "bg"
        ? `${p.nickName} — ${electionFullLabel(election, "bg")}`
        : `${p.nickName} — ${electionFullLabel(election, "en")}`,
    subtitle: p.name,
    viz: "none",
    facts: {
      party: p.nickName,
      votes: fmtInt(p.totalVotes, ctx.lang),
      pct: fmtPct(p.pct, ctx.lang),
      seats: p.seats ?? 0,
      passed_threshold: p.passedThreshold
        ? ctx.lang === "bg"
          ? "да"
          : "yes"
        : ctx.lang === "bg"
          ? "не"
          : "no",
      election: electionFullLabel(election, ctx.lang),
    },
    provenance: [`${election}/national_summary.json`],
  };
};
