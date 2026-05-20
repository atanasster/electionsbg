import fs from "fs";
import path from "path";
import type { ReportRow } from "@/data/dataTypes";

// Section-level risk SCREENING score (0–100).
//
// CRITICAL FRAMING:
//   This is a SCREENING tool, not a fraud determination. A high score
//   means "this section is statistically unusual along multiple
//   dimensions and warrants a closer look" — that is all. The score is
//   the sum of weighted, normalized sub-signals already published as
//   standalone reports on this site; assembling them into one number is
//   a convenience for prioritization, not a new claim of evidence.
//
// Signals & weights (v1, intentionally conservative):
//   - recount delta            weight 0.20 — magnitude of recount adjustment
//   - flash-memory mismatch    weight 0.20 — SUEMG file vs. machine vote delta
//   - invalid ballot share     weight 0.15 — % of paper ballots invalid
//   - additional voters share  weight 0.15 — % added on day-of to roll
//   - concentrated vote        weight 0.15 — top party's share when ≥80%
//   - peer outlier             weight 0.15 — z-score vs. settlement peers
//                                            on turnout & winner-share
//   - swing vs. prior election weight 0.15 — z-score of the UPWARD shift in
//                                            turnout & winner-share vs. the
//                                            same section last election
//
// Score = 100 × Σ(weight_i × normalized_i over signals i present) /
//                Σ(weight_i over signals i present)
//
// Partial-data masking: if only some signals are available (e.g. early
// elections with no SUEMG data), the denominator drops accordingly so
// the score isn't artificially deflated by missing inputs. A
// `signalsAvailable` count travels with every score so the UI can warn
// when the score is built on thin evidence.

const WEIGHTS = {
  recount: 0.2,
  suemgMismatch: 0.2,
  invalidBallots: 0.15,
  additionalVoters: 0.15,
  concentrated: 0.15,
  peerOutlier: 0.15,
  swing: 0.15,
} as const;

// Normalization caps — any value above the cap saturates the signal at
// 1.0. Chosen so a "noticeable" anomaly is roughly mid-range.
const CAPS = {
  recountPct: 0.5, // recount votes / total votes; cap at 50%
  suemgPct: 0.5, // |pctSuemg| / 100, cap at 50% delta
  invalidPct: 30, // % invalid ballots; cap at 30% (existing report threshold is 10%)
  additionalPct: 30,
  concentratedPct: 100, // already 0–100; map 80–100 to 0–1 (below 80 = 0)
  peerZ: 4, // z-score on turnout/winner-share, cap at 4σ
  swingZ: 4, // z-score of the cross-election shift, cap at 4σ
} as const;

export type RiskBand = "low" | "elevated" | "high" | "critical";

const bandOf = (score: number): RiskBand =>
  score < 30
    ? "low"
    : score < 60
      ? "elevated"
      : score < 80
        ? "high"
        : "critical";

export type RiskComponent = {
  id: keyof typeof WEIGHTS;
  rawValue?: number;
  normalized: number; // 0–1
  weight: number;
  contribution: number; // 0–100 contribution to final score
};

export type RiskScoreRow = {
  section: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  /** Section winner + its raw vote count and share. Surfaced in the
   * overview table's ПАРТИЯ + ГЛАСОВЕ + % columns to match every other
   * per-section report on the site. Note that the section winner is
   * NOT necessarily the party "affected" by the risk score — see
   * `affectedPartyNum` for that, and the methodology page for the
   * full distinction. */
  partyNum?: number;
  totalVotes?: number;
  pctPartyVote?: number;
  /** Party with the largest absolute vote change from a party-specific
   * risk signal (recount or SUEMG mismatch). Undefined when no
   * party-specific signal fired. */
  affectedPartyNum?: number;
  /** Signed vote change for `affectedPartyNum` (positive = gained,
   * negative = lost during the adjustment). */
  affectedPartyChange?: number;
  score: number; // 0–100
  band: RiskBand;
  signalsAvailable: number;
  signalsTotal: number;
  components: RiskComponent[];
  neighborhoodFlag?: boolean;
  /** Score's percentile within the section's municipality, 0–1. */
  percentileInMunicipality?: number;
};

