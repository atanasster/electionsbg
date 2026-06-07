// Per-election national-result tools (fetch national_summary.json).

import { resolveElection } from "./args";
import {
  fetchCanonicalParties,
  fetchNationalSummary,
  fetchRegionVotes,
} from "./dataClient";
import { electionsChrono, round2 } from "./dataset";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
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

type OblastWinner = {
  code: string;
  label: string;
  color?: string;
  party: string; // leading party's nickName
  votes: number; // its votes in this oblast
  total: number; // total valid votes in this oblast
  pct: number; // its vote share in this oblast
};

// Leading party (by votes) per oblast. Powers both the winner-per-oblast
// choropleth (each area filled with its leading party's colour, matching the
// main site's map) and the per-region winners table.
const winnerByOblast = async (
  election: string,
  parties: NSParty[],
  lang: Lang,
): Promise<OblastWinner[]> => {
  const regions = await fetchRegionVotes<RegionVotes[]>(election);
  const byNum = new Map(parties.map((p) => [p.partyNum, p]));
  return regions
    .map((r) => {
      const total = r.results.votes.reduce(
        (s, v) => s + (v.totalVotes ?? 0),
        0,
      );
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
        party: p?.nickName ?? String(top.partyNum),
        votes: top.totalVotes,
        total,
        pct: total > 0 ? round2((100 * top.totalVotes) / total) : 0,
      };
    })
    .filter((a): a is NonNullable<typeof a> => !!a);
};

