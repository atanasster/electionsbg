/**
 * Compute polling-agency accuracy metrics by joining public/polls/polls{,_details}.json
 * with actual results in public/{YYYY_MM_DD}/national_summary.json.
 *
 * Outputs public/polls/accuracy.json with:
 *   - per-election errors per agency (using each agency's *last* pre-election poll)
 *   - per-agency aggregate profile: overall MAE, party-level signed bias, ideological-bloc lean
 *
 * Usage:
 *   tsx scripts/polls/analyze_accuracy.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string } from "cmd-ts";
import { normKey, resolveActualKey } from "@/data/polls/aliases";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLLS_DIR = path.resolve(__dirname, "../../data/polls");
const DATA_DIR = path.resolve(__dirname, "../../data");

type Lang = { en: string; bg: string };

type Agency = {
  id: string;
  website: string | null;
  name_bg: string;
  name_en: string;
  abbr_bg: string;
  abbr_en: string;
};

type PollGenre = "raw_attitudes" | "forecast" | "both_published" | "unclear";

type PollResidual = {
  undecided: number | null;
  wontVote: number | null;
  wontSay: number | null;
  otherNamedMinor: number | null;
  notes?: string;
};

type Poll = {
  id: string;
  agencyId: string;
  fieldwork: string;
  electionDate: string | null;
  respondents: number | null;
  methodology: Lang;
  source: string;
  genre?: PollGenre;
  residual?: PollResidual | null;
};

type PollDetail = {
  pollId: string;
  agencyId: string;
  support: number;
  nickName_bg: string;
  nickName_en: string;
};

type ActualParty = {
  partyNum: number;
  nickName: string;
  name: string;
  totalVotes: number;
  pct: number;
  passedThreshold?: boolean;
};

type NationalSummary = {
  election: string;
  parties: ActualParty[];
};

// normKey / POLL_TO_ACTUAL / stripCoalitionPrefix / resolveActualKey live in
// src/data/polls/aliases.ts so the frontend and this script can't drift.

// Ideological blocs for "lean" computation. Keys are normalized actual-result nicknames.
type BlocId =
  | "right_govt"
  | "reformist"
  | "nationalist"
  | "left"
  | "minority"
  | "populist"
  | "other";

const BLOC_OF: Record<string, BlocId> = {
  "ГЕРБ-СДС": "right_govt",
  ГЕРБ: "right_govt",
  СК: "right_govt",
  ОДС: "right_govt",
  ДСБ: "right_govt",
  СБ: "right_govt",
  ДБ: "right_govt",
  ПП: "reformist",
  "ПП-ДБ": "reformist",
  ПрБ: "reformist",
  РБ: "reformist",
  Възраждане: "nationalist",
  Атака: "nationalist",
  ОП: "nationalist",
  ПФ: "nationalist",
  Сияние: "nationalist",
  Величие: "nationalist",
  МЕЧ: "nationalist",
  БСП: "left",
  "БСП-ОЛ": "left",
  ДПС: "minority",
  "ДПС-НН": "minority",
  АПС: "minority",
  ИТН: "populist",
  ВОЛЯ: "populist",
  Воля: "populist",
  БВ: "populist",
  ББЦ: "populist",
  ИСМВ: "populist",
  НДСВ: "populist",
};

const blocOf = (key: string): BlocId => BLOC_OF[key] ?? "other";

// Same party, different ballot abbreviation across cycles. Used to consolidate
// per-party bias/house-effect aggregations so e.g. ГЕРБ (2017) and ГЕРБ-СДС (2021+)
// show as one row rather than splitting samples between two near-identical labels.
const CANONICAL_KEY: Record<string, string> = {
  ГЕРБ: "ГЕРБ-СДС",
  ДПС: "ДПС-НН",
  БСП: "БСП-ОЛ",
  ВОЛЯ: "Воля",
};
const canonicalKey = (key: string): string => CANONICAL_KEY[key] ?? key;

const isoToFolder = (iso: string) => iso.replace(/-/g, "_");

const daysBetween = (a: string, b: string) => {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86400000);
};

// Parse the *end* date of a fieldwork string we wrote during scrape.
// Format examples produced by scrape_polls.ts:
//   "Mar 12-20 2026"        → 2026-03-20
//   "Feb 23 - Mar 2 2026"   → 2026-03-02
//   "Mar 19 2026"           → 2026-03-19
//   "Mar 2024"              → 2024-03-15 (mid-month)
const MONTH_EN: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const parseFieldworkEnd = (fw: string): string | null => {
  const s = fw.trim();
  // "through Mon D YYYY" — used for ML records where we know the publication date but
  // not the exact fieldwork range.
  let m = s.match(/^through\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/i);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Cross-month range: "Mon D - Mon D YYYY"
  m = s.match(
    /^([A-Za-z]{3})\s+\d{1,2}\s*-\s*([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/,
  );
  if (m) {
    const mo = MONTH_EN[m[2].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[4]}-${String(mo + 1).padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  // Same-month range: "Mon D-D YYYY"
  m = s.match(/^([A-Za-z]{3})\s+\d{1,2}-(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Single date: "Mon D YYYY"
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    if (mo === undefined) return null;
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Fuzzy "Mon YYYY" or "Early Jul YYYY" etc — fall back to mid-month if a month/year are present.
  m = s.match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase().slice(0, 3)];
    if (mo === undefined) return null;
    return `${m[2]}-${String(mo + 1).padStart(2, "0")}-15`;
  }
  return null;
};

type ElectionAgencyError = {
  agencyId: string;
  pollId: string;
  fieldworkEnd: string;
  daysBefore: number;
  respondents: number | null;
  genre?: PollGenre;
  // Proportional redistribution applied to polled shares before scoring against
  // the official result. `redistributed` is the total residual (in pp) that was
  // spread across the named parties: undecided + wontSay. wontVote is excluded
  // since those respondents don't appear in the official-result denominator either.
  normalization: { applied: boolean; redistributed: number };
  errors: {
    key: string;
    polled: number;
    polledRaw: number;
    actual: number;
    error: number;
  }[];
  mae: number;
  rmse: number;
  biggestMiss: { key: string; error: number };
};

type ElectionAccuracy = {
  electionDate: string;
  actualResults: { key: string; pct: number; passedThreshold: boolean }[];
  agencies: ElectionAgencyError[];
};

type AgencyGrade = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

type AgencyProfile = {
  agencyId: string;
  name_bg: string;
  name_en: string;
  totalPolls: number;
  preElectionPolls: number;
  electionsCovered: string[];
  overallMAE: number;
  overallRMSE: number;
  // Sample-weighted, industry-bias-subtracted MAE. Each per-party error has the
  // cross-agency mean error for that (election, party) subtracted before |·| is
  // taken, then errors are pooled across the agency's polls with weight = √n so
  // larger samples count for more. Captures "skill relative to peers" rather
  // than absolute MAE, which mixes agency-specific error with industry-wide
  // cycle shocks (e.g. ПрБ 2026 missed -8 to -15 pp across every agency).
  overallMAEAdjusted: number;
  // MAE shrunk toward the cross-agency mean using k pseudo-elections, so a single-cycle
  // agency cannot rank above a long-running one purely on luck. Formula:
  //   shrunk = (n × raw + k × overallMean) / (n + k)
  shrunkMAE: number;
  // Adjusted MAE put through the same Bayesian shrinkage as shrunkMAE. The
  // letter grade is derived from this — it's the most defensible aggregate.
  shrunkMAEAdjusted: number;
  // Median days-before-vote across the agency's scored polls. A small number means the
  // agency typically polls right before vote (a structural advantage on accuracy);
  // a large number means stale polls drive the score.
  medianDaysBefore: number | null;
  // Per-poll signed difference vs. the consensus of *other* agencies on the same cycle.
  // Positive = this agency was closer to the actual result than the rest of the field.
  // Captures whether an agency adds information beyond what the consensus already gives.
  plusMinus: number | null;
  plusMinusSamples: number;
  // Share of (party, agency-poll, election) triples where the agency's polled share
  // correctly placed the party on the right side of the 4% barrier (above/below).
  // Range 0..1; null if no scored parties.
  barrierCallRate: number | null;
  barrierCallTotal: number;
  // Composite grade derived from shrunkMAE + plusMinus + barrierCallRate. Tunable
  // thresholds in `gradeFor` below.
  grade: AgencyGrade;
  // MAE per election the agency covered, for the per-agency trend sparkline.
  maeHistory: { electionDate: string; mae: number; rmse: number }[];
  partyBias: { key: string; meanError: number; samples: number }[];
  blocLean: Record<BlocId, { meanError: number; samples: number }>;
  // Relative-to-consensus house effect: how each agency differs from the cross-agency mean
  // *of the same election cycle* — flags lean even without ground truth (useful for inter-
  // election polls).
  houseEffect: { key: string; meanDiff: number; samples: number }[];
};

// Bayesian shrinkage strength. k=4 means an agency with 4 elections sits halfway between
// its own MAE and the cross-agency mean; with 1 election it's 80% pulled to the mean.
// Choice of k: at 4 it takes about 4 cycles before an agency's own data outweighs the
// prior, which matches the empirical observation that single-cycle MAE varies by ±1pp
// from an agency's long-run mean for the agencies in this dataset. k=3 (looser) lets a
// good single-cycle reading rank too high; k=5 (tighter) over-pulls established agencies
// toward the middle. Sensitivity analysis: ranking and grades are stable for k ∈ [3, 6].
const SHRINKAGE_K = 4;

// Threshold for "passed the barrier" — all post-2005 elections used 4%. (Pre-2005
// thresholds existed but predate our dataset.)
const BARRIER_PCT = 4;

const gradeFor = (
  shrunkMAEAdjusted: number,
  plusMinus: number | null,
  plusMinusSamples: number,
  barrierCallRate: number | null,
  barrierCallTotal: number,
): AgencyGrade => {
  // Adjust the (industry-bias-subtracted) shrunk MAE downward for agencies that
  // beat consensus and call the barrier well. The bumps are small so the MAE
  // remains the dominant signal. Thresholds are calibrated for the adjusted
  // scale — industry-wide cycle shocks are already removed, so the typical
  // range is ~0.6–2.5 rather than ~1.6–4.
  //
  // Both secondary signals are scaled down by sample-size confidence: an
  // agency with 1 election shouldn't get the full plus-minus / barrier bonus
  // (or penalty) of an 8-election agency. Confidence ramps to full strength
  // at 3 samples; below that the signal is treated as low-confidence.
  const pmConf = Math.min(1, plusMinusSamples / 3);
  const barrierConf = Math.min(1, barrierCallTotal / 30);
  const pmAdj =
    plusMinus === null ? 0 : Math.max(-0.5, Math.min(0.5, plusMinus)) * pmConf;
  const barrierAdj =
    barrierCallRate === null ? 0 : (barrierCallRate - 0.85) * barrierConf;
  const score = shrunkMAEAdjusted - pmAdj * 0.5 - barrierAdj;
  if (score < 0.85) return "A+";
  if (score < 1.0) return "A";
  if (score < 1.15) return "B+";
  if (score < 1.3) return "B";
  if (score < 1.5) return "C+";
  if (score < 1.8) return "C";
  if (score < 2.2) return "D";
  return "F";
};

const readJson = <T>(file: string): T | null => {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
};

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

// Apply proportional redistribution of the will-vote residual (undecided + wontSay)
// across the named-party shares — standard proportional reallocation:
//
//   newShare[i] = share[i] × (1 + R / Σshare)   where R = undecided + wontSay
//
// wontVote is intentionally excluded — those respondents won't show up in the
// official-result denominator either, so their shares shouldn't be reattributed.
// otherNamedMinor is also left alone — it represents itemised small parties that
// already exist in the named-party set or in the official "Other" bucket.
//
// Genre gates whether redistribution is applied:
// - "raw_attitudes" / "both_published": the stored shares include the undecided
//   in the denominator → redistribute.
// - "forecast": the agency already absorbed the undecided → DON'T redistribute
//   (residual is informational only).
// - "unclear" / undefined: be conservative, DON'T redistribute.
const shouldRedistribute = (genre: PollGenre | undefined): boolean =>
  genre === "raw_attitudes" || genre === "both_published";

const computeRedistribution = (
  residual: PollResidual | null | undefined,
  genre: PollGenre | undefined,
): number => {
  if (!residual || !shouldRedistribute(genre)) return 0;
  const u = residual.undecided ?? 0;
  const ws = residual.wontSay ?? 0;
  return u + ws;
};

const computeElectionAccuracy = (
  electionDate: string,
  polls: Poll[],
  details: PollDetail[],
): ElectionAccuracy | null => {
  const summary = readJson<NationalSummary>(
    path.join(DATA_DIR, isoToFolder(electionDate), "national_summary.json"),
  );
  if (!summary) {
    console.warn(`  ! no national_summary for ${electionDate}`);
    return null;
  }
  const actuals = new Map<string, ActualParty>();
  for (const p of summary.parties) actuals.set(p.nickName, p);
  const actualKeys = new Set(actuals.keys());

  const cyclePolls = polls.filter((p) => p.electionDate === electionDate);
  // Group by agency; pick the poll whose fieldworkEnd is closest before electionDate.
  const byAgency = new Map<string, Poll[]>();
  for (const p of cyclePolls) {
    const arr = byAgency.get(p.agencyId) ?? [];
    arr.push(p);
    byAgency.set(p.agencyId, arr);
  }

  const agencyResults: ElectionAgencyError[] = [];
  for (const [agencyId, agencyPolls] of byAgency) {
    let last: { poll: Poll; end: string } | null = null;
    for (const poll of agencyPolls) {
      const end = parseFieldworkEnd(poll.fieldwork);
      if (!end) continue;
      if (end > electionDate) continue; // post-election poll, ignore
      if (!last || end > last.end) last = { poll, end };
    }
    if (!last) continue;

    const polledRows = details.filter((d) => d.pollId === last.poll.id);
    const sumNamed = polledRows.reduce((s, r) => s + r.support, 0);
    const redistributed = computeRedistribution(
      last.poll.residual,
      last.poll.genre,
    );
    const scale =
      redistributed > 0 && sumNamed > 0 ? 1 + redistributed / sumNamed : 1;
    const errors: ElectionAgencyError["errors"] = [];
    for (const r of polledRows) {
      const key = resolveActualKey(r.nickName_bg, actualKeys);
      if (!key) continue;
      const actual = actuals.get(key)!;
      const polled = round(r.support * scale);
      errors.push({
        key,
        polled,
        polledRaw: r.support,
        actual: actual.pct,
        error: round(polled - actual.pct),
      });
    }
    if (errors.length === 0) continue;

    const absErrors = errors.map((e) => Math.abs(e.error));
    const mae = round(mean(absErrors));
    const rmse = round(Math.sqrt(mean(absErrors.map((e) => e * e))));
    const biggest = errors.reduce((a, b) =>
      Math.abs(b.error) > Math.abs(a.error) ? b : a,
    );
    agencyResults.push({
      agencyId,
      pollId: last.poll.id,
      fieldworkEnd: last.end,
      daysBefore: daysBetween(last.end, electionDate),
      respondents: last.poll.respondents,
      genre: last.poll.genre,
      normalization: {
        applied: scale !== 1,
        redistributed: round(redistributed),
      },
      errors: errors.sort((a, b) => Math.abs(b.error) - Math.abs(a.error)),
      mae,
      rmse,
      biggestMiss: { key: biggest.key, error: biggest.error },
    });
  }
  agencyResults.sort((a, b) => a.mae - b.mae);

  return {
    electionDate,
    actualResults: summary.parties
      .filter((p) => p.pct >= 0.1)
      .map((p) => ({
        key: p.nickName,
        pct: p.pct,
        passedThreshold: !!p.passedThreshold,
      })),
    agencies: agencyResults,
  };
};

const computeHouseEffects = (
  polls: Poll[],
  details: PollDetail[],
): Map<string, { key: string; diffs: number[] }[]> => {
  // For every (cycle, party), compute the cross-agency mean across all polls in that cycle,
  // then per-agency mean diff. "cycle" = electionDate or null (inter-election → bucketed by
  // calendar quarter to avoid washing out drift).
  const cycleKey = (p: Poll): string => {
    if (p.electionDate) return `e:${p.electionDate}`;
    const end = parseFieldworkEnd(p.fieldwork);
    if (!end) return "unknown";
    return `q:${end.slice(0, 7)}`; // YYYY-MM bucket
  };
  const cycleParty = new Map<string, Map<string, number[]>>(); // cycleKey → party → all support values

  const detailsByPoll = new Map<string, PollDetail[]>();
  for (const d of details) {
    const arr = detailsByPoll.get(d.pollId) ?? [];
    arr.push(d);
    detailsByPoll.set(d.pollId, arr);
  }

  const records: {
    agencyId: string;
    party: string;
    support: number;
    cycleKey: string;
  }[] = [];
  for (const p of polls) {
    const ck = cycleKey(p);
    const polledRows = detailsByPoll.get(p.id) ?? [];
    for (const r of polledRows) {
      const party = canonicalKey(normKey(r.nickName_bg));
      records.push({
        agencyId: p.agencyId,
        party,
        support: r.support,
        cycleKey: ck,
      });
      const cm = cycleParty.get(ck) ?? new Map<string, number[]>();
      const arr = cm.get(party) ?? [];
      arr.push(r.support);
      cm.set(party, arr);
      cycleParty.set(ck, cm);
    }
  }

  // Per-agency diff vs cycle mean (only when ≥2 agencies in that cycle for that party)
  const agencyDiffs = new Map<string, Map<string, number[]>>();
  for (const rec of records) {
    const cycle = cycleParty.get(rec.cycleKey)!;
    const series = cycle.get(rec.party) ?? [];
    if (series.length < 2) continue;
    const cycleMean = mean(series);
    const am = agencyDiffs.get(rec.agencyId) ?? new Map<string, number[]>();
    const arr = am.get(rec.party) ?? [];
    arr.push(rec.support - cycleMean);
    am.set(rec.party, arr);
    agencyDiffs.set(rec.agencyId, am);
  }

  const out = new Map<string, { key: string; diffs: number[] }[]>();
  for (const [agencyId, partyMap] of agencyDiffs) {
    const arr: { key: string; diffs: number[] }[] = [];
    for (const [party, diffs] of partyMap) arr.push({ key: party, diffs });
    out.set(agencyId, arr);
  }
  return out;
};

// Industry-wide bias per (electionDate, canonical party key) — the cross-agency
// MEDIAN signed error for that party in that cycle. Subtracted from each
// agency's error before computing the adjusted MAE so cycle-wide forecast
// shocks (a new party absorbing late-deciders, an industry-wide turnout-model
// miss) aren't charged to individual agencies. Median is used instead of mean
// because with the small N typical for Bulgaria (3–7 agencies per cycle) a
// single outlier can shift the mean noticeably (e.g. GERB-СДС 2026: mean
// +7.58 vs median +6.21, gap driven by two outlier agencies). Median is the
// more robust central tendency for outlier-sensitive small-N samples and is
// the same choice Silver Bulletin makes in its consensus comparisons. Only
// computed where ≥3 agencies covered the (cycle, party) — below that the
// "consensus" isn't meaningful.
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const computeIndustryBias = (
  elections: ElectionAccuracy[],
): Map<string, Map<string, number>> => {
  const out = new Map<string, Map<string, number>>();
  const MIN_AGENCIES = 3;
  for (const e of elections) {
    const byParty = new Map<string, number[]>();
    for (const ag of e.agencies) {
      for (const err of ag.errors) {
        const key = canonicalKey(err.key);
        const arr = byParty.get(key) ?? [];
        arr.push(err.error);
        byParty.set(key, arr);
      }
    }
    const m = new Map<string, number>();
    for (const [party, errs] of byParty) {
      if (errs.length < MIN_AGENCIES) continue;
      m.set(party, median(errs));
    }
    out.set(e.electionDate, m);
  }
  return out;
};

const buildAgencyProfiles = (
  agencies: Agency[],
  polls: Poll[],
  details: PollDetail[],
  elections: ElectionAccuracy[],
): AgencyProfile[] => {
  const houseEffectsRaw = computeHouseEffects(polls, details);
  const industryBias = computeIndustryBias(elections);

  return agencies.map((a) => {
    const allErrors: {
      key: string;
      error: number;
      abs: number;
      adjustedAbs: number;
      weight: number;
    }[] = [];
    const electionsCovered: string[] = [];
    const daysBeforeSamples: number[] = [];
    let preElectionPolls = 0;
    for (const e of elections) {
      const agencyEntry = e.agencies.find((x) => x.agencyId === a.id);
      if (!agencyEntry) continue;
      electionsCovered.push(e.electionDate);
      preElectionPolls += 1;
      daysBeforeSamples.push(agencyEntry.daysBefore);
      // Sample-size weight: √n. Falls back to √1000 when respondents is unknown
      // (most BG polls are ~1000) so missing-data polls aren't excluded entirely.
      const n = agencyEntry.respondents ?? 1000;
      const weight = Math.sqrt(n);
      const cycleBias = industryBias.get(e.electionDate) ?? new Map();
      for (const err of agencyEntry.errors) {
        const bias = cycleBias.get(canonicalKey(err.key)) ?? 0;
        allErrors.push({
          key: err.key,
          error: err.error,
          abs: Math.abs(err.error),
          adjustedAbs: Math.abs(err.error - bias),
          weight,
        });
      }
    }
    const sortedDB = [...daysBeforeSamples].sort((x, y) => x - y);
    const medianDaysBefore =
      sortedDB.length === 0
        ? null
        : sortedDB.length % 2 === 1
          ? sortedDB[(sortedDB.length - 1) / 2]
          : Math.round(
              (sortedDB[sortedDB.length / 2 - 1] +
                sortedDB[sortedDB.length / 2]) /
                2,
            );

    const overallMAE = round(mean(allErrors.map((e) => e.abs)));
    const overallRMSE = round(
      Math.sqrt(mean(allErrors.map((e) => e.abs * e.abs))),
    );

    // Sample-weighted MAE on industry-bias-adjusted errors.
    const totalWeight = allErrors.reduce((s, e) => s + e.weight, 0);
    const overallMAEAdjusted =
      totalWeight === 0
        ? 0
        : round(
            allErrors.reduce((s, e) => s + e.adjustedAbs * e.weight, 0) /
              totalWeight,
          );

    // Party bias = mean signed error per party (positive = agency overestimates that party).
    // Consolidate cross-cycle renames (e.g. ГЕРБ → ГЕРБ-СДС, ДПС → ДПС-НН) under the canonical key.
    const byParty = new Map<string, number[]>();
    for (const e of allErrors) {
      const key = canonicalKey(e.key);
      const arr = byParty.get(key) ?? [];
      arr.push(e.error);
      byParty.set(key, arr);
    }
    const partyBias = [...byParty.entries()]
      .map(([key, errs]) => ({
        key,
        meanError: round(mean(errs)),
        samples: errs.length,
      }))
      .sort((a, b) => Math.abs(b.meanError) - Math.abs(a.meanError));

    // Bloc lean = mean signed error per bloc (averaged across all party-elections in that bloc)
    const byBloc = new Map<BlocId, number[]>();
    for (const e of allErrors) {
      const bloc = blocOf(e.key);
      const arr = byBloc.get(bloc) ?? [];
      arr.push(e.error);
      byBloc.set(bloc, arr);
    }
    const blocLean: AgencyProfile["blocLean"] = {
      right_govt: { meanError: 0, samples: 0 },
      reformist: { meanError: 0, samples: 0 },
      nationalist: { meanError: 0, samples: 0 },
      left: { meanError: 0, samples: 0 },
      minority: { meanError: 0, samples: 0 },
      populist: { meanError: 0, samples: 0 },
      other: { meanError: 0, samples: 0 },
    };
    for (const [bloc, errs] of byBloc) {
      blocLean[bloc] = { meanError: round(mean(errs)), samples: errs.length };
    }

    // House effect (per-cycle relative to consensus)
    const heRaw = houseEffectsRaw.get(a.id) ?? [];
    const houseEffect = heRaw
      .map((h) => ({
        key: h.key,
        meanDiff: round(mean(h.diffs)),
        samples: h.diffs.length,
      }))
      .filter((h) => h.samples >= 2)
      .sort((a, b) => Math.abs(b.meanDiff) - Math.abs(a.meanDiff))
      .slice(0, 12);

    // Plus/Minus: per (agency, election), compare this agency's MAE to the average
    // MAE of every *other* agency in the same cycle. Aggregate across the agency's
    // covered elections. Positive means this agency consistently beats the consensus.
    const pmSamples: number[] = [];
    for (const e of elections) {
      const me = e.agencies.find((x) => x.agencyId === a.id);
      if (!me) continue;
      const others = e.agencies.filter((x) => x.agencyId !== a.id);
      if (others.length === 0) continue;
      const consensus = mean(others.map((x) => x.mae));
      pmSamples.push(consensus - me.mae);
    }
    const plusMinus = pmSamples.length === 0 ? null : round(mean(pmSamples));

    // Barrier-call: did the agency place each party on the right side of 4%?
    // Counted per (agency, election, party). Both sides matter — a party shown at
    // 5% that actually got 3% is wrong; one shown at 3% that got 5% is also wrong.
    let barrierCorrect = 0;
    let barrierTotal = 0;
    for (const e of elections) {
      const me = e.agencies.find((x) => x.agencyId === a.id);
      if (!me) continue;
      const passedSet = new Set(
        e.actualResults.filter((r) => r.passedThreshold).map((r) => r.key),
      );
      for (const err of me.errors) {
        const polledAbove = err.polled >= BARRIER_PCT;
        const actualAbove = passedSet.has(err.key);
        barrierTotal += 1;
        if (polledAbove === actualAbove) barrierCorrect += 1;
      }
    }
    const barrierCallRate =
      barrierTotal === 0 ? null : round(barrierCorrect / barrierTotal, 3);

    // MAE history per election, in chronological order, for the trend sparkline.
    const maeHistory = elections
      .filter((e) => e.agencies.some((x) => x.agencyId === a.id))
      .map((e) => {
        const me = e.agencies.find((x) => x.agencyId === a.id)!;
        return { electionDate: e.electionDate, mae: me.mae, rmse: me.rmse };
      })
      .sort((x, y) => (x.electionDate < y.electionDate ? -1 : 1));

    return {
      agencyId: a.id,
      name_bg: a.name_bg,
      name_en: a.name_en,
      totalPolls: polls.filter((p) => p.agencyId === a.id).length,
      preElectionPolls,
      electionsCovered,
      overallMAE,
      overallRMSE,
      overallMAEAdjusted,
      // Placeholders — shrunk MAE and grade depend on the cross-agency mean, computed
      // after this loop. Filled in by the caller.
      shrunkMAE: overallMAE,
      shrunkMAEAdjusted: overallMAEAdjusted,
      medianDaysBefore,
      plusMinus,
      plusMinusSamples: pmSamples.length,
      barrierCallRate,
      barrierCallTotal: barrierTotal,
      grade: "B" as AgencyGrade,
      maeHistory,
      partyBias: partyBias.slice(0, 12),
      blocLean,
      houseEffect,
    };
  });
};

const main = async (opts: { pollsDir: string }) => {
  const polls = readJson<Poll[]>(path.join(opts.pollsDir, "polls.json"));
  const details = readJson<PollDetail[]>(
    path.join(opts.pollsDir, "polls_details.json"),
  );
  const agencies = readJson<Agency[]>(
    path.join(opts.pollsDir, "agencies.json"),
  );
  if (!polls || !details || !agencies) {
    throw new Error(
      `missing polls files in ${opts.pollsDir} — run scrape_polls first`,
    );
  }

  const electionDates = [
    ...new Set(
      polls.map((p) => p.electionDate).filter((d): d is string => !!d),
    ),
  ].sort();
  console.log(
    `→ analyzing ${electionDates.length} elections, ${polls.length} polls, ${agencies.length} agencies`,
  );

  const elections: ElectionAccuracy[] = [];
  for (const d of electionDates) {
    const e = computeElectionAccuracy(d, polls, details);
    if (e) elections.push(e);
  }
  elections.sort((a, b) => (a.electionDate < b.electionDate ? 1 : -1));

  // Drop the "NA" pseudo-agency (general-consensus placeholder, not a real pollster)
  const realAgencies = agencies.filter((a) => a.id !== "NA");
  const profilesRaw = buildAgencyProfiles(
    realAgencies,
    polls,
    details,
    elections,
  ).filter((p) => p.preElectionPolls > 0);

  // Shrunk MAE: pull each agency's MAE toward the cross-agency mean using k
  // pseudo-elections. Computed here (not inside buildAgencyProfiles) because
  // we need every agency's overallMAE to know the prior. We shrink both the
  // raw MAE and the bias-adjusted MAE separately so each metric has its own
  // proper prior — adjusted MAE is structurally lower (cycle shocks removed)
  // so it needs a lower prior to avoid over-shrinking.
  const overallMean = mean(profilesRaw.map((p) => p.overallMAE));
  const overallMeanAdjusted = mean(
    profilesRaw.map((p) => p.overallMAEAdjusted),
  );
  for (const p of profilesRaw) {
    const n = p.electionsCovered.length;
    p.shrunkMAE = round(
      (n * p.overallMAE + SHRINKAGE_K * overallMean) / (n + SHRINKAGE_K),
    );
    p.shrunkMAEAdjusted = round(
      (n * p.overallMAEAdjusted + SHRINKAGE_K * overallMeanAdjusted) /
        (n + SHRINKAGE_K),
    );
    p.grade = gradeFor(
      p.shrunkMAEAdjusted,
      p.plusMinus,
      p.plusMinusSamples,
      p.barrierCallRate,
      p.barrierCallTotal,
    );
  }
  // Sort by the adjusted shrunk MAE — same metric the letter grade uses, so the
  // ranking and the grade are consistent.
  const profiles = profilesRaw.sort(
    (a, b) => a.shrunkMAEAdjusted - b.shrunkMAEAdjusted,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    elections,
    agencyProfiles: profiles,
  };
  // Minified — ships to /public/ and is fetched client-side.
  fs.writeFileSync(
    path.join(opts.pollsDir, "accuracy.json"),
    JSON.stringify(out),
  );
  console.log(`✓ wrote ${path.join(opts.pollsDir, "accuracy.json")}`);

  // Console summary
  console.log(
    "\nAgency leaderboard (sorted by shrunk adjusted MAE; MAE/MAEadj are raw vs industry-bias-subtracted):",
  );
  for (const p of profiles) {
    const pm =
      p.plusMinus === null
        ? "  —  "
        : `${p.plusMinus >= 0 ? "+" : ""}${p.plusMinus.toFixed(2)}`;
    const bc =
      p.barrierCallRate === null
        ? "—"
        : `${(p.barrierCallRate * 100).toFixed(0)}%`;
    console.log(
      `  ${p.grade.padEnd(2)} ${p.agencyId.padEnd(5)} MAE=${p.overallMAE.toFixed(2)} MAEadj=${p.overallMAEAdjusted.toFixed(2)} shrunk=${p.shrunkMAE.toFixed(2)} shrunkAdj=${p.shrunkMAEAdjusted.toFixed(2)}  +/-=${pm}  barrier=${bc}  n=${p.electionsCovered.length}`,
    );
  }
  console.log("\nMost recent election (2026-04-19) — agency last-poll MAE:");
  const latest = elections.find((e) => e.electionDate === "2026-04-19");
  if (latest) {
    for (const a of latest.agencies) {
      console.log(
        `  ${a.agencyId.padEnd(5)} MAE=${a.mae.toFixed(2)}  ${a.daysBefore}d before  worst=${a.biggestMiss.key} (${a.biggestMiss.error > 0 ? "+" : ""}${a.biggestMiss.error})`,
      );
    }
  }
};

const cli = command({
  name: "analyze_accuracy",
  args: {
    pollsDir: option({
      type: string,
      long: "polls",
      defaultValue: () => POLLS_DIR,
    }),
  },
  handler: async (args) => {
    await main({ pollsDir: args.pollsDir });
  },
});

run(cli, process.argv.slice(2));
