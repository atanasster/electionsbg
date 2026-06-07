// Election-integrity & anomaly tools: problem (Roma-neighbourhood) sections,
// the section risk index, geographic risk clusters, cross-election cluster
// persistence, Benford's-law digit tests, wasted (below-threshold) votes,
// suspicious settlements, and the out-of-country (diaspora) vote.
//
// All read pre-computed report JSON; numbers are never inferred. Several map a
// partyNum to its nickName via the election's national_summary.

import { resolveElection } from "./args";
import {
  fetchData,
  fetchNationalSummary,
  fetchRegionVotes,
} from "./dataClient";
import { ALL_ELECTIONS, electionsChrono, round2 } from "./dataset";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
import { loadMunis, oblastName } from "./place";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";
import {
  computeRiskComposite,
  type RiskCompositeComponentId,
} from "../../src/data/riskScore/computeRiskComposite";
import type { Votes, ElectionInfo } from "../../src/data/dataTypes";
import type { RiskScoreSummary } from "../../src/data/riskScore/useRiskScore";
import type { RiskClustersReport } from "../../src/data/riskScore/useRiskClusters";
import type { SuspiciousSettlementsReport } from "../../src/data/dashboard/useSuspiciousSections";
import type { BenfordReport } from "../../src/data/benford/useBenford";
import type { NationalSummary } from "../../src/data/dashboard/dashboardTypes";
import type { ProblemSectionsReport } from "../../src/data/reports/useProblemSections";
import type { PollsAccuracy } from "../../src/data/polls/pollsTypes";

// ---- shared: partyNum -> nickName for an election ---------------------------

type NSParty = { partyNum: number; nickName: string };

const partyNamesOf = async (election: string): Promise<Map<number, string>> => {
  try {
    const ns = await fetchNationalSummary<{ parties: NSParty[] }>(election);
    return new Map(ns.parties.map((p) => [p.partyNum, p.nickName]));
  } catch {
    return new Map();
  }
};

const muniNamesOf = async (
  lang: ToolContext["lang"],
): Promise<Map<string, string>> => {
  try {
    const munis = await loadMunis();
    const m = new Map(
      munis.map((x) => [x.obshtina, lang === "bg" ? x.name : x.nameEn]),
    );
    m.set("SOF00", lang === "bg" ? "Столична община" : "Sofia");
    return m;
  } catch {
    return new Map();
  }
};

// ---- problem sections (tracked Roma neighbourhoods) -------------------------

type ProblemSectionVote = { partyNum: number; totalVotes: number };
type ProblemSection = {
  results?: { votes?: ProblemSectionVote[] };
};
type Neighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  sections: ProblemSection[];
};

export const problemSections = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let data: { neighborhoods: Neighborhood[] };
  try {
    data = await fetchData(`/${election}/problem_sections.json`);
  } catch {
    return {
      tool: "problemSections",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за наблюдавани квартали — ${electionFullLabel(election, "bg")}`
        : `No watched-neighbourhood data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/problem_sections.json`],
    };
  }
  const names = await partyNamesOf(election);
  const rows: Row[] = data.neighborhoods.map((n) => {
    const tally = new Map<number, number>();
    let total = 0;
    for (const s of n.sections) {
      for (const v of s.results?.votes ?? []) {
        tally.set(
          v.partyNum,
          (tally.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0),
        );
        total += v.totalVotes ?? 0;
      }
    }
    let topNum = 0;
    let topVotes = 0;
    for (const [num, votes] of tally) {
      if (votes > topVotes) {
        topVotes = votes;
        topNum = num;
      }
    }
    const share = total > 0 ? round2((100 * topVotes) / total) : 0;
    return {
      neighborhood: bg ? n.name_bg : n.name_en,
      city: bg ? n.city_bg : n.city_en,
      sections: n.sections.length,
      dominant: names.get(topNum) ?? `#${topNum}`,
      share,
    };
  });
  rows.sort((a, b) => (b.sections as number) - (a.sections as number));
  const totalSections = rows.reduce((s, r) => s + (r.sections as number), 0);
  const top = rows[0];
  const columns: Column[] = [
    { key: "neighborhood", label: bg ? "Квартал" : "Neighbourhood" },
    { key: "city", label: bg ? "Град" : "City" },
    {
      key: "sections",
      label: bg ? "Секции" : "Sections",
      numeric: true,
      format: "int",
    },
    { key: "dominant", label: bg ? "Първа партия" : "Top party" },
    { key: "share", label: bg ? "Дял" : "Share", numeric: true, format: "pct" },
  ];
  return {
    tool: "problemSections",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Наблюдавани ромски квартали — ${electionFullLabel(election, "bg")}`
      : `Tracked Roma neighbourhoods — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Квартали, в които секциите статистически се групират"
      : "Neighbourhoods whose sections cluster statistically",
    columns,
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      neighborhoods: rows.length,
      total_sections: totalSections,
      top: top
        ? `${top.neighborhood} (${top.city}): ${top.dominant} ${fmtPct(top.share as number, ctx.lang)}`
        : "—",
    },
    provenance: [`${election}/problem_sections.json`],
  };
};

// ---- Roma-vote trend: who wins the tracked neighbourhoods over time ---------
// `problemSections` answers "who leads the watched neighbourhoods now"; this
// answers the "коя партия спечели ромските гласове последните 5 години" framing
// — the leading party across a WINDOW of parliamentary elections. Parties are
// tracked by nickName (partyNum is per-election), so a rebrand (ПП → ПП-ДБ)
// reads as two lines, which is factually honest.

