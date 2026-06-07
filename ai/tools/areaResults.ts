// Single-area parliamentary results: ONE município or ONE oblast (region) — the
// per-place counterparts to nationalResults at the muni/oblast tiers, siblings of
// settlementResults/sectionResults. They answer "резултатите в община Пловдив" /
// "резултатите в област Варна" / "резултатите в София" (Sofia city = the
// S23+S24+S25 МИР aggregate), which previously fell through to municipalityWinners
// (whole-oblast list) / regionWinners (national list) / nationalResults. Abroad
// (МИР "32") keeps its own diasporaVote/diasporaVoteTrend tools.
//
// NAMING: the oblast trend is `regionResultsTrend`, NOT `regionHistory` — that
// name is already the per-oblast TURNOUT trend. settlement/section/муни use the
// `*History` suffix; only the oblast tier collides, hence `*ResultsTrend` here.

import type { ElectionInfo } from "../../src/data/dataTypes";
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
import { muniLocator, oblastLocator } from "./geo";
import { resolveMunicipality, resolveOblast } from "./place";
import type {
  Column,
  Envelope,
  GeoOverlay,
  Lang,
  Row,
  ToolArgs,
  ToolContext,
} from "./types";

type VoteEntry = { partyNum: number; totalVotes: number };
type NSParty = {
  partyNum: number;
  nickName: string;
  name?: string;
  color?: string;
};
type Protocol = { numRegisteredVoters?: number; totalActualVoters?: number };
type VoteRow = { results: { votes: VoteEntry[]; protocol?: Protocol } };
type MuniVoteRow = { obshtina: string } & VoteRow;
type RegionVoteRow = { key: string } & VoteRow;

// Sofia city = the three city МИР (S23/S24/S25). resolveOblast("София") defaults
// to S23 alone, so the whole-city result must sum them; SFO (Sofia PROVINCE) is a
// separate place and stays a normal single oblast.
const SOFIA_CITY = "SOF_CITY";
const SOFIA_CITY_CODES = ["S23", "S24", "S25"];

const MAX_ROWS = 12;
const MAX_TREND_LINES = 6;

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

const parseNum = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// Sum a list of vote rows into one partyNum→votes map + total + turnout (for the
// Sofia-city aggregate; a single area is just a one-element list).
const aggregate = (
  rows: VoteRow[],
): { votes: Map<number, number>; total: number; reg: number; act: number } => {
  const votes = new Map<number, number>();
  let total = 0;
  let reg = 0;
  let act = 0;
  for (const r of rows) {
    for (const v of r.results.votes) {
      const n = v.totalVotes ?? 0;
      votes.set(v.partyNum, (votes.get(v.partyNum) ?? 0) + n);
      total += n;
    }
    reg += r.results.protocol?.numRegisteredVoters ?? 0;
    act += r.results.protocol?.totalActualVoters ?? 0;
  }
  return { votes, total, reg, act };
};

