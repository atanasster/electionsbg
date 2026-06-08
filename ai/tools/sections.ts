// Single-polling-section tools: the results in ONE station (named by its stable
// 9-digit section id) and that station's party-share history across elections.
//
// A section id is self-locating: its first two digits are the МИР (oblast) number
// that names the per-oblast bundle (sections/by-oblast/NN.json), so a 9-digit id
// maps straight to a file + key with no place lookup. These complement winners.ts
// (sectionWinners ranks the leading party across a settlement's sections); here a
// single section is asked about directly — the case the reported bug hit
// ("резултатите в секция 050900092"), where the id was mistaken for a place name.

import type { ElectionInfo } from "../../src/data/dataTypes";
import { resolveElection } from "./args";
import {
  fetchCanonicalParties,
  fetchData,
  fetchNationalSummary,
} from "./dataClient";
import { electionsChrono, round1, round2 } from "./dataset";
import {
  electionFullLabel,
  electionShortLabel,
  fmtInt,
  fmtPct,
} from "./format";
import { settlementLocator } from "./geo";
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
  name?: string;
  color?: string;
};
type VoteEntry = {
  partyNum: number;
  paperVotes?: number;
  machineVotes?: number;
  totalVotes: number;
};
type Protocol = {
  numRegisteredVoters?: number;
  numAdditionalVoters?: number;
  totalActualVoters?: number;
  numValidVotes?: number;
  numValidMachineVotes?: number;
};
type SectionRecord = {
  section: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  region_name?: string;
  settlement?: string;
  address?: string;
  num_machines?: number;
  results: { protocol?: Protocol; votes: VoteEntry[] };
};

// A polling-section id is exactly 9 digits; its first two name the per-oblast
// bundle. Anything else can't be a section id.
export const SECTION_ID = /^\d{9}$/;
const fileOf = (section: string): string => section.slice(0, 2);

// rec.region_name reads "05. ВИДИН"; prefer the bilingual oblast registry (keyed
// by the section's МИР code) and fall back to the stripped region_name. oblastName
// echoes the code back when it's unknown, so only a real hit is trusted.
const regionOf = (rec: SectionRecord, lang: Lang): string => {
  if (rec.oblast) {
    const o = oblastName(rec.oblast);
    if (o.bg !== rec.oblast) return o[lang];
  }
  return (rec.region_name ?? "").replace(/^\s*\d+\.?\s*/, "").trim();
};

const declineSection = (
  tool: string,
  section: string,
  lang: Lang,
  reason: "format" | "missing",
  provenance: string[],
  facts: Record<string, string | number> = {},
): Envelope => ({
  tool,
  domain: "elections",
  kind: "scalar",
  title:
    reason === "format"
      ? lang === "bg"
        ? `„${section}“ не прилича на номер на секция (9 цифри).`
        : `"${section}" doesn't look like a section number (9 digits).`
      : lang === "bg"
        ? `Няма данни за секция ${section}.`
        : `No data for section ${section}.`,
  viz: "none",
  facts: { section, ...facts },
  provenance,
});

// ---- one section, one election ----------------------------------------------