const MAX_ROMA_LINES = 6;

const parseNum = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// Elections in scope (chronological, oldest→newest). A `years` arg is a DATE
// window (Bulgaria holds several elections a year, so "last 5 years" ≠ "last 5
// elections"); a bare `n` takes the last N; neither = the full history.
const pickElectionWindow = (
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

// partyNum -> {nick, colour} for an election (partyNamesOf + the party colour,
// so each trend line can carry its party's brand colour).
const partyMetaOf = async (
  election: string,
): Promise<Map<number, { nick: string; color?: string }>> => {
  try {
    const ns = await fetchNationalSummary<{
      parties: { partyNum: number; nickName: string; color?: string }[];
    }>(election);
    return new Map(
      ns.parties.map((p) => [p.partyNum, { nick: p.nickName, color: p.color }]),
    );
  } catch {
    return new Map();
  }
};

type RomaYear = {
  name: string;
  label: string;
  total: number;
  shares: Map<string, number>; // nickName -> share %
  colors: Map<string, string>; // nickName -> brand colour
  ranked: [string, number][]; // [nickName, share], desc
};

export const romaVoteTrend = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickElectionWindow(years, n);

  // Fetch + aggregate every election's watched-neighbourhood section votes.
  const built = await Promise.all(
    picked.map(async (e): Promise<RomaYear | null> => {
      let data: { neighborhoods: Neighborhood[] };
      try {
        data = await fetchData(`/${e.name}/problem_sections.json`);
      } catch {
        return null; // election has no watched-neighbourhood file
      }
      const meta = await partyMetaOf(e.name);
      const byNick = new Map<string, number>();
      const colors = new Map<string, string>();
      let total = 0;
      for (const nb of data.neighborhoods)
        for (const s of nb.sections)
          for (const v of s.results?.votes ?? []) {
            const m = meta.get(v.partyNum);
            const nick = m?.nick ?? `#${v.partyNum}`;
            const votes = v.totalVotes ?? 0;
            byNick.set(nick, (byNick.get(nick) ?? 0) + votes);
            if (m?.color && !colors.has(nick)) colors.set(nick, m.color);
            total += votes;
          }
      if (total === 0) return null; // older files store rollups, not sections
      const shares = new Map(
        [...byNick].map(([nk, v]): [string, number] => [
          nk,
          round2((100 * v) / total),
        ]),
      );
      const ranked = [...shares].sort((a, b) => b[1] - a[1]);
      return {
        name: e.name,
        label: electionShortLabel(e.name, ctx.lang),
        total,
        shares,
        colors,
        ranked,
      };
    }),
  );
  const data = built.filter((y): y is RomaYear => y !== null);

  if (data.length === 0) {
    return {
      tool: "romaVoteTrend",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? "Няма данни за тренда на ромския вот"
        : "No Roma-vote trend data",
      viz: "none",
      facts: {},
      provenance: ["problem_sections.json"],
    };
  }

  // Lines to draw: any party that reached the top 2 in any election in the
  // window. Ordered by peak share (most prominent first), capped for legibility.
  const plotted = new Set<string>();
  for (const y of data)
    for (const [nick] of y.ranked.slice(0, 2)) plotted.add(nick);
  const peakOf = (nick: string): number =>
    Math.max(0, ...data.map((y) => y.shares.get(nick) ?? 0));
  const drawn = [...plotted]
    .sort((a, b) => peakOf(b) - peakOf(a))
    .slice(0, MAX_ROMA_LINES);

  // A party's brand colour from the most recent election where it appears.
  const colorFor = (nick: string): string | undefined => {
    for (let i = data.length - 1; i >= 0; i--) {
      const c = data[i].colors.get(nick);
      if (c) return c;
    }
    return undefined;
  };

  const categories = data.map((y) => y.label);
  const series = drawn.map((nick, i) => ({
    key: `p${i}`,
    label: nick,
    color: colorFor(nick),
    points: data.map((y) => ({
      x: y.label,
      y: y.shares.has(nick) ? y.shares.get(nick)! : null,
    })),
  }));

  // Winner per election + the dominant winner across the window (facts only).
  const winCount = new Map<string, number>();
  const facts: Record<string, string | number> = {
    elections_count: data.length,
  };
  if (years != null) facts.window_years = years;
  for (const y of data) {
    const [topNick, topShare] = y.ranked[0];
    winCount.set(topNick, (winCount.get(topNick) ?? 0) + 1);
    facts[y.label] = `${topNick} ${fmtPct(topShare, ctx.lang)}`;
  }
  const mostWins = [...winCount].sort((a, b) => b[1] - a[1])[0];
  const latest = data[data.length - 1];
  const [latestNick, latestShare] = latest.ranked[0];
  facts.most_frequent_winner = mostWins
    ? `${mostWins[0]} (${mostWins[1]}/${data.length})`
    : "—";
  facts.latest = `${latestNick} ${fmtPct(latestShare, ctx.lang)} (${latest.label})`;

  const coversAll = data.length >= electionsChrono().length;
  const startYear = data[0].name.slice(0, 4);
  const range = coversAll
    ? bg
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : years != null
      ? bg
        ? `последните ${years} години`
        : `last ${years} years`
      : bg
        ? `последните ${data.length} избора`
        : `last ${data.length} elections`;

  return {
    tool: "romaVoteTrend",
    domain: "elections",
    kind: "series",
    title: bg
      ? `Кой печели ромския вот (${range})`
      : `Who wins the Roma vote (${range})`,
    subtitle: bg
      ? "Водеща партия в наблюдаваните ромски квартали — парламентарни избори"
      : "Leading party in the tracked Roma neighbourhoods — parliamentary elections",
    categories,
    series,
    viz: "line",
    facts,
    provenance: data.flatMap((y) => [
      `${y.name}/problem_sections.json`,
      `${y.name}/national_summary.json`,
    ]),
  };
};