export type RiskScoreReport = {
  election: string;
  generatedAt: string;
  signalsTotal: number;
  weights: typeof WEIGHTS;
  caps: typeof CAPS;
  rows: RiskScoreRow[];
};

// Tiny summary file consumed by the home-page risk tiles and the
// /risk-analysis page hero. Avoids shipping the full ~12 MB rows array
// to readers who only need band counts + the top critical sections.
// The full report stays at /reports/section/risk_score.json for the
// /risk-score table.
export type RiskScoreSummary = {
  election: string;
  generatedAt: string;
  signalsTotal: number;
  totalSections: number;
  counts: Record<RiskBand, number>;
  /** Sum of section votes (totalActualVoters) per band — used by the
   * composite Election Risk Index to vote-weight the section-screening
   * component on the same denominator (national turnout) as the other
   * vote-weighted components. */
  votesByBand: Record<RiskBand, number>;
  /** National total of section actual voters, summed across every row
   * regardless of band. The denominator for vote-weighted components. */
  totalActualVoters: number;
  /** Sum of machine votes in sections flagged as missing flash drive at
   * protocol time (component 4 of the composite). Vote-weighted variant
   * of the suemgMissingFlash count from national_summary. */
  missingFlashMachineVotes: number;
  topCritical: RiskScoreRow[];
};

// --- Spatial cluster detection -------------------------------------------
// A "cluster" is a knot of physically adjacent polling sections that all
// (a) screen elevated-or-above and (b) were won by the SAME party — the
// geographic fingerprint of a controlled / corporate-vote operation (a
// workforce or institution voting as a bloc across the sections that serve
// it), as opposed to a lone outlier section. This is a VIEW over the
// published risk scores, not an eighth signal — it does not feed back into
// the 0–100 score. The same "screening, not a verdict" caveat applies.

/** One detected cluster — a connected component of same-party, adjacent,
 * elevated-or-above sections. */
export type RiskCluster = {
  id: string;
  ekatte?: string;
  oblast?: string;
  obshtina?: string;
  partyNum?: number;
  sectionCount: number;
  sections: string[];
  meanScore: number;
  maxScore: number;
  /** Band of the highest-scoring member section — the cluster's headline
   * read, mirroring how single sections are surfaced band-first. */
  maxBand: RiskBand;
  centroid: { lat: number; lng: number };
};

/** One map marker — an elevated-or-above section with coordinates.
 * `clusterId` is set when the section belongs to a detected cluster. */
export type RiskMapSection = {
  section: string;
  lat: number;
  lng: number;
  band: RiskBand;
  score: number;
  partyNum?: number;
  ekatte?: string;
  clusterId?: string;
};

export type RiskClustersReport = {
  election: string;
  generatedAt: string;
  thresholds: {
    minSections: number;
    maxDistanceMeters: number;
    minBand: RiskBand;
  };
  clusters: RiskCluster[];
  mapSections: RiskMapSection[];
};

const TOP_CRITICAL_N = 10;

// Load a section-level report file and index by section ID.
const loadByKey = <T extends ReportRow & { section?: string }>(
  filePath: string,
): Map<string, T> => {
  const m = new Map<string, T>();
  if (!fs.existsSync(filePath)) return m;
  try {
    const rows = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T[];
    for (const r of rows) if (r.section) m.set(r.section, r);
  } catch {
    // ignore
  }
  return m;
};

// Load neighborhood-flagged section IDs from problem_sections.json.
const loadProblemSectionIds = (filePath: string): Set<string> => {
  const out = new Set<string>();
  if (!fs.existsSync(filePath)) return out;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      neighborhoods?: Array<{ sections?: Array<{ section?: string }> }>;
    };
    for (const n of data.neighborhoods ?? []) {
      for (const s of n.sections ?? []) {
        if (s.section) out.add(s.section);
      }
    }
  } catch {
    // ignore
  }
  return out;
};

