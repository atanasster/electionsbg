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
import { round2 } from "./dataset";
import { electionFullLabel, fmtInt, fmtPct } from "./format";
import { loadMunis, oblastName } from "./place";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

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