// ---- section risk index -----------------------------------------------------

type RiskSummary = {
  totalSections: number;
  counts: { low: number; elevated: number; high: number; critical: number };
  votesByBand: {
    low: number;
    elevated: number;
    high: number;
    critical: number;
  };
  topCritical?: {
    section: string;
    oblast: string;
    score: number;
    band: string;
  }[];
};

const BAND_LABEL: Record<string, { bg: string; en: string }> = {
  low: { bg: "Нисък", en: "Low" },
  elevated: { bg: "Повишен", en: "Elevated" },
  high: { bg: "Висок", en: "High" },
  critical: { bg: "Критичен", en: "Critical" },
};

export const riskScore = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let d: RiskSummary;
  try {
    d = await fetchData(`/${election}/reports/section/risk_score_summary.json`);
  } catch {
    return {
      tool: "riskScore",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма индекс на риска — ${electionFullLabel(election, "bg")}`
        : `No risk index — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/reports/section/risk_score_summary.json`],
    };
  }
  const order: (keyof RiskSummary["counts"])[] = [
    "critical",
    "high",
    "elevated",
    "low",
  ];
  const rows: Row[] = order.map((k) => ({
    band: BAND_LABEL[k][ctx.lang],
    sections: d.counts[k] ?? 0,
    votes: d.votesByBand?.[k] ?? 0,
  }));
  const tc = d.topCritical?.[0];
  return {
    tool: "riskScore",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Индекс на изборния риск — ${electionFullLabel(election, "bg")}`
      : `Election risk index — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Секциите, групирани по ниво на риск"
      : "Sections grouped by risk band",
    columns: [
      { key: "band", label: bg ? "Ниво" : "Band" },
      {
        key: "sections",
        label: bg ? "Секции" : "Sections",
        numeric: true,
        format: "int",
      },
      {
        key: "votes",
        label: bg ? "Гласове" : "Votes",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      total_sections: fmtInt(d.totalSections ?? 0, ctx.lang),
      critical: d.counts.critical ?? 0,
      high: d.counts.high ?? 0,
      top_critical: tc
        ? `${tc.section} (${oblastName(tc.oblast)[ctx.lang]}) — ${Math.round(tc.score)}`
        : "—",
    },
    provenance: [`${election}/reports/section/risk_score_summary.json`],
  };
};

// ---- composite election risk index ------------------------------------------
// The headline 0–100 "Индекс на изборния риск" shown on /risk-analysis: the
// integrity-track average plus all 10 component sub-scores. Shares the exact
// computation with the site hero via src/data/riskScore/computeRiskComposite.

const COMPONENT_LABEL: Record<
  RiskCompositeComponentId,
  { bg: string; en: string }
> = {
  sections: { bg: "Секционен скрининг", en: "Section screening" },
  machine: { bg: "Машинна цялост", en: "Machine integrity" },
  missingFlash: { bg: "Липсваща флаш памет", en: "Missing flash memory" },
  concentration: { bg: "Концентрация", en: "Concentration" },
  procedural: { bg: "Процедурни аномалии", en: "Procedural anomalies" },
  benford: { bg: "Бенфорд (2-ра цифра)", en: "Benford (2nd digit)" },
  neighborhoodsSwing: {
    bg: "Преориентиране в махалите",
    en: "Neighborhood swing",
  },
  voteSwitching: { bg: "Електорална волатилност", en: "Electoral volatility" },
  polls: { bg: "Социологическа грешка", en: "Polling error" },
  clusters: { bg: "Рискови клъстери", en: "Risk clusters" },
};

const COMPOSITE_BAND_LABEL: Record<string, { bg: string; en: string }> = {
  calm: { bg: "Спокоен", en: "Calm" },
  elevated: { bg: "Повишен", en: "Elevated" },
  high: { bg: "Висок", en: "High" },
  critical: { bg: "Критичен", en: "Critical" },
};

const TRACK_LABEL: Record<string, { bg: string; en: string }> = {
  integrity: { bg: "Процесна цялост", en: "Process integrity" },
  context: { bg: "Контекст", en: "Context" },
};

// Component display order, integrity track first — matches the hero layout.
const COMPOSITE_ORDER: RiskCompositeComponentId[] = [
  "sections",
  "machine",
  "missingFlash",
  "concentration",
  "procedural",
  "benford",
  "neighborhoodsSwing",
  "voteSwitching",
  "polls",
  "clusters",
];

export const riskIndex = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";

  // Tolerate any individual 404 — older cycles miss some reports, and the
  // composite simply marks that component unavailable rather than failing.
  const grab = <T>(p: string): Promise<T | null> =>
    fetchData<T>(p).catch(() => null);

  const [
    risk,
    regions,
    suspicious,
    benford,
    national,
    problemSections,
    problemSectionsStats,
    pollsAccuracy,
    clusters,
  ] = await Promise.all([
    grab<RiskScoreSummary>(
      `/${election}/reports/section/risk_score_summary.json`,
    ),
    grab<{ results: { votes: Votes[] } }[]>(`/${election}/region_votes.json`),
    grab<SuspiciousSettlementsReport>(
      `/${election}/dashboard/suspicious_settlements.json`,
    ),
    grab<BenfordReport>(`/${election}/reports/benford.json`),
    grab<NationalSummary>(`/${election}/national_summary.json`),
    grab<ProblemSectionsReport>(`/${election}/problem_sections.json`),
    grab<ElectionInfo[]>(`/problem_sections_stats.json`),
    grab<PollsAccuracy>(`/polls/accuracy.json`),
    grab<RiskClustersReport>(`/${election}/reports/section/risk_clusters.json`),
  ]);

  // Country-aggregate region votes PER party first (machine + flash), so the
  // machine-drift component sees net per-party disagreement, not the larger
  // per-region sum — mirrors the hook's countryVotes().
  let countryVotes: { results: { votes: Votes[] } } | null = null;
  if (regions) {
    const agg = new Map<number, Votes>();
    for (const r of regions) {
      for (const v of r.results?.votes ?? []) {
        const cur = agg.get(v.partyNum) ?? {
          partyNum: v.partyNum,
          totalVotes: 0,
          machineVotes: 0,
          suemgVotes: 0,
        };
        cur.totalVotes += v.totalVotes ?? 0;
        cur.machineVotes = (cur.machineVotes ?? 0) + (v.machineVotes ?? 0);
        cur.suemgVotes = (cur.suemgVotes ?? 0) + (v.suemgVotes ?? 0);
        agg.set(v.partyNum, cur);
      }
    }
    countryVotes = { results: { votes: [...agg.values()] } };
  }

  // electionStats / priorElections from the bundled, newest-first catalogue.
  const idx = ALL_ELECTIONS.findIndex((e) => e.name === election);
  const electionStats = idx >= 0 ? ALL_ELECTIONS[idx] : undefined;
  const priorElections =
    idx >= 0 && idx < ALL_ELECTIONS.length - 1
      ? ALL_ELECTIONS[idx + 1]
      : undefined;

  const composite = computeRiskComposite({
    selected: election,
    risk,
    countryVotes,
    suspicious,
    benford,
    national,
    problemSections,
    problemSectionsStats,
    pollsAccuracy,
    clusters,
    electionStats,
    priorElections,
  });

  const provenance = [
    `${election}/reports/section/risk_score_summary.json`,
    `${election}/region_votes.json`,
    `${election}/dashboard/suspicious_settlements.json`,
    `${election}/reports/benford.json`,
    `${election}/problem_sections.json`,
    `problem_sections_stats.json`,
    `polls/accuracy.json`,
    `${election}/reports/section/risk_clusters.json`,
  ];

  if (!composite) {
    return {
      tool: "riskIndex",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма индекс на изборния риск — ${electionFullLabel(election, "bg")}`
        : `No election risk index — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance,
    };
  }

  const byId = new Map(composite.components.map((c) => [c.id, c]));
  const rows: Row[] = COMPOSITE_ORDER.map((id) => {
    const c = byId.get(id)!;
    return {
      track: TRACK_LABEL[c.track][ctx.lang],
      component: COMPONENT_LABEL[id][ctx.lang],
      score: c.available ? Math.round(c.value) : null,
      detail: c.available ? (c.detail ?? "—") : bg ? "няма данни" : "no data",
    };
  });

  const score = Math.round(composite.score);
  const bandLabel = COMPOSITE_BAND_LABEL[composite.band][ctx.lang];
  // Strongest available integrity signal — what's pushing the headline up.
  const topIntegrity = composite.components
    .filter((c) => c.track === "integrity" && c.available)
    .sort((a, b) => b.value - a.value)[0];
  const ctxScore =
    composite.contextScore == null ? null : Math.round(composite.contextScore);

  return {
    tool: "riskIndex",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Индекс на изборния риск — ${electionFullLabel(election, "bg")}`
      : `Election risk index — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? `Главен индекс ${score}/100 — ${bandLabel} (средно от ${composite.integrityAvailableCount} компонента за процесна цялост; контекстуални сигнали средно ${ctxScore ?? "—"})`
      : `Headline ${score}/100 — ${bandLabel} (average of ${composite.integrityAvailableCount} process-integrity components; context signals average ${ctxScore ?? "—"})`,
    columns: [
      { key: "track", label: bg ? "Категория" : "Track" },
      { key: "component", label: bg ? "Компонент" : "Component" },
      {
        key: "score",
        label: bg ? "Оценка" : "Score",
        numeric: true,
        format: "int",
      },
      { key: "detail", label: bg ? "Детайл" : "Detail" },
    ],
    rows,
    viz: "none",
    value: score,
    valueFormat: "int",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      index: score,
      band: bandLabel,
      context_score: ctxScore ?? "—",
      integrity_components: `${composite.integrityAvailableCount}/${composite.integrityTotalCount}`,
      top_integrity: topIntegrity
        ? `${COMPONENT_LABEL[topIntegrity.id][ctx.lang]} (${Math.round(topIntegrity.value)})`
        : "—",
    },
    provenance,
  };
};

// ---- geographic risk clusters -----------------------------------------------

type RiskCluster = {
  oblast: string;
  obshtina: string;
  partyNum: number;
  sectionCount: number;
  meanScore: number;
  maxBand: string;
};

export const riskClusters = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let d: { clusters: RiskCluster[] };
  try {
    d = await fetchData(`/${election}/reports/section/risk_clusters.json`);
  } catch {
    return {
      tool: "riskClusters",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма клъстери на риска — ${electionFullLabel(election, "bg")}`
        : `No risk clusters — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/reports/section/risk_clusters.json`],
    };
  }
  const [names, munis] = await Promise.all([
    partyNamesOf(election),
    muniNamesOf(ctx.lang),
  ]);
  const clusters = [...d.clusters].sort(
    (a, b) => b.sectionCount - a.sectionCount,
  );
  const top = clusters.slice(0, 12);
  const rows: Row[] = top.map((c) => ({
    place:
      munis.get(c.obshtina) ?? oblastName(c.oblast)[ctx.lang] ?? c.obshtina,
    sections: c.sectionCount,
    party: names.get(c.partyNum) ?? `#${c.partyNum}`,
    score: Math.round(c.meanScore),
    band: BAND_LABEL[c.maxBand]?.[ctx.lang] ?? c.maxBand,
  }));
  const biggest = top[0];
  return {
    tool: "riskClusters",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Клъстери на изборния риск — ${electionFullLabel(election, "bg")}`
      : `Election-risk clusters — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Съседни флагнати секции с една водеща партия"
      : "Adjacent flagged sections sharing one leading party",
    columns: [
      { key: "place", label: bg ? "Община" : "Municipality" },
      {
        key: "sections",
        label: bg ? "Секции" : "Sections",
        numeric: true,
        format: "int",
      },
      { key: "party", label: bg ? "Партия" : "Party" },
      {
        key: "score",
        label: bg ? "Ср. риск" : "Mean risk",
        numeric: true,
        format: "int",
      },
      { key: "band", label: bg ? "Връх" : "Peak" },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      clusters: clusters.length,
      biggest: biggest
        ? `${rows[0].place}: ${biggest.sectionCount} ${bg ? "секции" : "sections"} (${names.get(biggest.partyNum) ?? "—"})`
        : "—",
    },
    provenance: [`${election}/reports/section/risk_clusters.json`],
  };
};