// Shared snapshot builder: a partyNum→votes map + party meta → the per-party
// table + bar + facts (mirrors settlementResults/nationalResults).
const resultsEnvelope = (opts: {
  tool: string;
  lang: Lang;
  title: string;
  subtitle?: string;
  votesByNum: Map<number, number>;
  total: number;
  reg: number;
  act: number;
  partyByNum: Map<number, NSParty>;
  geo?: GeoOverlay;
  provenance: string[];
  baseFacts: Record<string, string | number>;
}): Envelope => {
  const bg = opts.lang === "bg";
  const ranked = [...opts.votesByNum.entries()]
    .filter(([, votes]) => votes > 0)
    .map(([num, votes]) => {
      const p = opts.partyByNum.get(num);
      return {
        party: p?.nickName ?? `#${num}`,
        votes,
        pct: opts.total > 0 ? round2((100 * votes) / opts.total) : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);
  const top = ranked.slice(0, MAX_ROWS);
  const turnout = opts.reg > 0 ? round2((100 * opts.act) / opts.reg) : null;

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
  const rows: Row[] = top.map((r) => ({
    party: r.party,
    votes: r.votes,
    pct: r.pct,
  }));

  const facts: Record<string, string | number> = {
    ...opts.baseFacts,
    leading_party: top[0]?.party ?? "—",
    leading_pct: top[0] ? fmtPct(top[0].pct, opts.lang) : "—",
    total_votes: fmtInt(opts.total, opts.lang),
  };
  if (turnout != null) facts.turnout = fmtPct(turnout, opts.lang);
  top.slice(0, 5).forEach((r) => {
    facts[r.party] =
      `${fmtInt(r.votes, opts.lang)} (${fmtPct(r.pct, opts.lang)})`;
  });

  return {
    tool: opts.tool,
    domain: "elections",
    kind: "table",
    title: opts.title,
    subtitle: opts.subtitle,
    columns,
    rows,
    categories: top.map((r) => r.party),
    series: [
      {
        key: "votes",
        label: bg ? "Гласове" : "Votes",
        points: top.map((r) => ({ x: r.party, y: r.votes })),
      },
    ],
    viz: "bar",
    geo: opts.geo,
    facts,
    provenance: opts.provenance,
  };
};

// ---- canonical-lineage trend (shared by muni + region) ----------------------

type CanonParty = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color?: string;
};
type Canonical = { parties: CanonParty[]; byNickName?: Record<string, string> };

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

type ElSnap = { el: string; total: number; byNick: Map<string, number> };
type TrendLine = {
  name: string;
  nameEn?: string;
  color?: string;
  votesByEl: Map<string, number>;
};

// Build the multi-line vote-SHARE trend from per-election {total, byNick}
// snapshots + the canonical register (threads renames into one line). Mirrors
// settlementHistory/sectionHistory.
const trendEnvelope = (opts: {
  tool: string;
  lang: Lang;
  titleBase: { bg: string; en: string };
  picked: ElectionInfo[];
  perEl: ElSnap[];
  canon: Canonical;
  years?: number;
  geo?: GeoOverlay;
  provenance: string[];
  baseFacts: Record<string, string | number>;
  noDataTitle: string;
}): Envelope => {
  const bg = opts.lang === "bg";
  const totalByEl = new Map(opts.perEl.map((s) => [s.el, s.total]));
  const byId = new Map(opts.canon.parties.map((c) => [c.id, c]));
  const idByNick = opts.canon.byNickName ?? {};

  const lineMap = new Map<string, TrendLine>();
  opts.perEl.forEach((snap) => {
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
    return noData(opts.tool, opts.noDataTitle, opts.provenance, opts.baseFacts);

  const peakOf = (l: TrendLine): number =>
    Math.max(0, ...opts.picked.map((e) => share(l, e.name) ?? 0));
  lines.sort((a, b) => peakOf(b) - peakOf(a));
  const shown = lines.slice(0, MAX_TREND_LINES);

  const categories = opts.picked.map((e) =>
    electionShortLabel(e.name, opts.lang),
  );
  const series = shown.map((l, i) => ({
    key: `s${i}`,
    label: bg ? l.name : (l.nameEn ?? l.name),
    color: l.color,
    points: opts.picked.map((e) => ({
      x: electionShortLabel(e.name, opts.lang),
      y: share(l, e.name),
    })),
  }));

  const coversAll = opts.picked.length >= electionsChrono().length;
  const startYear = opts.picked[0]?.name.slice(0, 4) ?? "";
  const range = coversAll
    ? bg
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : opts.years != null
      ? bg
        ? `последните ${opts.years} години`
        : `last ${opts.years} years`
      : bg
        ? `последните ${opts.picked.length} избора`
        : `last ${opts.picked.length} elections`;

  const latestEl = opts.picked[opts.picked.length - 1]?.name ?? "";
  const leaderLine = [...shown]
    .filter((l) => share(l, latestEl) != null)
    .sort((a, b) => (share(b, latestEl) ?? 0) - (share(a, latestEl) ?? 0))[0];

  const facts: Record<string, string | number> = {
    ...opts.baseFacts,
    range,
    elections_count: opts.picked.length,
    parties_shown: shown.length,
    latest_election: electionFullLabel(latestEl, opts.lang),
  };
  if (opts.years != null) facts.window_years = opts.years;
  if (leaderLine) {
    const nm = bg ? leaderLine.name : (leaderLine.nameEn ?? leaderLine.name);
    facts.leader = `${nm} (${fmtPct(share(leaderLine, latestEl) ?? 0, opts.lang)})`;
  }
  shown.forEach((l) => {
    const vals = opts.picked
      .map((e) => share(l, e.name))
      .filter((v): v is number => v != null);
    const first = vals[0];
    const last = vals[vals.length - 1];
    if (first == null || last == null) return;
    const nm = bg ? l.name : (l.nameEn ?? l.name);
    facts[nm] =
      first === last
        ? fmtPct(last, opts.lang)
        : `${fmtPct(first, opts.lang)} → ${fmtPct(last, opts.lang)}`;
  });

  return {
    tool: opts.tool,
    domain: "elections",
    kind: "series",
    title: `${opts.titleBase[opts.lang]} (${range})`,
    subtitle: bg
      ? `Дял на гласовете през ${opts.picked.length} избора`
      : `Vote share across ${opts.picked.length} elections`,
    categories,
    series,
    viz: "line",
    geo: opts.geo,
    facts,
    provenance: opts.provenance,
  };
};

// ---- municipality -----------------------------------------------------------

export const municipalityResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const muni = await resolveMunicipality(query);
  if (!muni)
    return noData(
      "municipalityResults",
      bg
        ? `Не намерих община „${query}“`
        : `No municipality matched "${query}"`,
      [`${election}/municipalities/by/*.json`],
      { query },
    );
  // Sofia city has no single parliamentary município file — it's the 3 city МИР;
  // hand off to the region tool's Sofia-city aggregate.
  if (muni.obshtina === "SOF")
    return regionResults({ ...args, oblast: SOFIA_CITY }, ctx);

  const name = bg ? muni.name : muni.nameEn;
  const rows = await fetchData<MuniVoteRow[]>(
    `/${election}/municipalities/by/${muni.oblast}.json`,
  ).catch(() => [] as MuniVoteRow[]);
  const row = rows.find((r) => r.obshtina === muni.obshtina);
  if (!row || !row.results?.votes?.length)
    return noData(
      "municipalityResults",
      bg
        ? `Няма данни за община ${name} (${electionFullLabel(election, "bg")})`
        : `No data for ${name} municipality (${electionFullLabel(election, "en")})`,
      [`${election}/municipalities/by/${muni.oblast}.json`],
      { place: name, election: electionFullLabel(election, ctx.lang) },
    );
  const ns = await fetchNationalSummary<{ parties: NSParty[] }>(election);
  const agg = aggregate([row]);
  return resultsEnvelope({
    tool: "municipalityResults",
    lang: ctx.lang,
    title: bg
      ? `Резултати — община ${name} (${electionFullLabel(election, "bg")})`
      : `Results — ${name} municipality (${electionFullLabel(election, "en")})`,
    subtitle: bg ? muni.oblastName.bg : muni.oblastName.en,
    votesByNum: agg.votes,
    total: agg.total,
    reg: agg.reg,
    act: agg.act,
    partyByNum: new Map(ns.parties.map((p) => [p.partyNum, p])),
    geo: muniLocator(muni.obshtina, muni.oblast, name),
    provenance: [
      `${election}/municipalities/by/${muni.oblast}.json`,
      `${election}/national_summary.json`,
    ],
    baseFacts: {
      municipality: name,
      region: muni.oblastName[ctx.lang],
      election: electionFullLabel(election, ctx.lang),
    },
  });
};

export const municipalityHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.place ?? "");
  const muni = await resolveMunicipality(query);
  if (!muni)
    return noData(
      "municipalityHistory",
      bg
        ? `Не намерих община „${query}“`
        : `No municipality matched "${query}"`,
      ["*/municipalities/by/*.json"],
      { query },
    );
  if (muni.obshtina === "SOF")
    return regionResultsTrend({ ...args, oblast: SOFIA_CITY }, ctx);

  const name = bg ? muni.name : muni.nameEn;
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickWindow(years, n);
  const [perEl, canon] = await Promise.all([
    Promise.all(
      picked.map(async (e): Promise<ElSnap> => {
        try {
          const [rows, ns] = await Promise.all([
            fetchData<MuniVoteRow[]>(
              `/${e.name}/municipalities/by/${muni.oblast}.json`,
            ),
            fetchNationalSummary<{ parties: NSParty[] }>(e.name),
          ]);
          const row = rows.find((r) => r.obshtina === muni.obshtina);
          if (!row) return { el: e.name, total: 0, byNick: new Map() };
          const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
          const agg = aggregate([row]);
          const byNick = new Map<string, number>();
          agg.votes.forEach((votes, num) => {
            const nick = byNum.get(num)?.nickName;
            if (nick && votes > 0)
              byNick.set(nick, (byNick.get(nick) ?? 0) + votes);
          });
          return { el: e.name, total: agg.total, byNick };
        } catch {
          return { el: e.name, total: 0, byNick: new Map() };
        }
      }),
    ),
    fetchCanonicalParties<Canonical>(),
  ]);
  return trendEnvelope({
    tool: "municipalityHistory",
    lang: ctx.lang,
    titleBase: {
      bg: `Резултати по партии — община ${name}`,
      en: `Results by party — ${name} municipality`,
    },
    picked,
    perEl,
    canon,
    years,
    geo: muniLocator(muni.obshtina, muni.oblast, name),
    provenance: [
      "canonical_parties.json",
      ...picked.map((e) => `${e.name}/municipalities/by/${muni.oblast}.json`),
    ],
    baseFacts: { municipality: name, region: muni.oblastName[ctx.lang] },
    noDataTitle: bg
      ? `Няма данни за община ${name} в избрания период`
      : `No data for ${name} municipality in the selected window`,
  });
};