// Per-section turnout + winner-share, used to compute peer-outlier
// z-scores. Loaded from the per-oblast section files (the same source
// the SPA uses for section detail pages).
type SectionStat = {
  section: string;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  /** Winning party's number — surfaced in the overview table's ПАРТИЯ
   * column so a reader can see which party led the section at a glance,
   * matching the convention of every other per-section report. */
  topPartyNum?: number;
  topPartyVotes?: number;
  totalVotes?: number;
  turnout: number;
  winnerShare: number;
};

const loadSectionStats = (
  publicFolder: string,
  year: string,
): SectionStat[] => {
  const dir = path.join(publicFolder, year, "sections", "by-oblast");
  if (!fs.existsSync(dir)) return [];
  const out: SectionStat[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf-8"),
      ) as Record<
        string,
        {
          section: string;
          ekatte?: string;
          obshtina?: string;
          oblast?: string;
          results?: {
            protocol?: {
              totalActualVoters?: number;
              numRegisteredVoters?: number;
            };
            votes?: { partyNum: number; totalVotes: number }[];
          };
        }
      >;
      for (const [secId, s] of Object.entries(data)) {
        const reg = s.results?.protocol?.numRegisteredVoters ?? 0;
        const actual = s.results?.protocol?.totalActualVoters ?? 0;
        if (!reg || !actual) continue;
        const votes = s.results?.votes ?? [];
        const totalVotes = votes.reduce((s2, v) => s2 + v.totalVotes, 0);
        let topPartyNum: number | undefined;
        let topPartyVotes = 0;
        for (const v of votes) {
          if (v.totalVotes > topPartyVotes) {
            topPartyVotes = v.totalVotes;
            topPartyNum = v.partyNum;
          }
        }
        if (totalVotes <= 0) continue;
        out.push({
          section: secId,
          ekatte: s.ekatte,
          obshtina: s.obshtina,
          oblast: s.oblast,
          topPartyNum,
          topPartyVotes,
          totalVotes,
          turnout: actual / reg,
          winnerShare: topPartyVotes / totalVotes,
        });
      }
    } catch {
      // ignore
    }
  }
  return out;
};

// Group by settlement (ekatte), compute mean+std of turnout & winner-share,
// then z-score every section against its settlement peers. Returns the
// MAX |z| across the two metrics — captures both "weirdly high turnout"
// and "weirdly concentrated vote" relative to the immediate neighbors.
const computePeerOutliers = (stats: SectionStat[]): Map<string, number> => {
  const bySettlement = new Map<string, SectionStat[]>();
  for (const s of stats) {
    if (!s.ekatte) continue;
    const arr = bySettlement.get(s.ekatte) ?? [];
    arr.push(s);
    bySettlement.set(s.ekatte, arr);
  }
  const out = new Map<string, number>();
  for (const [, arr] of bySettlement) {
    if (arr.length < 3) continue; // need ≥3 peers for a meaningful z-score
    const muT = arr.reduce((s, x) => s + x.turnout, 0) / arr.length;
    const muW = arr.reduce((s, x) => s + x.winnerShare, 0) / arr.length;
    const sdT = Math.sqrt(
      arr.reduce((s, x) => s + (x.turnout - muT) ** 2, 0) / arr.length,
    );
    const sdW = Math.sqrt(
      arr.reduce((s, x) => s + (x.winnerShare - muW) ** 2, 0) / arr.length,
    );
    for (const x of arr) {
      const zT = sdT > 0 ? Math.abs(x.turnout - muT) / sdT : 0;
      const zW = sdW > 0 ? Math.abs(x.winnerShare - muW) / sdW : 0;
      out.set(x.section, Math.max(zT, zW));
    }
  }
  return out;
};