// ---- cross-election cluster persistence (not election-scoped) ---------------

type PersistLocus = {
  oblast: string;
  obshtina: string;
  electionCount: number;
  sectionCount: number;
  problemSectionCount: number;
  appearances: { election: string; winnerNickName: string }[];
};

export const clusterPersistence = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  let d: { loci: PersistLocus[] };
  try {
    d = await fetchData("/cluster_persistence.json");
  } catch {
    return {
      tool: "clusterPersistence",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? "Няма данни за устойчиви рискови огнища"
        : "No persistent-risk-loci data",
      viz: "none",
      facts: {},
      provenance: ["cluster_persistence.json"],
    };
  }
  const munis = await muniNamesOf(ctx.lang);
  const loci = [...d.loci].sort((a, b) => b.electionCount - a.electionCount);
  const top = loci.slice(0, 12);
  const latestOf = (l: PersistLocus): string => {
    const a = l.appearances?.[l.appearances.length - 1];
    return a ? a.winnerNickName : "—";
  };
  const rows: Row[] = top.map((l) => ({
    place:
      munis.get(l.obshtina) ?? oblastName(l.oblast)[ctx.lang] ?? l.obshtina,
    elections: l.electionCount,
    sections: l.sectionCount,
    latest_winner: latestOf(l),
  }));
  const most = top[0];
  return {
    tool: "clusterPersistence",
    domain: "elections",
    kind: "table",
    title: bg ? "Устойчиви рискови огнища" : "Persistent risk loci",
    subtitle: bg
      ? "Места, чиито рискови клъстери се повтарят през изборите"
      : "Places whose risk clusters recur across elections",
    columns: [
      { key: "place", label: bg ? "Община" : "Municipality" },
      {
        key: "elections",
        label: bg ? "Избори" : "Elections",
        numeric: true,
        format: "int",
      },
      {
        key: "sections",
        label: bg ? "Секции (сега)" : "Sections (now)",
        numeric: true,
        format: "int",
      },
      {
        key: "latest_winner",
        label: bg ? "Последен победител" : "Latest winner",
      },
    ],
    rows,
    viz: "none",
    facts: {
      loci: loci.length,
      most_persistent: most
        ? `${rows[0].place} (${most.electionCount} ${bg ? "избора" : "elections"})`
        : "—",
    },
    provenance: ["cluster_persistence.json"],
  };
};