// ---- region (oblast), incl. Sofia city --------------------------------------

// Resolve the region arg to a label + the МИР code(s) to aggregate + a locator.
// Sofia city (the SOFIA_CITY sentinel) fans out to the three city МИР.
const resolveRegion = (
  raw: string,
  lang: Lang,
):
  | { label: string; codes: string[]; geo: GeoOverlay; sofiaCity: boolean }
  | undefined => {
  const bg = lang === "bg";
  if (raw === SOFIA_CITY)
    return {
      label: bg ? "София (град)" : "Sofia (city)",
      codes: SOFIA_CITY_CODES,
      geo: muniLocator("SOF", "S23", bg ? "София (град)" : "Sofia (city)"),
      sofiaCity: true,
    };
  const ob = resolveOblast(raw);
  if (!ob) return undefined;
  return {
    label: ob.name[lang],
    codes: [ob.code],
    geo: oblastLocator(ob.code, ob.name[lang]),
    sofiaCity: false,
  };
};

export const regionResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const raw = String(args.oblast ?? args.place ?? "");
  const reg = resolveRegion(raw, ctx.lang);
  if (!reg)
    return noData(
      "regionResults",
      bg ? `Не разпознах област „${raw}“` : `No region matched "${raw}"`,
      [`${election}/region_votes.json`],
      { query: raw },
    );
  const all = await fetchData<RegionVoteRow[]>(
    `/${election}/region_votes.json`,
  ).catch(() => [] as RegionVoteRow[]);
  const rows = all.filter((r) => reg.codes.includes(r.key));
  if (!rows.length)
    return noData(
      "regionResults",
      bg
        ? `Няма данни за ${reg.label} (${electionFullLabel(election, "bg")})`
        : `No data for ${reg.label} (${electionFullLabel(election, "en")})`,
      [`${election}/region_votes.json`],
      { region: reg.label, election: electionFullLabel(election, ctx.lang) },
    );
  const ns = await fetchNationalSummary<{ parties: NSParty[] }>(election);
  const agg = aggregate(rows);
  return resultsEnvelope({
    tool: "regionResults",
    lang: ctx.lang,
    title: bg
      ? `Резултати — ${reg.label} (${electionFullLabel(election, "bg")})`
      : `Results — ${reg.label} (${electionFullLabel(election, "en")})`,
    subtitle: reg.sofiaCity
      ? bg
        ? "Сборно за трите столични МИР (23, 24, 25)"
        : "Combined across Sofia's three MIR (23, 24, 25)"
      : undefined,
    votesByNum: agg.votes,
    total: agg.total,
    reg: agg.reg,
    act: agg.act,
    partyByNum: new Map(ns.parties.map((p) => [p.partyNum, p])),
    geo: reg.geo,
    provenance: [
      `${election}/region_votes.json`,
      `${election}/national_summary.json`,
    ],
    baseFacts: {
      region: reg.label,
      election: electionFullLabel(election, ctx.lang),
    },
  });
};