// Cross-election swing: match each section to its counterpart in the
// PREVIOUS election (same section ID) and z-score the shift in turnout &
// winner-share against the national distribution of all section shifts.
// Captures the "corporate vote" fingerprint — a section that historically
// split its vote suddenly delivering a lopsided result at elevated
// turnout.
//
// Only UPWARD shifts count: a section that became less concentrated, or
// where turnout fell, is not a control signal, so negative z is clipped
// to 0. Ratios (turnout, winnerShare) are used rather than absolute vote
// counts so the signal is robust to section split/merge renumbering — a
// split halves both the numerator and denominator of each ratio.
//
// Abroad sections (oblast 32) are excluded: their section IDs are
// reassigned between elections (different host cities open each cycle),
// so a same-ID cross-election match there is spurious — it would both
// emit false signals and, as a wild outlier, inflate the national
// std-dev and deflate every real domestic z-score.
const SWING_MIN_VOTES = 50; // tiny sections: ratio deltas are rounding noise
const ABROAD_OBLAST = "32";

const computeSwing = (
  current: SectionStat[],
  prior: SectionStat[],
): Map<string, number> => {
  const priorById = new Map<string, SectionStat>();
  for (const s of prior) priorById.set(s.section, s);

  // Turnout (actual / registered) can exceed 100% in mobile / hospital /
  // care-home sections — a near-empty registration list with many day-of
  // additions. Clamp at 1.0 before differencing so those sections don't
  // emit a meaningless +200pp "turnout surge"; their winner-share delta
  // is still genuine and is kept.
  const clampedTurnout = (s: SectionStat) => Math.min(1, s.turnout);

  // First pass: signed deltas for matched, large-enough sections.
  type Delta = { section: string; dWinner: number; dTurnout: number };
  const deltas: Delta[] = [];
  for (const s of current) {
    if (s.oblast === ABROAD_OBLAST) continue;
    if ((s.totalVotes ?? 0) < SWING_MIN_VOTES) continue;
    const p = priorById.get(s.section);
    if (!p || (p.totalVotes ?? 0) < SWING_MIN_VOTES) continue;
    deltas.push({
      section: s.section,
      dWinner: s.winnerShare - p.winnerShare,
      dTurnout: clampedTurnout(s) - clampedTurnout(p),
    });
  }
  const out = new Map<string, number>();
  if (deltas.length < 3) return out; // need a distribution to z-score against

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs: number[], mu: number) =>
    Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
  const winnerDeltas = deltas.map((d) => d.dWinner);
  const turnoutDeltas = deltas.map((d) => d.dTurnout);
  const muW = mean(winnerDeltas);
  const sdW = std(winnerDeltas, muW);
  const muT = mean(turnoutDeltas);
  const sdT = std(turnoutDeltas, muT);

  for (const d of deltas) {
    const zW = sdW > 0 ? (d.dWinner - muW) / sdW : 0;
    const zT = sdT > 0 ? (d.dTurnout - muT) / sdT : 0;
    // Upward shift only — a section moving down is not a control signal.
    const z = Math.max(0, zW, zT);
    if (z > 0) out.set(d.section, z);
  }
  return out;
};

const clip01 = (x: number): number => Math.max(0, Math.min(1, x));

// Two sections are linked into the same cluster when they share a winning
// party and sit within CLUSTER_MAX_METERS of each other; connected
// components of at least CLUSTER_MIN_SECTIONS sections are reported.
// Proximity (not the EKATTE settlement code) does the grouping so a dense
// knot inside a large city is found without sweeping in that city's other
// scattered elevated sections.
const CLUSTER_MIN_SECTIONS = 3;
const CLUSTER_MAX_METERS = 600;

const haversineMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