// ---- Benford's-law digit test -----------------------------------------------

type BenfordDigit = { mad: number; pValue: number; n: number };
type BenfordParty = {
  nickName: string;
  totalSections: number;
  firstDigit?: BenfordDigit;
};

const fmtP = (p: number): string =>
  p < 0.001
    ? "<0.001"
    : p.toLocaleString("en-US", { maximumFractionDigits: 3 });

export const benfordAnomalies = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let d: { parties: BenfordParty[] };
  try {
    d = await fetchData(`/${election}/reports/benford.json`);
  } catch {
    return {
      tool: "benfordAnomalies",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма Бенфорд-анализ — ${electionFullLabel(election, "bg")}`
        : `No Benford analysis — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/reports/benford.json`],
    };
  }
  const tested = d.parties.filter((p) => p.firstDigit);
  const ranked = [...tested].sort(
    (a, b) => (b.firstDigit!.mad ?? 0) - (a.firstDigit!.mad ?? 0),
  );
  const top = ranked.slice(0, 12);
  const rows: Row[] = top.map((p) => ({
    party: p.nickName,
    mad: round2(p.firstDigit!.mad * 1000) / 1000,
    p: fmtP(p.firstDigit!.pValue),
    sections: p.totalSections,
  }));
  const worst = ranked[0];
  return {
    tool: "benfordAnomalies",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Тест на Бенфорд (първа цифра) — ${electionFullLabel(election, "bg")}`
      : `Benford's-law test (first digit) — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "По-висок MAD = по-голямо отклонение (не е доказателство за измама)"
      : "Higher MAD = larger deviation (not proof of fraud)",
    columns: [
      { key: "party", label: bg ? "Партия" : "Party" },
      { key: "mad", label: "MAD", numeric: true },
      { key: "p", label: "p", numeric: true },
      {
        key: "sections",
        label: bg ? "Секции" : "Sections",
        numeric: true,
        format: "int",
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      parties_tested: tested.length,
      most_deviating: worst
        ? `${worst.nickName} (MAD ${round2(worst.firstDigit!.mad * 1000) / 1000})`
        : "—",
    },
    provenance: [`${election}/reports/benford.json`],
  };
};

// ---- wasted (below-threshold) votes -----------------------------------------

type WastedRegionRow = {
  share: number;
  wastedVotes: number;
  validVotes: number;
};
type WastedDashRow = {
  name_bg: string;
  name_en: string;
  share: number;
  partyNum: number;
};

export const wastedVotes = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let dash: { topRegions: WastedDashRow[] };
  try {
    dash = await fetchData(`/${election}/dashboard/wasted_votes.json`);
  } catch {
    return {
      tool: "wastedVotes",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за прахосани гласове — ${electionFullLabel(election, "bg")}`
        : `No wasted-vote data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/dashboard/wasted_votes.json`],
    };
  }
  // national share = sum(wasted)/sum(valid) across regions
  let nationalShare: number | null = null;
  try {
    const regs = await fetchData<WastedRegionRow[]>(
      `/${election}/reports/region/wasted_votes.json`,
    );
    const w = regs.reduce((s, r) => s + (r.wastedVotes ?? 0), 0);
    const v = regs.reduce((s, r) => s + (r.validVotes ?? 0), 0);
    if (v > 0) nationalShare = round2((100 * w) / v);
  } catch {
    /* national share stays null */
  }
  const names = await partyNamesOf(election);
  const top = dash.topRegions.slice(0, 12);
  const rows: Row[] = top.map((r) => ({
    region: bg ? r.name_bg : r.name_en,
    share: round2(r.share),
    party: names.get(r.partyNum) ?? `#${r.partyNum}`,
  }));
  return {
    tool: "wastedVotes",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Прахосани гласове (под прага) — ${electionFullLabel(election, "bg")}`
      : `Wasted votes (below threshold) — ${electionFullLabel(election, "en")}`,
    subtitle: bg
      ? "Дял на гласовете за партии под 4% прага, по области"
      : "Share of votes for sub-4%-threshold parties, by oblast",
    columns: [
      { key: "region", label: bg ? "Област" : "Oblast" },
      {
        key: "share",
        label: bg ? "Прахосани %" : "Wasted %",
        numeric: true,
        format: "pct",
      },
      {
        key: "party",
        label: bg ? "Най-голяма под прага" : "Largest below threshold",
      },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      national_share:
        nationalShare != null ? fmtPct(nationalShare, ctx.lang) : "—",
      top_region: top[0]
        ? `${bg ? top[0].name_bg : top[0].name_en} (${fmtPct(round2(top[0].share), ctx.lang)})`
        : "—",
    },
    provenance: [
      `${election}/dashboard/wasted_votes.json`,
      `${election}/reports/region/wasted_votes.json`,
    ],
  };
};

// ---- suspicious settlements -------------------------------------------------

type SuspectTop = { settlement: string; settlement_en: string; value: number };
type SuspectCat = { count: number; top: SuspectTop[] };
type Suspicious = {
  concentrated: SuspectCat;
  invalidBallots: SuspectCat;
  additionalVoters: SuspectCat;
};

export const suspiciousSettlements = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  let d: Suspicious;
  try {
    d = await fetchData(`/${election}/dashboard/suspicious_settlements.json`);
  } catch {
    return {
      tool: "suspiciousSettlements",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за съмнителни места — ${electionFullLabel(election, "bg")}`
        : `No suspicious-settlement data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/dashboard/suspicious_settlements.json`],
    };
  }
  const cats: [keyof Suspicious, { bg: string; en: string }][] = [
    [
      "concentrated",
      {
        bg: "Концентриран вот (≥90% за 1 партия)",
        en: "Concentrated vote (≥90% for one party)",
      },
    ],
    [
      "invalidBallots",
      { bg: "Висок дял невалидни бюлетини", en: "High invalid-ballot share" },
    ],
    [
      "additionalVoters",
      { bg: "Много дописани избиратели", en: "Many additional voters" },
    ],
  ];
  const topName = (c: SuspectCat): string => {
    const t = c.top?.[0];
    if (!t) return "—";
    return `${bg ? t.settlement : t.settlement_en} (${round2(t.value)}%)`;
  };
  const rows: Row[] = cats.map(([k, lab]) => ({
    category: lab[ctx.lang],
    settlements: d[k]?.count ?? 0,
    top: topName(d[k]),
  }));
  return {
    tool: "suspiciousSettlements",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Съмнителни населени места — ${electionFullLabel(election, "bg")}`
      : `Suspicious settlements — ${electionFullLabel(election, "en")}`,
    columns: [
      { key: "category", label: bg ? "Категория" : "Category" },
      {
        key: "settlements",
        label: bg ? "Места" : "Settlements",
        numeric: true,
        format: "int",
      },
      { key: "top", label: bg ? "Най-краен пример" : "Most extreme example" },
    ],
    rows,
    viz: "none",
    facts: {
      election: electionFullLabel(election, ctx.lang),
      concentrated: d.concentrated?.count ?? 0,
      invalid_ballots: d.invalidBallots?.count ?? 0,
      additional_voters: d.additionalVoters?.count ?? 0,
      top_concentrated: topName(d.concentrated),
    },
    provenance: [`${election}/dashboard/suspicious_settlements.json`],
  };
};

// ---- out-of-country (diaspora) vote -----------------------------------------

type RegionEntry = {
  key: string;
  results?: {
    votes?: { partyNum: number; totalVotes: number }[];
    protocol?: { totalActualVoters?: number };
  };
};

export const diasporaVote = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const election = resolveElection(args, ctx);
  const bg = ctx.lang === "bg";
  const regions = await fetchRegionVotes<RegionEntry[]>(election);
  const abroad = regions.find((r) => r.key === "32");
  if (!abroad?.results?.votes?.length) {
    return {
      tool: "diasporaVote",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? `Няма данни за гласа в чужбина — ${electionFullLabel(election, "bg")}`
        : `No out-of-country data — ${electionFullLabel(election, "en")}`,
      viz: "none",
      facts: { election: electionFullLabel(election, ctx.lang) },
      provenance: [`${election}/region_votes.json`],
    };
  }
  const names = await partyNamesOf(election);
  const votes = abroad.results.votes;
  const total = votes.reduce((s, v) => s + (v.totalVotes ?? 0), 0);
  const ranked = [...votes]
    .filter((v) => (v.totalVotes ?? 0) > 0)
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 12);
  const rows: Row[] = ranked.map((v) => ({
    party: names.get(v.partyNum) ?? `#${v.partyNum}`,
    votes: v.totalVotes,
    pct: total > 0 ? round2((100 * v.totalVotes) / total) : 0,
  }));
  const leader = ranked[0];
  const actualVoters = abroad.results.protocol?.totalActualVoters ?? total;
  return {
    tool: "diasporaVote",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Гласове в чужбина (МИР 32) — ${electionFullLabel(election, "bg")}`
      : `Out-of-country vote (MIR 32) — ${electionFullLabel(election, "en")}`,
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
      voters: fmtInt(actualVoters, ctx.lang),
      leader: leader
        ? `${names.get(leader.partyNum) ?? "—"} (${fmtPct(rows[0].pct as number, ctx.lang)})`
        : "—",
    },
    provenance: [`${election}/region_votes.json`],
  };
};

// ---- diaspora (out-of-country) vote over time -------------------------------
// The trend companion to `diasporaVote`. "Кой печели гласа в чужбина последните
// N години" / "who wins the diaspora vote over time" → a multi-line chart of the
// leading parties' share of the out-of-country (МИР 32) vote across elections.
// Mirrors `romaVoteTrend`: threads parties by nickName, plots any party that hit
// the top 2 in any election, peak-ranked and capped.

const MAX_DIASPORA_LINES = 6;

type DiasporaYear = {
  name: string;
  label: string;
  total: number;
  shares: Map<string, number>;
  colors: Map<string, string>;
  ranked: [string, number][];
};

export const diasporaVoteTrend = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickElectionWindow(years, n);

  const built = await Promise.all(
    picked.map(async (e): Promise<DiasporaYear | null> => {
      let regions: RegionEntry[];
      try {
        regions = await fetchRegionVotes<RegionEntry[]>(e.name);
      } catch {
        return null;
      }
      const abroad = regions.find((r) => r.key === "32");
      const votes = abroad?.results?.votes ?? [];
      if (!votes.length) return null;
      const meta = await partyMetaOf(e.name);
      const byNick = new Map<string, number>();
      const colors = new Map<string, string>();
      let total = 0;
      for (const v of votes) {
        const m = meta.get(v.partyNum);
        const nick = m?.nick ?? `#${v.partyNum}`;
        const vv = v.totalVotes ?? 0;
        if (vv <= 0) continue;
        byNick.set(nick, (byNick.get(nick) ?? 0) + vv);
        if (m?.color && !colors.has(nick)) colors.set(nick, m.color);
        total += vv;
      }
      if (total === 0) return null;
      const shares = new Map(
        [...byNick].map(([nk, v]): [string, number] => [
          nk,
          round2((100 * v) / total),
        ]),
      );
      const ranked = [...shares].sort((a, b) => b[1] - a[1]);
      return {
        name: e.name,
        label: electionShortLabel(e.name, ctx.lang),
        total,
        shares,
        colors,
        ranked,
      };
    }),
  );
  const data = built.filter((y): y is DiasporaYear => y !== null);

  if (data.length === 0) {
    return {
      tool: "diasporaVoteTrend",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? "Няма данни за тренда на гласа в чужбина"
        : "No diaspora-vote trend data",
      viz: "none",
      facts: {},
      provenance: ["region_votes.json"],
    };
  }

  // Lines: any party that reached the top 2 abroad in any election in the window,
  // ordered by peak share, capped for legibility.
  const plotted = new Set<string>();
  for (const y of data)
    for (const [nick] of y.ranked.slice(0, 2)) plotted.add(nick);
  const peakOf = (nick: string): number =>
    Math.max(0, ...data.map((y) => y.shares.get(nick) ?? 0));
  const drawn = [...plotted]
    .sort((a, b) => peakOf(b) - peakOf(a))
    .slice(0, MAX_DIASPORA_LINES);
  const colorFor = (nick: string): string | undefined => {
    for (let i = data.length - 1; i >= 0; i--) {
      const c = data[i].colors.get(nick);
      if (c) return c;
    }
    return undefined;
  };

  const categories = data.map((y) => y.label);
  const series = drawn.map((nick, i) => ({
    key: `p${i}`,
    label: nick,
    color: colorFor(nick),
    points: data.map((y) => ({
      x: y.label,
      y: y.shares.has(nick) ? y.shares.get(nick)! : null,
    })),
  }));

  const winCount = new Map<string, number>();
  const facts: Record<string, string | number> = {
    elections_count: data.length,
  };
  if (years != null) facts.window_years = years;
  for (const y of data) {
    const [topNick, topShare] = y.ranked[0];
    winCount.set(topNick, (winCount.get(topNick) ?? 0) + 1);
    facts[y.label] = `${topNick} ${fmtPct(topShare, ctx.lang)}`;
  }
  const mostWins = [...winCount].sort((a, b) => b[1] - a[1])[0];
  const latest = data[data.length - 1];
  const [latestNick, latestShare] = latest.ranked[0];
  facts.most_frequent_winner = mostWins
    ? `${mostWins[0]} (${mostWins[1]}/${data.length})`
    : "—";
  facts.latest = `${latestNick} ${fmtPct(latestShare, ctx.lang)} (${latest.label})`;

  const coversAll = data.length >= electionsChrono().length;
  const startYear = data[0].name.slice(0, 4);
  const range = coversAll
    ? bg
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : years != null
      ? bg
        ? `последните ${years} години`
        : `last ${years} years`
      : bg
        ? `последните ${data.length} избора`
        : `last ${data.length} elections`;

  return {
    tool: "diasporaVoteTrend",
    domain: "elections",
    kind: "series",
    title: bg
      ? `Кой печели гласа в чужбина (${range})`
      : `Who wins the diaspora vote (${range})`,
    subtitle: bg
      ? "Водеща партия сред гласовете в чужбина (МИР 32) — парламентарни избори"
      : "Leading party in the out-of-country vote (MIR 32) — parliamentary elections",
    categories,
    series,
    viz: "line",
    facts,
    provenance: data.map((y) => `${y.name}/region_votes.json`),
  };
};