// The explicit-colour areas the winner choropleth wants (code/label/colour +
// the leading party's name as the tooltip display).
const winnerAreasFor = (winners: OblastWinner[]) =>
  winners.map((w) => ({
    code: w.code,
    label: w.label,
    color: w.color,
    display: w.party,
  }));

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

  const winners = await winnerByOblast(election, ns.parties, ctx.lang);

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
    geo: oblastChoropleth(winnerAreasFor(winners), {
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

// Per-region winners: a list of every oblast/МИР with the party that led there
// (votes + share), plus the same winner-per-oblast colour map. Answers the "by
// region" intent — distinct from nationalResults, which ranks parties nationally.
export const regionWinners = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const ns = await fetchNationalSummary<NationalSummary>(election);
  const winners = await winnerByOblast(election, ns.parties, ctx.lang);
  // Alphabetical by region name — a plain, scannable list of regions.
  const sorted = [...winners].sort((a, b) =>
    a.label.localeCompare(b.label, ctx.lang === "bg" ? "bg" : "en"),
  );

  const columns: Column[] = [
    { key: "oblast", label: ctx.lang === "bg" ? "Област" : "Region" },
    {
      key: "winner",
      label: ctx.lang === "bg" ? "Първа партия" : "Leading party",
    },
    {
      key: "votes",
      label: ctx.lang === "bg" ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rows: Row[] = sorted.map((w) => ({
    oblast: w.label,
    winner: w.party,
    votes: w.votes,
    pct: w.pct,
  }));

  // Which party led the most regions (and how many).
  const winsByParty = new Map<string, number>();
  winners.forEach((w) =>
    winsByParty.set(w.party, (winsByParty.get(w.party) ?? 0) + 1),
  );
  const ranked = [...winsByParty.entries()].sort((a, b) => b[1] - a[1]);
  const [leadParty, leadWins] = ranked[0] ?? ["—", 0];

  const facts: Record<string, string | number> = {
    election: electionFullLabel(election, ctx.lang),
    regions: winners.length,
    leading_party: leadParty,
    leading_wins: leadWins,
  };
  ranked.slice(0, 5).forEach(([name, n]) => {
    facts[name] = `${n} ${ctx.lang === "bg" ? "области" : "regions"}`;
  });

  return {
    tool: "regionWinners",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Резултати по области — ${electionFullLabel(election, "bg")}`
        : `Results by region — ${electionFullLabel(election, "en")}`,
    subtitle:
      ctx.lang === "bg"
        ? "Водещата партия във всяка област"
        : "The leading party in each region",
    columns,
    rows,
    viz: "none",
    geo: oblastChoropleth(winnerAreasFor(winners), {
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

// --- seats per party across elections (the trend behind the hemicycle) -------
// "Колко места има всяка партия последните N години" / "how many MPs each party
// has held over time". Threads each seated party across elections by its
// canonical lineage (so ГЕРБ→ГЕРБ-СДС, БСП→БСП-ОЛ stay one line) and draws a
// multi-line trend of seat counts. Distinct from `parliamentSeats`, which is a
// single-election hemicycle snapshot.

type CanonHistory = { election: string; partyNum: number; nickName: string };
type CanonParty = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color?: string;
  history: CanonHistory[];
};
type Canonical = { parties: CanonParty[]; byNickName?: Record<string, string> };

// How many party lines to draw — top by peak seats across the window. Eight is
// the readable ceiling for a multi-line chart; the rest are minor/transient.
const MAX_SEAT_LINES = 8;

const parseNum = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// Elections in scope (chronological, oldest→newest). A `years` arg is a DATE
// window (Bulgaria holds several elections a year, so "last 5 years" ≠ "last 5
// elections"); a bare `n` takes the last N; neither = the full history.
const pickSeatWindow = (
  years?: number,
  n?: number,
): ReturnType<typeof electionsChrono> => {
  const chrono = electionsChrono();
  if (years != null) {
    const latest = chrono[chrono.length - 1]?.name ?? "";
    const y = Number(latest.slice(0, 4));
    if (!y) return chrono;
    // Names are zero-padded "YYYY_MM_DD" → a lexical compare is a date compare.
    const cutoff = `${y - years}${latest.slice(4)}`;
    return chrono.filter((e) => e.name >= cutoff);
  }
  if (n != null) return chrono.slice(Math.max(0, chrono.length - n));
  return chrono;
};

type SeatLine = {
  name: string;
  nameEn?: string;
  color?: string;
  seatsByEl: Map<string, number>;
  peak: number;
};

export const seatsHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickSeatWindow(years, n);

  const [summaries, canon] = await Promise.all([
    Promise.all(
      picked.map((e) => fetchNationalSummary<NationalSummary>(e.name)),
    ),
    fetchCanonicalParties<Canonical>(),
  ]);

  const byId = new Map(canon.parties.map((c) => [c.id, c]));
  const idByNick = canon.byNickName ?? {};

  // Group each election's seated parties into a lineage line. The canonical id
  // (via byNickName) merges renames/SDS-style mergers; a party not in the
  // canonical register falls back to a standalone line keyed by its nickName, so
  // every seated party is represented (per-election totals stay exact).
  const lineMap = new Map<string, SeatLine>();
  picked.forEach((e, i) => {
    summaries[i].parties.forEach((p) => {
      if ((p.seats ?? 0) <= 0) return;
      const id = idByNick[p.nickName];
      const cp = id ? byId.get(id) : undefined;
      const key = id ?? `nick:${p.nickName}`;
      let line = lineMap.get(key);
      if (!line) {
        line = {
          name: cp?.displayName ?? p.nickName,
          nameEn: cp?.displayNameEn,
          color: cp?.color ?? p.color,
          seatsByEl: new Map(),
          peak: 0,
        };
        lineMap.set(key, line);
      }
      line.seatsByEl.set(
        e.name,
        (line.seatsByEl.get(e.name) ?? 0) + (p.seats ?? 0),
      );
      // The canonical record carries the party's latest branding (name/colour).
      if (cp) {
        line.name = cp.displayName;
        line.nameEn = cp.displayNameEn;
        line.color = cp.color;
      }
    });
  });

  const lines = [...lineMap.values()];
  lines.forEach((l) => {
    l.peak = Math.max(0, ...l.seatsByEl.values());
  });
  // Draw the most significant parties (peak seats), capped for readability.
  lines.sort((a, b) => b.peak - a.peak);
  const shown = lines.slice(0, MAX_SEAT_LINES);

  const categories = picked.map((e) => electionShortLabel(e.name, ctx.lang));
  const series = shown.map((l, i) => ({
    key: `s${i}`,
    label: ctx.lang === "bg" ? l.name : (l.nameEn ?? l.name),
    color: l.color,
    points: picked.map((e) => ({
      x: electionShortLabel(e.name, ctx.lang),
      y: l.seatsByEl.has(e.name) ? l.seatsByEl.get(e.name)! : null,
    })),
  }));

  // Range label: "since YYYY" for the whole history, else the requested window.
  const coversAll = picked.length >= electionsChrono().length;
  const startYear = picked[0]?.name.slice(0, 4) ?? "";
  const range = coversAll
    ? ctx.lang === "bg"
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : years != null
      ? ctx.lang === "bg"
        ? `последните ${years} години`
        : `last ${years} years`
      : ctx.lang === "bg"
        ? `последните ${picked.length} избора`
        : `last ${picked.length} elections`;

  // Latest-election leader, for the facts/narration headline.
  const latestEl = picked[picked.length - 1];
  const latestSeats = (name: SeatLine) =>
    name.seatsByEl.get(latestEl?.name ?? "");
  const leaderLine = latestEl
    ? [...lines]
        .filter((l) => latestSeats(l) != null)
        .sort((a, b) => (latestSeats(b) ?? 0) - (latestSeats(a) ?? 0))[0]
    : undefined;

  const facts: Record<string, string | number> = {
    range,
    elections_count: picked.length,
    parties_shown: shown.length,
    latest_election: latestEl
      ? electionFullLabel(latestEl.name, ctx.lang)
      : "—",
  };
  if (years != null) facts.window_years = years;
  if (leaderLine)
    facts.leader = `${ctx.lang === "bg" ? leaderLine.name : (leaderLine.nameEn ?? leaderLine.name)} (${latestSeats(leaderLine)})`;
  // Per-party trajectory: first→latest seats across the window.
  shown.forEach((l) => {
    const vals = picked
      .map((e) => l.seatsByEl.get(e.name))
      .filter((v): v is number => v != null);
    const first = vals[0];
    const last = vals[vals.length - 1];
    const label = ctx.lang === "bg" ? l.name : (l.nameEn ?? l.name);
    facts[label] =
      first === last
        ? `${last} ${ctx.lang === "bg" ? "места" : "seats"}`
        : `${first} → ${last} ${ctx.lang === "bg" ? "места" : "seats"}`;
  });

  return {
    tool: "seatsHistory",
    domain: "elections",
    kind: "series",
    title:
      ctx.lang === "bg"
        ? `Места в парламента по партия (${range})`
        : `Parliament seats by party (${range})`,
    subtitle:
      ctx.lang === "bg"
        ? `Мандати по партия през ${picked.length} избора`
        : `Seats per party across ${picked.length} elections`,
    categories,
    series,
    viz: "line",
    facts,
    provenance: [
      "canonical_parties.json",
      ...picked.map((e) => `${e.name}/national_summary.json`),
    ],
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
