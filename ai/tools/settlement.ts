// Single-settlement parliamentary results.
//
// These answer "results IN one named settlement" ("резултатите в с. Иново"),
// which is the per-place counterpart to nationalResults — distinct from the
// party-BLIND winners drill-downs in winners.ts (which list every settlement of a
// município + the leading party) and from settlementBreakdown in electionDepth.ts
// (one party shaded across a município's settlements). Both read the same
// per-município settlement bundle the winners tools use, then narrow to one
// EKATTE:
//   - settlementResults: the full party table for one election (votes, %, + a
//     locator map highlighting the village on its município map).
//   - settlementHistory:  that settlement's per-party vote SHARE across the last N
//     elections/years (a multi-line trend, parties threaded by canonical lineage
//     so ГЕРБ→ГЕРБ-СДС stays one line — mirrors seatsHistory).

import { resolveElection } from "./args";
import {
  fetchCanonicalParties,
  fetchData,
  fetchNationalSummary,
} from "./dataClient";
import { electionsChrono, round2 } from "./dataset";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
import { settlementLocator } from "./geo";
import { loadMunis, resolveSettlement } from "./place";
import type { PlaceMatch } from "./place";
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
  name?: string;
  color?: string;
};

type SettlementVoteRow = {
  ekatte: string;
  name: string;
  t_v_m?: string;
  obshtina: string;
  results: {
    votes: { partyNum: number; totalVotes: number }[];
    protocol?: { numRegisteredVoters?: number; totalActualVoters?: number };
  };
};

// resolveSettlement spreads the settlements.json row, so the resolved place
// carries `tvm` ("с." / "гр.") at runtime even though PlaceMatch doesn't declare
// it. Prefix it in BG ("с. Иново"); EN just uses the romanized name.
const settlementLabel = (place: PlaceMatch, lang: Lang): string => {
  const name = lang === "bg" ? place.name : place.nameEn || place.name;
  const tvm = (place as PlaceMatch & { tvm?: string }).tvm;
  return lang === "bg" && tvm ? `${tvm} ${name}` : name;
};

const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s.\-_/'’`()]+/g, "")
    .trim();

const noData = (
  tool: string,
  title: string,
  provenance: string[],
  facts: Record<string, string | number> = {},
): Envelope => ({
  tool,
  domain: "elections",
  kind: "scalar",
  title,
  viz: "none",
  facts,
  provenance,
});

// Find one settlement's vote row inside its município bundle: EKATTE first
// (stable, exact), name as a fallback for the rare EKATTE mismatch.
const findRow = (
  rows: SettlementVoteRow[],
  place: PlaceMatch,
): SettlementVoteRow | undefined =>
  rows.find((r) => r.ekatte === place.ekatte) ??
  rows.find((r) => normName(r.name) === normName(place.name));

const MAX_RESULT_ROWS = 12;