// ---- wasted votes (below the 4% threshold) over time ------------------------
// The trend companion to `wastedVotes`. "Прахосани гласове под прага последните N
// години" / "wasted votes over time" → a single line of the national share of
// votes cast for sub-threshold parties across elections. Each election's share =
// sum(wasted)/sum(valid) over its per-oblast wasted_votes report.

export const wastedVotesTrend = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const years = parseNum(args.years);
  const n = parseNum(args.n);
  const picked = pickElectionWindow(years, n);

  const built = await Promise.all(
    picked.map(
      async (
        e,
      ): Promise<{ name: string; label: string; share: number } | null> => {
        try {
          const regs = await fetchData<WastedRegionRow[]>(
            `/${e.name}/reports/region/wasted_votes.json`,
          );
          const w = regs.reduce((s, r) => s + (r.wastedVotes ?? 0), 0);
          const v = regs.reduce((s, r) => s + (r.validVotes ?? 0), 0);
          if (v <= 0) return null;
          return {
            name: e.name,
            label: electionShortLabel(e.name, ctx.lang),
            share: round2((100 * w) / v),
          };
        } catch {
          return null; // election has no wasted-votes report
        }
      },
    ),
  );
  const data = built.filter(
    (y): y is { name: string; label: string; share: number } => y !== null,
  );

  if (data.length === 0) {
    return {
      tool: "wastedVotesTrend",
      domain: "elections",
      kind: "scalar",
      title: bg
        ? "Няма данни за тренда на прахосаните гласове"
        : "No wasted-vote trend data",
      viz: "none",
      facts: {},
      provenance: ["reports/region/wasted_votes.json"],
    };
  }

  const coversAll = data.length >= electionsChrono().length;
  const startYear = data[0].name.slice(0, 4);
  const range = coversAll
    ? bg
      ? `от ${startYear} насам`
      : `since ${startYear}`
    : years != null
      ? bg
        ? `последните ${years} години`
        : `last ${years} years`
      : bg
        ? `последните ${data.length} избора`
        : `last ${data.length} elections`;

  const latest = data[data.length - 1];
  const earliest = data[0];
  const facts: Record<string, string | number> = {
    elections_count: data.length,
    latest: `${latest.label}: ${fmtPct(latest.share, ctx.lang)}`,
    peak_pct: Math.max(...data.map((d) => d.share)),
    change_pts: round2(latest.share - earliest.share),
  };
  if (years != null) facts.window_years = years;
  data.forEach((d) => {
    facts[d.label] = fmtPct(d.share, ctx.lang);
  });

  return {
    tool: "wastedVotesTrend",
    domain: "elections",
    kind: "series",
    title: bg
      ? `Прахосани гласове под прага (${range})`
      : `Wasted votes below the threshold (${range})`,
    subtitle: bg
      ? "Дял на гласовете за партии под 4% прага, национално"
      : "Share of votes for sub-4%-threshold parties, nationally",
    categories: data.map((d) => d.label),
    series: [
      {
        key: "wasted",
        label: bg ? "Прахосани %" : "Wasted %",
        points: data.map((d) => ({ x: d.label, y: d.share })),
      },
    ],
    viz: "line",
    facts,
    provenance: data.map((d) => `${d.name}/reports/region/wasted_votes.json`),
  };
};