export const sectionResults = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const election = resolveElection(args, ctx);
  const section = String(args.section ?? "").trim();
  if (!SECTION_ID.test(section))
    return declineSection("sectionResults", section, ctx.lang, "format", [
      `${election}/sections/by-oblast/*.json`,
    ]);

  const file = fileOf(section);
  const [secMap, ns] = await Promise.all([
    fetchData<Record<string, SectionRecord>>(
      `/${election}/sections/by-oblast/${file}.json`,
    ).catch(() => ({}) as Record<string, SectionRecord>),
    fetchNationalSummary<{ parties: NSParty[] }>(election),
  ]);
  const rec = secMap[section];
  if (!rec)
    return declineSection(
      "sectionResults",
      section,
      ctx.lang,
      "missing",
      [`${election}/sections/by-oblast/${file}.json`],
      { election: electionFullLabel(election, ctx.lang) },
    );

  const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
  const votes = rec.results?.votes ?? [];
  const totalValid = votes.reduce((s, v) => s + (v.totalVotes ?? 0), 0);
  const ranked = votes
    .filter((v) => (v.totalVotes ?? 0) > 0)
    .map((v) => {
      const p = byNum.get(v.partyNum);
      return {
        party: p?.nickName ?? `#${v.partyNum}`,
        color: p?.color,
        votes: v.totalVotes,
        pct: totalValid > 0 ? round2((100 * v.totalVotes) / totalValid) : 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);
  const top = ranked.slice(0, 12);

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

  const proto = rec.results?.protocol ?? {};
  const registered = proto.numRegisteredVoters ?? 0;
  const actual = proto.totalActualVoters ?? 0;
  const turnout = registered > 0 ? round2((100 * actual) / registered) : null;
  const machineValid = proto.numValidMachineVotes ?? 0;
  const paperValid = proto.numValidVotes ?? 0;
  const winner = top[0];
  const settlement = rec.settlement ?? "";
  const region = regionOf(rec, ctx.lang);
  const turnoutStr =
    turnout == null ? (bg ? "няма данни" : "n/a") : fmtPct(turnout, ctx.lang);
  const validStr = fmtInt(totalValid, ctx.lang);

  const facts: Record<string, string | number> = {
    section,
    election: electionFullLabel(election, ctx.lang),
    settlement,
    region,
    registered: fmtInt(registered, ctx.lang),
    voters: fmtInt(actual, ctx.lang),
    turnout: turnoutStr,
    valid_votes: validStr,
  };
  if (rec.address) facts.address = rec.address;
  if (machineValid > 0 || paperValid > 0) {
    facts.machine_votes = fmtInt(machineValid, ctx.lang);
    facts.paper_votes = fmtInt(paperValid, ctx.lang);
  }
  if (winner)
    facts.winner = `${winner.party} (${fmtPct(winner.pct, ctx.lang)})`;

  // settlement-level locator (skip abroad "32" — no polygon).
  const geo =
    rec.ekatte && rec.obshtina && rec.oblast !== "32"
      ? settlementLocator(rec.ekatte, rec.obshtina, settlement || section)
      : undefined;

  return {
    tool: "sectionResults",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Секция ${section}${settlement ? ` — ${settlement}` : ""} (${electionFullLabel(election, "bg")})`
      : `Section ${section}${settlement ? ` — ${settlement}` : ""} (${electionFullLabel(election, "en")})`,
    subtitle: bg
      ? `${region ? `${region} · ` : ""}активност ${turnoutStr} · ${validStr} действителни гласа`
      : `${region ? `${region} · ` : ""}turnout ${turnoutStr} · ${validStr} valid votes`,
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
    viz: top.length ? "bar" : "none",
    geo,
    facts,
    provenance: [
      `${election}/sections/by-oblast/${file}.json`,
      `${election}/national_summary.json`,
    ],
  };
};

// ---- one section, across elections (party-share trend) ----------------------

type CanonParty = {
  id: string;
  displayName: string;
  displayNameEn?: string;
  color?: string;
};
type Canonical = { parties: CanonParty[]; byNickName?: Record<string, string> };

// Lines to draw — top by peak share. Six keeps a per-section trend readable.
const MAX_LINES = 6;

type ShareLine = {
  name: string;
  nameEn?: string;
  color?: string;
  shareByEl: Map<string, number>;
  peak: number;
};

export const sectionHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const section = String(args.section ?? "").trim();
  if (!SECTION_ID.test(section))
    return declineSection("sectionHistory", section, ctx.lang, "format", [
      "*/sections/by-oblast/*.json",
    ]);
  const file = fileOf(section);
  const chrono = electionsChrono(); // oldest -> newest

  const [canon, fetched] = await Promise.all([
    fetchCanonicalParties<Canonical>(),
    Promise.all(
      chrono.map(async (e) => {
        try {
          const [secMap, ns] = await Promise.all([
            fetchData<Record<string, SectionRecord>>(
              `/${e.name}/sections/by-oblast/${file}.json`,
            ),
            fetchNationalSummary<{ parties: NSParty[] }>(e.name),
          ]);
          const rec = secMap[section];
          return rec ? { e, rec, ns } : null;
        } catch {
          return null;
        }
      }),
    ),
  ]);
  const got = fetched.filter(
    (
      x,
    ): x is {
      e: ElectionInfo;
      rec: SectionRecord;
      ns: { parties: NSParty[] };
    } => x != null,
  );
  if (!got.length)
    return declineSection("sectionHistory", section, ctx.lang, "missing", [
      `*/sections/by-oblast/${file}.json`,
    ]);

  const byId = new Map(canon.parties.map((c) => [c.id, c]));
  const idByNick = canon.byNickName ?? {};
  // canonical display name for a national nickName (merges renames for counting).
  const canonName = (nick: string): string => {
    const cp = byId.get(idByNick[nick] ?? "");
    return cp
      ? bg
        ? cp.displayName
        : (cp.displayNameEn ?? cp.displayName)
      : nick;
  };

  // Per-election leading party (canonicalised), oldest->newest.
  const perEl: { name: string; leader?: { party: string; pct: number } }[] = [];
  // Each canonical lineage's share per election (the multi-line trend).
  const lineMap = new Map<string, ShareLine>();

  got.forEach(({ e, rec, ns }) => {
    const nickByNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
    const votes = (rec.results?.votes ?? []).filter(
      (v) => (v.totalVotes ?? 0) > 0,
    );
    const total = votes.reduce((s, v) => s + v.totalVotes, 0);

    const topV = votes.reduce<VoteEntry | undefined>(
      (best, v) => (v.totalVotes > (best?.totalVotes ?? 0) ? v : best),
      undefined,
    );
    const topNick = topV
      ? (nickByNum.get(topV.partyNum)?.nickName ?? `#${topV.partyNum}`)
      : undefined;
    perEl.push({
      name: e.name,
      leader:
        topV && total > 0
          ? {
              party: canonName(topNick!),
              pct: round1((100 * topV.totalVotes) / total),
            }
          : undefined,
    });

    votes.forEach((v) => {
      const nsp = nickByNum.get(v.partyNum);
      const nick = nsp?.nickName ?? `#${v.partyNum}`;
      const id = idByNick[nick];
      const cp = id ? byId.get(id) : undefined;
      const key = id ?? `nick:${nick}`;
      let line = lineMap.get(key);
      if (!line) {
        line = {
          name: cp?.displayName ?? nick,
          nameEn: cp?.displayNameEn,
          color: cp?.color ?? nsp?.color,
          shareByEl: new Map(),
          peak: 0,
        };
        lineMap.set(key, line);
      }
      const share = total > 0 ? round1((100 * v.totalVotes) / total) : 0;
      // a lineage can absorb >1 nick in one election (rare merger) — sum them.
      line.shareByEl.set(e.name, (line.shareByEl.get(e.name) ?? 0) + share);
      if (cp) {
        line.name = cp.displayName;
        line.nameEn = cp.displayNameEn;
        line.color = cp.color;
      }
    });
  });

  const lines = [...lineMap.values()];
  lines.forEach((l) => {
    l.peak = Math.max(0, ...l.shareByEl.values());
  });
  lines.sort((a, b) => b.peak - a.peak);
  const shown = lines.slice(0, MAX_LINES);

  const categories = got.map((g) => electionShortLabel(g.e.name, ctx.lang));
  const series = shown.map((l, i) => ({
    key: `s${i}`,
    label: bg ? l.name : (l.nameEn ?? l.name),
    color: l.color,
    points: got.map((g) => ({
      x: electionShortLabel(g.e.name, ctx.lang),
      y: l.shareByEl.has(g.e.name) ? l.shareByEl.get(g.e.name)! : null,
    })),
  }));

  // Most frequent winner across the window (canonical names).
  const winCount = new Map<string, number>();
  perEl.forEach((p) => {
    if (p.leader)
      winCount.set(p.leader.party, (winCount.get(p.leader.party) ?? 0) + 1);
  });
  const rankedWins = [...winCount.entries()].sort((a, b) => b[1] - a[1]);
  const latest = got[got.length - 1];
  const latestLeader = perEl[perEl.length - 1]?.leader;
  const settlement = latest.rec.settlement ?? "";

  const facts: Record<string, string | number> = {
    section,
    settlement,
    region: regionOf(latest.rec, ctx.lang),
    elections_count: got.length,
    parties_shown: shown.length,
  };
  if (rankedWins[0])
    facts.most_frequent_winner = `${rankedWins[0][0]} (${rankedWins[0][1]}/${got.length})`;
  if (latestLeader)
    facts.latest = `${latestLeader.party} (${fmtPct(latestLeader.pct, ctx.lang)}, ${electionShortLabel(latest.e.name, ctx.lang)})`;
  // Per-party first->last share across the window.
  shown.forEach((l) => {
    const vals = got
      .map((g) => l.shareByEl.get(g.e.name))
      .filter((v): v is number => v != null);
    const first = vals[0];
    const last = vals[vals.length - 1];
    const label = bg ? l.name : (l.nameEn ?? l.name);
    facts[label] = first === last ? `${last}%` : `${first}% → ${last}%`;
  });

  return {
    tool: "sectionHistory",
    domain: "elections",
    kind: "series",
    title: bg
      ? `Секция ${section}${settlement ? ` — ${settlement}` : ""} през годините`
      : `Section ${section}${settlement ? ` — ${settlement}` : ""} over time`,
    subtitle: bg
      ? `Дял на гласовете по партия през ${got.length} избора`
      : `Vote share per party across ${got.length} elections`,
    categories,
    series,
    viz: "line",
    facts,
    provenance: [
      "canonical_parties.json",
      ...got.flatMap((g) => [
        `${g.e.name}/sections/by-oblast/${file}.json`,
        `${g.e.name}/national_summary.json`,
      ]),
    ],
  };
};