export const regionResultsTrend = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const raw = String(args.oblast ?? args.place ?? "");
  const reg = resolveRegion(raw, ctx.lang);
  if (!reg)
    return noData(
      "regionResultsTrend",
      bg ? `Не разпознах област „${raw}“` : `No region matched "${raw}"`,
      ["*/region_votes.json"],
      { query: raw },
    );
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickWindow(years, n);
  const [perEl, canon] = await Promise.all([
    Promise.all(
      picked.map(async (e): Promise<ElSnap> => {
        try {
          const [all, ns] = await Promise.all([
            fetchData<RegionVoteRow[]>(`/${e.name}/region_votes.json`),
            fetchNationalSummary<{ parties: NSParty[] }>(e.name),
          ]);
          const rows = all.filter((r) => reg.codes.includes(r.key));
          if (!rows.length) return { el: e.name, total: 0, byNick: new Map() };
          const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
          const agg = aggregate(rows);
          const byNick = new Map<string, number>();
          agg.votes.forEach((votes, num) => {
            const nick = byNum.get(num)?.nickName;
            if (nick && votes > 0)
              byNick.set(nick, (byNick.get(nick) ?? 0) + votes);
          });
          return { el: e.name, total: agg.total, byNick };
        } catch {
          return { el: e.name, total: 0, byNick: new Map() };
        }
      }),
    ),
    fetchCanonicalParties<Canonical>(),
  ]);
  return trendEnvelope({
    tool: "regionResultsTrend",
    lang: ctx.lang,
    titleBase: {
      bg: `Резултати по партии — ${reg.label}`,
      en: `Results by party — ${reg.label}`,
    },
    picked,
    perEl,
    canon,
    years,
    geo: reg.geo,
    provenance: [
      "canonical_parties.json",
      ...picked.map((e) => `${e.name}/region_votes.json`),
    ],
    baseFacts: { region: reg.label },
    noDataTitle: bg
      ? `Няма данни за ${reg.label} в избрания период`
      : `No data for ${reg.label} in the selected window`,
  });
};

// Re-exported so the router can detect a Sofia-city reference and pass the
// sentinel; kept here next to the codes it expands to.
export { SOFIA_CITY };