export const settlementResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const place = await resolveSettlement(query);
  if (!place)
    return noData(
      "settlementResults",
      bg
        ? `Не намерих населено място „${query}“`
        : `No settlement matched "${query}"`,
      [`${election}/settlements/by/*.json`],
      { query },
    );

  const label = settlementLabel(place, ctx.lang);
  const rows = await fetchData<SettlementVoteRow[]>(
    `/${election}/settlements/by/${place.obshtina}.json`,
  ).catch(() => [] as SettlementVoteRow[]);
  const row = findRow(rows, place);
  if (!row || !row.results?.votes?.length)
    return noData(
      "settlementResults",
      bg
        ? `Няма данни за ${label} (${electionFullLabel(election, "bg")})`
        : `No data for ${label} (${electionFullLabel(election, "en")})`,
      [`${election}/settlements/by/${place.obshtina}.json`],
      { place: label, election: electionFullLabel(election, ctx.lang) },
    );

  const [ns, munis] = await Promise.all([
    fetchNationalSummary<{ parties: NSParty[] }>(election),
    loadMunis(),
  ]);
  const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
  const total = row.results.votes.reduce((s, v) => s + (v.totalVotes ?? 0), 0);
  const ranked = row.results.votes
    .filter((v) => (v.totalVotes ?? 0) > 0)
    .map((v) => {
      const p = byNum.get(v.partyNum);
      return {
        party: p?.nickName ?? `#${v.partyNum}`,
        votes: v.totalVotes,
        pct: total > 0 ? round2((100 * v.totalVotes) / total) : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);
  const top = ranked.slice(0, MAX_RESULT_ROWS);

  const muni = munis.find((m) => m.obshtina === place.obshtina);
  const muniName = muni ? (bg ? muni.name : muni.nameEn) : "";
  const proto = row.results.protocol ?? {};
  const reg = proto.numRegisteredVoters ?? 0;
  const act = proto.totalActualVoters ?? 0;
  const turnout = reg > 0 ? round2((100 * act) / reg) : null;

  const columns: Column[] = [
    { key: "party", label: bg ? "Партия" : "Party" },
    {
      key: "votes",
      label: bg ? "Гласове" : "Votes",
      numeric: true,
      format: "int",
    },
    { key: "pct", label: "%", numeric: true, format: "pct" },
  ];
  const rowsOut: Row[] = top.map((r) => ({
    party: r.party,
    votes: r.votes,
    pct: r.pct,
  }));

  const facts: Record<string, string | number> = {
    settlement: label,
    municipality: muniName,
    region: place.oblastName[ctx.lang],
    election: electionFullLabel(election, ctx.lang),
    leading_party: top[0]?.party ?? "—",
    leading_pct: top[0] ? fmtPct(top[0].pct, ctx.lang) : "—",
    total_votes: fmtInt(total, ctx.lang),
  };
  if (turnout != null) facts.turnout = fmtPct(turnout, ctx.lang);
  top.slice(0, 5).forEach((r) => {
    facts[r.party] =
      `${fmtInt(r.votes, ctx.lang)} (${fmtPct(r.pct, ctx.lang)})`;
  });

  return {
    tool: "settlementResults",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Резултати — ${label} (${electionFullLabel(election, "bg")})`
      : `Results — ${label} (${electionFullLabel(election, "en")})`,
    subtitle: muniName
      ? bg
        ? `Община ${muniName} · ${place.oblastName.bg}`
        : `${muniName} municipality · ${place.oblastName.en}`
      : undefined,
    columns,
    rows: rowsOut,
    categories: top.map((r) => r.party),
    series: [
      {
        key: "votes",
        label: bg ? "Гласове" : "Votes",
        points: top.map((r) => ({ x: r.party, y: r.votes })),
      },
    ],
    viz: "bar",
    geo: settlementLocator(place.ekatte, place.obshtina, label),
    facts,
    provenance: [
      `${election}/settlements/by/${place.obshtina}.json`,
      `${election}/national_summary.json`,
    ],
  };
};

// --- per-settlement vote share across elections (the trend) ------------------

type CanonParty = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color?: string;
};
type Canonical = { parties: CanonParty[]; byNickName?: Record<string, string> };

const MAX_TREND_LINES = 6;

const parseNum = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// Elections in scope (chronological). A `years` arg is a DATE window (Bulgaria
// holds several elections a year, so "last 5 years" ≠ "last 5 elections"); a bare
// `n` takes the last N; neither = the full history. Mirrors series.ts/national.ts.
const pickWindow = (
  years?: number,
  n?: number,
): ReturnType<typeof electionsChrono> => {
  const chrono = electionsChrono();
  if (years != null) {
    const latest = chrono[chrono.length - 1]?.name ?? "";
    const y = Number(latest.slice(0, 4));
    if (!y) return chrono;
    const cutoff = `${y - years}${latest.slice(4)}`;
    return chrono.filter((e) => e.name >= cutoff);
  }
  if (n != null) return chrono.slice(Math.max(0, chrono.length - n));
  return chrono;
};

type TrendLine = {
  name: string;
  nameEn?: string;
  color?: string;
  votesByEl: Map<string, number>;
};

export const settlementHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const place = await resolveSettlement(query);
  if (!place)
    return noData(
      "settlementHistory",
      bg
        ? `Не намерих населено място „${query}“`
        : `No settlement matched "${query}"`,
      [`*/settlements/by/*.json`],
      { query },
    );

  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickWindow(years, n); // oldest → newest
  const label = settlementLabel(place, ctx.lang);

  // Per election: the settlement's votes-by-nickName + its total (or zeros when
  // the settlement has no row that election — its line just goes null there).
  const [perEl, canon] = await Promise.all([
    Promise.all(
      picked.map(async (e) => {
        try {
          const [rows, ns] = await Promise.all([
            fetchData<SettlementVoteRow[]>(
              `/${e.name}/settlements/by/${place.obshtina}.json`,
            ),
            fetchNationalSummary<{ parties: NSParty[] }>(e.name),
          ]);
          const row = findRow(rows, place);
          if (!row)
            return { el: e.name, total: 0, byNick: new Map<string, number>() };
          const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
          const byNick = new Map<string, number>();
          let total = 0;
          row.results.votes.forEach((v) => {
            const votes = v.totalVotes ?? 0;
            total += votes;
            const p = byNum.get(v.partyNum);
            if (p && votes > 0)
              byNick.set(p.nickName, (byNick.get(p.nickName) ?? 0) + votes);
          });
          return { el: e.name, total, byNick };
        } catch {
          return { el: e.name, total: 0, byNick: new Map<string, number>() };
        }
      }),
    ),
    fetchCanonicalParties<Canonical>(),
  ]);

  const totalByEl = new Map(perEl.map((s) => [s.el, s.total]));
  const byId = new Map(canon.parties.map((c) => [c.id, c]));
  const idByNick = canon.byNickName ?? {};

  // Group each election's parties into a canonical lineage line (renames/mergers
  // fold together); a party absent from the register keeps a standalone line.
  const lineMap = new Map<string, TrendLine>();
  perEl.forEach((snap) => {
    if (snap.total <= 0) return;
    snap.byNick.forEach((votes, nick) => {
      const id = idByNick[nick];
      const cp = id ? byId.get(id) : undefined;
      const key = id ?? `nick:${nick}`;
      let line = lineMap.get(key);
      if (!line) {
        line = {
          name: cp?.displayName ?? nick,
          nameEn: cp?.displayNameEn,
          color: cp?.color,
          votesByEl: new Map(),
        };
        lineMap.set(key, line);
      }
      line.votesByEl.set(snap.el, (line.votesByEl.get(snap.el) ?? 0) + votes);
      if (cp) {
        line.name = cp.displayName;
        line.nameEn = cp.displayNameEn;
        line.color = cp.color;
      }
    });
  });

  const share = (line: TrendLine, el: string): number | null => {
    const tot = totalByEl.get(el) ?? 0;
    if (tot <= 0 || !line.votesByEl.has(el)) return null;
    return round2((100 * (line.votesByEl.get(el) ?? 0)) / tot);
  };

  const lines = [...lineMap.values()];
  if (lines.length === 0)
    return noData(
      "settlementHistory",
      bg
        ? `Няма данни за ${label} в избрания период`
        : `No data for ${label} in the selected window`,
      picked.map((e) => `${e.name}/settlements/by/${place.obshtina}.json`),
      { settlement: label },
    );
  // Draw the most significant parties (peak share across the window), capped.
  const peakOf = (l: TrendLine): number =>
    Math.max(0, ...picked.map((e) => share(l, e.name) ?? 0));
  lines.sort((a, b) => peakOf(b) - peakOf(a));
  const shown = lines.slice(0, MAX_TREND_LINES);

  const categories = picked.map((e) => electionShortLabel(e.name, ctx.lang));
  const series = shown.map((l, i) => ({
    key: `s${i}`,
    label: ctx.lang === "bg" ? l.name : (l.nameEn ?? l.name),
    color: l.color,
    points: picked.map((e) => ({
      x: electionShortLabel(e.name, ctx.lang),
      y: share(l, e.name),
    })),
  }));

  // Range label: "since YYYY" for the whole history, else the requested window.
  const coversAll = picked.length >= electionsChrono().length;
  const startYear = picked[0]?.name.slice(0, 4) ?? "";
  const range = coversAll
    ? bg
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : years != null
      ? bg
        ? `последните ${years} години`
        : `last ${years} years`
      : bg
        ? `последните ${picked.length} избора`
        : `last ${picked.length} elections`;

  // Latest-election leader (for the headline) — the line with the top share in
  // the most recent ballot that has data.
  const latestEl = picked[picked.length - 1]?.name ?? "";
  const leaderLine = [...shown]
    .filter((l) => share(l, latestEl) != null)
    .sort((a, b) => (share(b, latestEl) ?? 0) - (share(a, latestEl) ?? 0))[0];

  const facts: Record<string, string | number> = {
    settlement: label,
    municipality:
      (await loadMunis()).find((m) => m.obshtina === place.obshtina)?.[
        bg ? "name" : "nameEn"
      ] ?? "",
    region: place.oblastName[ctx.lang],
    range,
    elections_count: picked.length,
    parties_shown: shown.length,
    latest_election: electionFullLabel(latestEl, ctx.lang),
  };
  if (years != null) facts.window_years = years;
  if (leaderLine) {
    const nm =
      ctx.lang === "bg"
        ? leaderLine.name
        : (leaderLine.nameEn ?? leaderLine.name);
    facts.leader = `${nm} (${fmtPct(share(leaderLine, latestEl) ?? 0, ctx.lang)})`;
  }
  // Per-party trajectory: first → latest share across the window.
  shown.forEach((l) => {
    const vals = picked
      .map((e) => share(l, e.name))
      .filter((v): v is number => v != null);
    const first = vals[0];
    const last = vals[vals.length - 1];
    const nm = ctx.lang === "bg" ? l.name : (l.nameEn ?? l.name);
    if (first == null || last == null) return;
    facts[nm] =
      first === last
        ? fmtPct(last, ctx.lang)
        : `${fmtPct(first, ctx.lang)} → ${fmtPct(last, ctx.lang)}`;
  });

  return {
    tool: "settlementHistory",
    domain: "elections",
    kind: "series",
    title: bg
      ? `Резултати по партии — ${label} (${range})`
      : `Results by party — ${label} (${range})`,
    subtitle: bg
      ? `Дял на гласовете през ${picked.length} избора`
      : `Vote share across ${picked.length} elections`,
    categories,
    series,
    viz: "line",
    geo: settlementLocator(place.ekatte, place.obshtina, label),
    facts,
    provenance: [
      "canonical_parties.json",
      ...picked.map((e) => `${e.name}/settlements/by/${place.obshtina}.json`),
    ],
  };
};