// ---- one section, risk-screening rap sheet ----------------------------------
// Mirrors the section page's risk panel: a station's risk SCREENING band per
// election (rap sheet) + whether it sits in a flagged problem (Roma-махала)
// neighborhood or a persistent cross-election cluster. Reads the slim
// per-section / membership reverse-indexes (sections/risk_history/<id>.json
// ~3 KB, problem_membership.json + cluster_persistence_membership.json ~15 KB
// each) — never the full national reports. A VIEW over published screening
// data; it makes no fraud claim.

type RiskHistoryEntry = {
  election: string;
  turnoutPct: number;
  winnerNickName?: string;
  winnerColor?: string;
  winnerSharePct?: number;
  score?: number;
  band?: "low" | "elevated" | "high" | "critical";
};
type ProblemMembership = { id: string; name_bg: string; name_en: string };
type ClusterMembership = { id: string; electionCount: number };

const BAND_LABEL: Record<string, { bg: string; en: string }> = {
  low: { bg: "Нисък", en: "Low" },
  elevated: { bg: "Повишен", en: "Elevated" },
  high: { bg: "Висок", en: "High" },
  critical: { bg: "Критичен", en: "Critical" },
};
const ELEVATED_BANDS = new Set(["elevated", "high", "critical"]);

export const sectionRiskHistory = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const section = String(args.section ?? "").trim();
  if (!SECTION_ID.test(section))
    return declineSection("sectionRiskHistory", section, ctx.lang, "format", [
      "sections/risk_history/*.json",
    ]);
  // Problem-neighborhood membership is per-election; use the resolved (default
  // latest) cycle for the "is it flagged now" badge. Cluster persistence and
  // the rap sheet are cross-election (one file each).
  const election = resolveElection(args, ctx);

  const grab = <T>(p: string): Promise<T | null> =>
    fetchData<T>(p).catch(() => null);
  const [history, problemMap, clusterMap, canon] = await Promise.all([
    grab<RiskHistoryEntry[]>(`/sections/risk_history/${section}.json`),
    grab<Record<string, ProblemMembership>>(
      `/${election}/problem_membership.json`,
    ),
    grab<Record<string, ClusterMembership>>(
      "/cluster_persistence_membership.json",
    ),
    fetchCanonicalParties<Canonical>().catch(() => null),
  ]);

  // The pipeline drops single-election sections (no rap sheet to show), so a
  // missing file means "nothing to report" — same as the section-page tile.
  if (!history || history.length === 0)
    return declineSection("sectionRiskHistory", section, ctx.lang, "missing", [
      `sections/risk_history/${section}.json`,
    ]);

  // Canonical display for a CEC nickname (merges renames; EN spellings).
  const idByNick = canon?.byNickName ?? {};
  const byId = new Map((canon?.parties ?? []).map((c) => [c.id, c]));
  const winnerName = (nick?: string): string => {
    if (!nick) return bg ? "няма данни" : "n/a";
    const cp = byId.get(idByNick[nick] ?? "");
    return cp
      ? bg
        ? cp.displayName
        : (cp.displayNameEn ?? cp.displayName)
      : nick;
  };
  const bandLabel = (b?: string): string =>
    b
      ? bg
        ? (BAND_LABEL[b]?.bg ?? b)
        : (BAND_LABEL[b]?.en ?? b)
      : bg
        ? "няма сигнал"
        : "no signal";

  const chrono = [...history].sort((a, b) =>
    a.election.localeCompare(b.election),
  );
  const screened = chrono.filter(
    (e) => e.band && ELEVATED_BANDS.has(e.band),
  ).length;

  const columns: Column[] = [
    { key: "election", label: bg ? "Избори" : "Election" },
    { key: "winner", label: bg ? "Победител" : "Winner" },
    {
      key: "turnout",
      label: bg ? "Активност" : "Turnout",
      numeric: true,
      format: "pct",
    },
    { key: "band", label: bg ? "Риск" : "Risk" },
    { key: "score", label: bg ? "Точки" : "Score" },
  ];
  const rows: Row[] = chrono.map((e) => ({
    election: electionShortLabel(e.election, ctx.lang),
    winner: winnerName(e.winnerNickName),
    turnout: round1(e.turnoutPct),
    band: bandLabel(e.band),
    score: e.score != null ? String(round1(e.score)) : "—",
  }));

  const problem = problemMap?.[section];
  const cluster = clusterMap?.[section];
  const latest = chrono[chrono.length - 1];

  const facts: Record<string, string | number> = {
    section,
    elections_count: chrono.length,
    screened_elevated: screened,
    latest: `${bandLabel(latest.band)} (${electionShortLabel(latest.election, ctx.lang)})`,
  };
  if (problem)
    facts.problem_neighborhood = bg ? problem.name_bg : problem.name_en;
  if (cluster)
    facts.persistent_cluster = bg
      ? `да, ${cluster.electionCount} избора`
      : `yes, ${cluster.electionCount} elections`;

  const subtitleParts: string[] = [
    bg
      ? screened > 0
        ? `повишен риск при скрининг в ${screened} от ${chrono.length} избора`
        : `без повишен риск в нито един от ${chrono.length} избора`
      : screened > 0
        ? `elevated screening in ${screened} of ${chrono.length} elections`
        : `no elevated screening in any of ${chrono.length} elections`,
  ];
  if (problem)
    subtitleParts.push(
      bg
        ? `проблемна секция: ${problem.name_bg}`
        : `problem section: ${problem.name_en}`,
    );
  if (cluster)
    subtitleParts.push(
      bg
        ? `повтарящ се клъстер (${cluster.electionCount}×)`
        : `persistent cluster (${cluster.electionCount}×)`,
    );

  const provenance = [
    `sections/risk_history/${section}.json`,
    "cluster_persistence_membership.json",
  ];
  if (problemMap) provenance.push(`${election}/problem_membership.json`);
  if (canon) provenance.push("canonical_parties.json");

  return {
    tool: "sectionRiskHistory",
    domain: "elections",
    kind: "table",
    title: bg
      ? `Секция ${section} — история на риска`
      : `Section ${section} — risk history`,
    subtitle: subtitleParts.join(" · "),
    columns,
    rows,
    viz: "none",
    facts,
    provenance,
  };
};
