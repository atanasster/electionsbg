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
  /** Winning party + its raw vote count for this section. Surfaced
   * in the overview table's ПАРТИЯ + ГЛАСОВЕ columns. */
  partyNum?: number;
  totalVotes?: number;
  pctPartyVote?: number;
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

const clip01 = (x: number): number => Math.max(0, Math.min(1, x));

export const generateRiskScoreReport = ({
  publicFolder,
  reportsFolder,
  year,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  year: string;
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
    let affectedParty:
      | { partyNum: number; change: number }
      | undefined;
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

    if (components.length === 0) continue;

    const score = weightTotal > 0 ? (100 * weightedSum) / weightTotal : 0;
    rows.push({
      section: s.section,
      ekatte: s.ekatte,
      obshtina: s.obshtina,
      oblast: s.oblast,
      // Affected party + signed vote change, only when a party-specific
      // signal fired. Undefined for sections where the firing signals are
      // purely section-level (invalid ballots, additional voters, peer
      // outlier, concentrated) — those have no single "affected party".
      partyNum: (affectedParty as typeof affectedParty)?.partyNum,
      totalVotes: (affectedParty as typeof affectedParty)?.change,
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

  const out: RiskScoreReport = {
    election: year,
    generatedAt: new Date().toISOString(),
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
};