// Build the map-marker list (every elevated-or-above section with known
// coordinates) and detect clusters within it.
const buildRiskClusters = (
  rows: RiskScoreRow[],
  coordsLookup: Record<string, { longitude: number; latitude: number }>,
): { clusters: RiskCluster[]; mapSections: RiskMapSection[] } => {
  const mapSections: RiskMapSection[] = [];
  const rowBySection = new Map<string, RiskScoreRow>();
  for (const r of rows) {
    if (r.band === "low") continue;
    // Abroad sections plot all over the globe — they would zoom the
    // Bulgaria map out to the whole world and cannot form a meaningful
    // geographic cluster anyway.
    if (r.oblast === ABROAD_OBLAST) continue;
    const c = coordsLookup[r.section];
    if (!c) continue;
    rowBySection.set(r.section, r);
    mapSections.push({
      section: r.section,
      lat: round6(c.latitude),
      lng: round6(c.longitude),
      band: r.band,
      score: r.score,
      partyNum: r.partyNum,
      ekatte: r.ekatte,
    });
  }

  // Connected components, computed inside each winning-party group so the
  // O(n²) proximity scan stays small.
  const byParty = new Map<number, RiskMapSection[]>();
  for (const m of mapSections) {
    if (m.partyNum === undefined) continue;
    const arr = byParty.get(m.partyNum) ?? [];
    arr.push(m);
    byParty.set(m.partyNum, arr);
  }

  const clusters: RiskCluster[] = [];
  let clusterSeq = 0;
  for (const [partyNum, group] of byParty) {
    const n = group.length;
    const seen = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i += 1) {
      if (seen[i]) continue;
      const component: number[] = [];
      const queue = [i];
      seen[i] = true;
      while (queue.length) {
        const cur = queue.pop() as number;
        component.push(cur);
        for (let j = 0; j < n; j += 1) {
          if (seen[j]) continue;
          if (haversineMeters(group[cur], group[j]) <= CLUSTER_MAX_METERS) {
            seen[j] = true;
            queue.push(j);
          }
        }
      }
      if (component.length < CLUSTER_MIN_SECTIONS) continue;
      const members = component.map((idx) => group[idx]);
      const id = `c${clusterSeq}`;
      clusterSeq += 1;
      for (const m of members) m.clusterId = id;
      const scores = members.map((m) => m.score);
      const ekatteCounts = new Map<string, number>();
      for (const m of members) {
        if (m.ekatte) {
          ekatteCounts.set(m.ekatte, (ekatteCounts.get(m.ekatte) ?? 0) + 1);
        }
      }
      let ekatte: string | undefined;
      let bestEkatte = 0;
      for (const [e, cnt] of ekatteCounts) {
        if (cnt > bestEkatte) {
          bestEkatte = cnt;
          ekatte = e;
        }
      }
      const sampleRow = rowBySection.get(members[0].section);
      clusters.push({
        id,
        ekatte,
        oblast: sampleRow?.oblast,
        obshtina: sampleRow?.obshtina,
        partyNum,
        sectionCount: members.length,
        sections: members.map((m) => m.section),
        meanScore:
          Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) /
          10,
        maxScore: Math.max(...scores),
        maxBand: bandOf(Math.max(...scores)),
        centroid: {
          lat: round6(members.reduce((s, m) => s + m.lat, 0) / members.length),
          lng: round6(members.reduce((s, m) => s + m.lng, 0) / members.length),
        },
      });
    }
  }
  // Strongest first: more sections, then higher mean score.
  clusters.sort(
    (a, b) => b.sectionCount - a.sectionCount || b.meanScore - a.meanScore,
  );
  // Ascending score so the frontend renders high-risk markers last (on top).
  mapSections.sort((a, b) => a.score - b.score);
  return { clusters, mapSections };
};

export const generateRiskScoreReport = ({
  publicFolder,
  reportsFolder,
  year,
  prevYear,
  coordsLookup,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  year: string;
  /** Name of the immediately preceding election (e.g. "2024_06_09").
   * Used to compute the cross-election swing signal. Undefined for the
   * earliest election — the swing signal then simply never fires. */
  prevYear?: string;
  /** Section-id → GPS lookup (built once in index.ts). Used to place
   * elevated sections on the cluster map; clusters are skipped for
   * sections without coordinates. */
  coordsLookup?: Record<string, { longitude: number; latitude: number }>;
  stringify: (o: object) => string;
}): void => {
  const sectionDir = `${reportsFolder}/section`;
  const recount = loadByKey<ReportRow & { section?: string }>(
    `${sectionDir}/recount.json`,
  );
  const suemgAdded = loadByKey<
    ReportRow & { section?: string; pctSuemg?: number }
  >(`${sectionDir}/suemg_added.json`);
  const suemgRemoved = loadByKey<
    ReportRow & { section?: string; pctSuemg?: number }
  >(`${sectionDir}/suemg_removed.json`);
  const invalid = loadByKey<ReportRow & { section?: string }>(
    `${sectionDir}/invalid_ballots.json`,
  );
  const additional = loadByKey<ReportRow & { section?: string }>(
    `${sectionDir}/additional_voters.json`,
  );
  const concentrated = loadByKey<ReportRow & { section?: string }>(
    `${sectionDir}/concentrated.json`,
  );
  const problemFlag = loadProblemSectionIds(
    `${publicFolder}/${year}/problem_sections.json`,
  );
  const stats = loadSectionStats(publicFolder, year);
  const peerZ = computePeerOutliers(stats);
  const priorStats = prevYear ? loadSectionStats(publicFolder, prevYear) : [];
  const swingZ = computeSwing(stats, priorStats);

  // Universe of sections: anything with stats (registered + actual voters).
  // Per-municipality percentile is computed after the score pass.
  const rows: RiskScoreRow[] = [];
  for (const s of stats) {
    const components: RiskComponent[] = [];
    let weightedSum = 0;
    let weightTotal = 0;

    // Track the party most affected by the firing signals — but only when
    // the signal itself is party-specific (recount / suemg). For
    // section-level signals (invalid ballots, additional voters, peer
    // outlier, concentrated) there is no single "affected party" — the
    // anomaly belongs to the section as a whole. Showing the section
    // winner in those cases would falsely imply a connection.
    let affectedParty: { partyNum: number; change: number } | undefined;
    const considerParty = (partyNum?: number, change?: number) => {
      if (partyNum === undefined || change === undefined) return;
      if (!affectedParty || Math.abs(change) > Math.abs(affectedParty.change)) {
        affectedParty = { partyNum, change };
      }
    };

    const addSignal = (
      id: RiskComponent["id"],
      raw: number | undefined,
      normalized: number | undefined,
    ) => {
      if (normalized === undefined || raw === undefined) return;
      const w = WEIGHTS[id];
      const n = clip01(normalized);
      components.push({
        id,
        rawValue: raw,
        normalized: n,
        weight: w,
        contribution: 100 * w * n,
      });
      weightedSum += w * n;
      weightTotal += w;
    };

    // recount: addedVotes + removedVotes, normalized by section's total
    // votes. Captures recount churn magnitude even when the net is 0.
    const rc = recount.get(s.section);
    if (rc) {
      const total = (rc.totalVotes ?? 0) || 1;
      const churn = ((rc.addedVotes ?? 0) + (rc.removedVotes ?? 0)) / total;
      addSignal("recount", churn, churn / CAPS.recountPct);
      considerParty(rc.topPartyChange?.partyNum, rc.topPartyChange?.change);
      considerParty(
        rc.bottomPartyChange?.partyNum,
        rc.bottomPartyChange?.change,
      );
    }

    // SUEMG flash-memory mismatch: absolute pctSuemg / 100, capped.
    const suemg = suemgAdded.get(s.section) ?? suemgRemoved.get(s.section);
    if (suemg) {
      const pct = Math.abs(suemg.pctSuemg ?? 0) / 100;
      addSignal("suemgMismatch", pct, pct / CAPS.suemgPct);
      considerParty(
        suemg.topPartyChange?.partyNum,
        suemg.topPartyChange?.change,
      );
      considerParty(
        suemg.bottomPartyChange?.partyNum,
        suemg.bottomPartyChange?.change,
      );
    }

    const inv = invalid.get(s.section);
    if (inv) {
      addSignal("invalidBallots", inv.value, inv.value / CAPS.invalidPct);
    }

    const add = additional.get(s.section);
    if (add) {
      addSignal("additionalVoters", add.value, add.value / CAPS.additionalPct);
    }

    // Concentrated: only count sections where the top party got ≥80%
    // (matching the existing "concentrated" report threshold). Map 80–100
    // → 0–1 linearly.
    const conc = concentrated.get(s.section);
    if (conc && conc.value >= 80) {
      const norm = (conc.value - 80) / 20;
      addSignal("concentrated", conc.value, norm);
    }

    const z = peerZ.get(s.section);
    if (z !== undefined && z > 0) {
      addSignal("peerOutlier", z, z / CAPS.peerZ);
    }

    // Cross-election swing: z-score of the upward shift vs. the same
    // section last election. Never fires for the earliest election (no
    // prior) or for sections with no matched prior counterpart.
    const sw = swingZ.get(s.section);
    if (sw !== undefined && sw > 0) {
      addSignal("swing", sw, sw / CAPS.swingZ);
    }

    if (components.length === 0) continue;

    const score = weightTotal > 0 ? (100 * weightedSum) / weightTotal : 0;
    rows.push({
      section: s.section,
      ekatte: s.ekatte,
      obshtina: s.obshtina,
      oblast: s.oblast,
      // Section winner — populates the standard ПАРТИЯ + ГЛАСОВЕ + %
      // columns so the overview table doesn't look broken with all
      // those columns empty. NOT the same as the "affected party";
      // see affectedPartyNum below.
      partyNum: s.topPartyNum,
      totalVotes: s.topPartyVotes,
      pctPartyVote:
        s.totalVotes && s.totalVotes > 0
          ? Math.round(((s.topPartyVotes ?? 0) / s.totalVotes) * 10000) / 100
          : undefined,
      // Affected party + signed change, when a party-specific signal
      // (recount or SUEMG) fired. Surfaced separately so the table can
      // distinguish "this section's winner" from "the party whose votes
      // moved during the recount/flash-memory adjustment".
      affectedPartyNum: (affectedParty as typeof affectedParty)?.partyNum,
      affectedPartyChange: (affectedParty as typeof affectedParty)?.change,
      score: Math.round(score * 10) / 10,
      band: bandOf(score),
      signalsAvailable: components.length,
      signalsTotal: Object.keys(WEIGHTS).length,
      components,
      neighborhoodFlag: problemFlag.has(s.section) || undefined,
    });
  }

  // Per-municipality percentile pass.
  const byMuni = new Map<string, RiskScoreRow[]>();
  for (const r of rows) {
    if (!r.obshtina) continue;
    const arr = byMuni.get(r.obshtina) ?? [];
    arr.push(r);
    byMuni.set(r.obshtina, arr);
  }
  for (const [, arr] of byMuni) {
    const sorted = [...arr].sort((a, b) => a.score - b.score);
    sorted.forEach((r, i) => {
      r.percentileInMunicipality = arr.length > 1 ? i / (arr.length - 1) : 1;
    });
  }

  // Sort by score desc — primary use case is "show the highest-risk
  // sections first".
  rows.sort((a, b) => b.score - a.score);

  const generatedAt = new Date().toISOString();
  const out: RiskScoreReport = {
    election: year,
    generatedAt,
    signalsTotal: Object.keys(WEIGHTS).length,
    weights: WEIGHTS,
    caps: CAPS,
    rows,
  };
  const file = `${reportsFolder}/section/risk_score.json`;
  fs.writeFileSync(file, stringify(out), "utf8");
  console.log(
    "Successfully added file ",
    file,
    `(${rows.length} sections scored)`,
  );

  const counts: Record<RiskBand, number> = {
    low: 0,
    elevated: 0,
    high: 0,
    critical: 0,
  };
  const votesByBand: Record<RiskBand, number> = {
    low: 0,
    elevated: 0,
    high: 0,
    critical: 0,
  };
  let totalActualVoters = 0;
  // Index section stats by section id so we can look up the SECTION
  // total votes (sum of all party votes) for vote-weighting. Note that
  // RiskScoreRow.totalVotes is the WINNING party's votes, not the
  // section's total — so we cannot use it here.
  const sectionTotalById = new Map<string, number>();
  for (const s of stats) sectionTotalById.set(s.section, s.totalVotes ?? 0);
  for (const r of rows) {
    counts[r.band]++;
    const sectionTotal = sectionTotalById.get(r.section) ?? 0;
    votesByBand[r.band] += sectionTotal;
    totalActualVoters += sectionTotal;
  }
  const topCritical = rows
    .filter((r) => r.band === "critical")
    .slice(0, TOP_CRITICAL_N);

  // Read suemg_missing_flash.json (already produced by the suemg pipeline
  // in this same folder) and sum the per-section machine-votes-affected
  // value. Used by the composite's vote-weighted "missing flash" component
  // instead of the bare section count from national_summary.
  let missingFlashMachineVotes = 0;
  const missingFlashFile = `${reportsFolder}/section/suemg_missing_flash.json`;
  if (fs.existsSync(missingFlashFile)) {
    try {
      const rows = JSON.parse(
        fs.readFileSync(missingFlashFile, "utf-8"),
      ) as Array<{ value?: number }>;
      for (const r of rows) missingFlashMachineVotes += r.value ?? 0;
    } catch {
      // ignore — keep 0
    }
  }

  const summary: RiskScoreSummary = {
    election: year,
    generatedAt,
    signalsTotal: Object.keys(WEIGHTS).length,
    totalSections: rows.length,
    counts,
    votesByBand,
    totalActualVoters,
    missingFlashMachineVotes,
    topCritical,
  };
  const summaryFile = `${reportsFolder}/section/risk_score_summary.json`;
  fs.writeFileSync(summaryFile, stringify(summary), "utf8");
  console.log(
    "Successfully added file ",
    summaryFile,
    `(counts + top ${topCritical.length} critical, missingFlashVotes=${missingFlashMachineVotes})`,
  );

  // Per-prefix split — section IDs begin with a 2-digit oblast code
  // (e.g. "06" = Vratsa). Splitting the rows into one file per prefix
  // lets the section detail page (`useRiskScoreForSection`) fetch only
  // the ~300–700 KB bucket its section belongs to instead of the full
  // ~12 MB report.
  const byPrefix = new Map<string, RiskScoreRow[]>();
  for (const r of rows) {
    const prefix = r.section?.slice(0, 2);
    if (!prefix) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(r);
  }
  const prefixDir = `${reportsFolder}/section/risk_score`;
  fs.mkdirSync(prefixDir, { recursive: true });
  for (const [prefix, prefixRows] of byPrefix) {
    const file = `${prefixDir}/${prefix}.json`;
    fs.writeFileSync(file, stringify(prefixRows), "utf8");
  }
  console.log(
    "Successfully added per-prefix files in ",
    prefixDir,
    `(${byPrefix.size} buckets, ${rows.length} rows total)`,
  );

  // Cluster detection — a separate view file (not the score table).
  const { clusters, mapSections } = buildRiskClusters(rows, coordsLookup ?? {});
  const clustersReport: RiskClustersReport = {
    election: year,
    generatedAt,
    thresholds: {
      minSections: CLUSTER_MIN_SECTIONS,
      maxDistanceMeters: CLUSTER_MAX_METERS,
      minBand: "elevated",
    },
    clusters,
    mapSections,
  };
  const clustersFile = `${reportsFolder}/section/risk_clusters.json`;
  fs.writeFileSync(clustersFile, stringify(clustersReport), "utf8");
  console.log(
    "Successfully added file ",
    clustersFile,
    `(${clusters.length} clusters, ${mapSections.length} map sections)`,
  );
};
