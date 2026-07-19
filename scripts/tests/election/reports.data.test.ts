// Regression net over the GENERATED analytical reports under
// data/YYYY_MM_DD/reports/** and data/YYYY_MM_DD/dashboard/**.
//
// Like shards.data.test.ts every expectation is derived from the data on disk
// (sort order, value ranges, cross-references back into the section/settlement
// corpus, the documented arithmetic of each metric) so it survives re-ingest and
// fails only on a genuinely broken report generator. Auto-skips when the corpus
// isn't present.
//
//   npm run test:unit -- scripts/tests/election/reports

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import {
  listParliamentaryElections,
  loadSections,
  listShardFiles,
  reportExists,
  readReport,
  dashboardPath,
  readJson,
} from "./electionData";

const elections = listParliamentaryElections();
const suite = elections.length ? describe : describe.skip;

// The flat, per-level reports that are emitted as a sorted array of rows.
const FLAT_REPORTS = [
  "turnout",
  "concentrated",
  "additional_voters",
  "invalid_ballots",
  "supports_noone",
  "top_gainers",
  "top_losers",
  "suemg",
  "suemg_added",
  "suemg_removed",
  "suemg_missing_flash",
  "recount",
  "recount_zero_votes",
  "wasted_votes",
];

/** A numeric array is monotonic (non-increasing OR non-decreasing). Covers the
 *  desc reports, the asc top_losers, and the const value=0 recount reports. */
const isMonotonic = (nums: number[]): boolean => {
  let inc = true;
  let dec = true;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] > nums[i - 1]) dec = false;
    if (nums[i] < nums[i - 1]) inc = false;
  }
  return inc || dec;
};

const bandOf = (score: number): string =>
  score < 30
    ? "low"
    : score < 60
      ? "elevated"
      : score < 80
        ? "high"
        : "critical";

interface FlatRow {
  value: number;
  section?: string;
  ekatte?: string;
  obshtina?: string;
  partyNum?: number;
  pctPartyVote?: number;
  pctSuemg?: number;
  machineVotes?: number;
  suemgVotes?: number;
  machineVotesChange?: number;
}

suite("election reports", () => {
  for (const election of elections) {
    describe(election, () => {
      const sectionIds = new Set(loadSections(election).map((s) => s.section));
      const ekatteIds = new Set(
        listShardFiles(election, "settlements").map((f) =>
          f.replace(".json", ""),
        ),
      );
      const obshtinaIds = new Set(
        listShardFiles(election, "municipalities").map((f) =>
          f.replace(".json", ""),
        ),
      );

      // ── generic validation of every flat per-level report ────────────────
      for (const level of ["section", "settlement", "municipality"] as const) {
        const refKey =
          level === "section"
            ? "section"
            : level === "settlement"
              ? "ekatte"
              : "obshtina";
        const refSet =
          level === "section"
            ? sectionIds
            : level === "settlement"
              ? ekatteIds
              : obshtinaIds;

        describe(`${level} flat reports`, () => {
          for (const name of FLAT_REPORTS) {
            test(name, () => {
              if (!reportExists(election, level, `${name}.json`)) return;
              const rows = readReport<FlatRow[]>(
                election,
                level,
                `${name}.json`,
              );
              expect(Array.isArray(rows)).toBe(true);
              if (rows.length === 0) return;

              // 1) values are finite numbers (or null for a handful of
              //    zero-vote rows), and the finite ones are sorted. A NaN or
              //    Infinity would signal a div-by-zero in the generator and is
              //    rejected; null (empty section) is tolerated.
              const values = rows.map((r) => r.value);
              const bogus = values.filter(
                (v) => v != null && !Number.isFinite(v),
              );
              expect(bogus, `${name}: NaN/Infinity value`).toEqual([]);
              expect(
                isMonotonic(
                  values.filter((v): v is number => Number.isFinite(v)),
                ),
                `${name}: not sorted by value`,
              ).toBe(true);

              // 2) party-vote share stays in [0,100] where present
              const badPct = rows.find(
                (r) =>
                  r.pctPartyVote != null &&
                  (r.pctPartyVote < 0 || r.pctPartyVote > 100),
              );
              expect(
                badPct,
                `${name}: pctPartyVote out of [0,100]`,
              ).toBeUndefined();

              // 3) every row references a real entity of this level
              const dangling = rows
                .map((r) => r[refKey])
                .filter((id): id is string => !!id && !refSet.has(id));
              expect(
                dangling.slice(0, 5),
                `${name}: ${dangling.length} rows reference a missing ${refKey}`,
              ).toEqual([]);
            });
          }

          // suemg reports carry their own sign/arithmetic contract
          test("suemg family: routing sign + machineVotesChange arithmetic", () => {
            const check = (
              file: string,
              ok: (r: FlatRow) => boolean,
              label: string,
            ) => {
              if (!reportExists(election, level, file)) return;
              const rows = readReport<FlatRow[]>(election, level, file);
              const bad = rows.filter((r) => {
                if (
                  r.machineVotes != null &&
                  r.suemgVotes != null &&
                  r.machineVotesChange != null &&
                  r.machineVotesChange !== r.machineVotes - r.suemgVotes
                )
                  return true;
                return !ok(r);
              });
              expect(
                bad.length,
                `${file}: ${bad.length} rows violate ${label}`,
              ).toBe(0);
            };
            check("suemg.json", (r) => r.pctSuemg === 0, "pctSuemg == 0");
            check(
              "suemg_added.json",
              (r) => (r.pctSuemg ?? 0) > 0,
              "pctSuemg > 0",
            );
            check(
              "suemg_removed.json",
              (r) => (r.pctSuemg ?? 0) < 0,
              "pctSuemg < 0",
            );
            check(
              "suemg_missing_flash.json",
              (r) => !r.suemgVotes,
              "suemgVotes falsy",
            );
          });
        });
      }

      // ── benford.json ─────────────────────────────────────────────────────
      test("benford.json", () => {
        if (!reportExists(election, "benford.json")) return;
        const b = readReport<{
          election: string;
          parties: {
            partyNum: number;
            totalSections: number;
            firstDigit?: {
              observed: number[];
              expected: number[];
              n: number;
              chi2: number;
              pValue: number;
              mad: number;
            };
            secondDigit?: { observed: number[]; expected: number[] };
          }[];
        }>(election, "benford.json");
        expect(b.election).toBe(election);
        let prevParty = -Infinity;
        for (const p of b.parties) {
          expect(p.partyNum, "parties sorted by partyNum asc").toBeGreaterThan(
            prevParty,
          );
          prevParty = p.partyNum;
          if (p.firstDigit) {
            const t = p.firstDigit;
            expect(t.observed.length).toBe(9);
            expect(t.expected.length).toBe(9);
            expect(t.expected.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 3);
            expect(t.observed.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 3);
            expect(t.chi2).toBeGreaterThanOrEqual(0);
            expect(t.pValue).toBeGreaterThanOrEqual(0);
            expect(t.pValue).toBeLessThanOrEqual(1);
            expect(t.mad).toBeGreaterThanOrEqual(0);
            expect(t.n).toBeLessThanOrEqual(p.totalSections);
          }
          if (p.secondDigit) {
            expect(p.secondDigit.observed.length).toBe(10);
            expect(p.secondDigit.expected.length).toBe(10);
          }
        }
      });

      // ── risk_score.json + summary ────────────────────────────────────────
      test("risk_score.json rows: score/band/components well-formed", () => {
        if (!reportExists(election, "section", "risk_score.json")) return;
        const r = readReport<{
          signalsTotal: number;
          rows: {
            section: string;
            score: number;
            band: string;
            signalsAvailable: number;
            signalsTotal: number;
            percentileInMunicipality?: number;
            components: {
              normalized: number;
              weight: number;
              contribution: number;
            }[];
          }[];
        }>(election, "section", "risk_score.json");
        expect(r.signalsTotal).toBe(7);
        let prevScore = Infinity;
        const bad: string[] = [];
        for (const row of r.rows) {
          if (row.score > prevScore + 1e-9) bad.push(`${row.section} not desc`);
          prevScore = row.score;
          if (row.score < 0 || row.score > 100)
            bad.push(`${row.section} score ${row.score} out of range`);
          // The stored band is computed from the full-precision score while
          // `score` is rounded for display, so a value that rounds onto a band
          // boundary (30/60/80) can legitimately carry the neighbouring band.
          // Accept any band within a ±0.5 window of the rounded score.
          const okBands = new Set([
            bandOf(row.score - 0.5),
            bandOf(row.score),
            bandOf(row.score + 0.5),
          ]);
          if (!okBands.has(row.band))
            bad.push(`${row.section} band ${row.band} != ${bandOf(row.score)}`);
          if (row.signalsTotal !== 7) bad.push(`${row.section} signalsTotal`);
          if (
            row.signalsAvailable !== row.components.length ||
            row.signalsAvailable < 1 ||
            row.signalsAvailable > 7
          )
            bad.push(`${row.section} signalsAvailable`);
          if (!sectionIds.has(row.section))
            bad.push(`${row.section} missing section`);
          if (
            row.percentileInMunicipality != null &&
            (row.percentileInMunicipality < 0 ||
              row.percentileInMunicipality > 1)
          )
            bad.push(`${row.section} percentile out of [0,1]`);
          for (const c of row.components) {
            if (c.normalized < 0 || c.normalized > 1)
              bad.push(`${row.section} normalized out of [0,1]`);
            if (Math.abs(c.contribution - 100 * c.weight * c.normalized) > 0.01)
              bad.push(`${row.section} contribution mismatch`);
          }
        }
        expect(bad.slice(0, 8), `${bad.length} risk_score violations`).toEqual(
          [],
        );
      });

      test("risk_score_summary.json: band counts sum to totalSections", () => {
        if (!reportExists(election, "section", "risk_score_summary.json"))
          return;
        const s = readReport<{
          totalSections: number;
          counts: Record<string, number>;
          topCritical: { band: string }[];
        }>(election, "section", "risk_score_summary.json");
        const sum = ["low", "elevated", "high", "critical"].reduce(
          (a, b) => a + (s.counts[b] ?? 0),
          0,
        );
        expect(sum).toBe(s.totalSections);
        expect(s.topCritical.length).toBeLessThanOrEqual(10);
        expect(s.topCritical.every((t) => t.band === "critical")).toBe(true);
      });

      // ── risk_clusters.json ───────────────────────────────────────────────
      test("risk_clusters.json: sectionCount == sections.length, >= 3, no abroad", () => {
        if (!reportExists(election, "section", "risk_clusters.json")) return;
        const c = readReport<{
          clusters: {
            oblast?: string;
            sectionCount: number;
            sections: string[];
            meanScore?: number;
            maxScore?: number;
          }[];
        }>(election, "section", "risk_clusters.json");
        const bad: string[] = [];
        for (const cl of c.clusters) {
          if (cl.sectionCount !== cl.sections.length) bad.push("count!=len");
          if (cl.sectionCount < 3) bad.push("count<3");
          if (cl.oblast === "32") bad.push("abroad cluster");
          if (
            cl.meanScore != null &&
            cl.maxScore != null &&
            cl.meanScore > cl.maxScore + 1e-9
          )
            bad.push("mean>max");
        }
        expect(bad.slice(0, 5), `${bad.length} cluster violations`).toEqual([]);
      });

      // ── region/wasted_votes.json ─────────────────────────────────────────
      test("region/wasted_votes.json: share ∈ [0,100], wasted ≤ valid, sorted", () => {
        if (!reportExists(election, "region", "wasted_votes.json")) return;
        const rows = readReport<
          {
            share: number;
            wastedVotes: number;
            validVotes: number;
            topParties: { totalVotes: number }[];
          }[]
        >(election, "region", "wasted_votes.json");
        let prev = Infinity;
        const bad: string[] = [];
        for (const r of rows) {
          if (r.share < 0 || r.share > 100) bad.push(`share ${r.share}`);
          if (r.wastedVotes > r.validVotes) bad.push("wasted>valid");
          if (r.share > prev + 1e-9) bad.push("not desc");
          prev = r.share;
          if (r.topParties.length > 5) bad.push("topParties>5");
          let pv = Infinity;
          for (const tp of r.topParties) {
            if (tp.totalVotes > pv + 1e-9) bad.push("topParties not desc");
            pv = tp.totalVotes;
          }
        }
        expect(bad.slice(0, 5), `${bad.length} wasted-vote violations`).toEqual(
          [],
        );
      });

      // ── dashboard reports ────────────────────────────────────────────────
      test("dashboard/wasted_votes.json: each top list ≤ 5", () => {
        const p = dashboardPath(election, "wasted_votes.json");
        if (!fs.existsSync(p)) return;
        const d = readJson<Record<string, unknown[]>>(p);
        for (const key of [
          "topRegions",
          "topMunicipalities",
          "topSettlements",
          "topSections",
        ]) {
          if (Array.isArray(d[key]))
            expect(d[key].length, `${key} ≤ 5`).toBeLessThanOrEqual(5);
        }
      });

      test("dashboard/suspicious_settlements.json: top ≤ 3, sorted, ≥ threshold", () => {
        const p = dashboardPath(election, "suspicious_settlements.json");
        if (!fs.existsSync(p)) return;
        const d = readJson<{
          thresholds: Record<string, number>;
          concentrated: SuspiciousCat;
          invalidBallots: SuspiciousCat;
          additionalVoters: SuspiciousCat;
        }>(p);
        interface SuspiciousCat {
          count: number;
          threshold: number;
          top: { value: number; oblast?: string }[];
        }
        const bad: string[] = [];
        for (const key of [
          "concentrated",
          "invalidBallots",
          "additionalVoters",
        ] as const) {
          const cat = d[key];
          if (!cat) continue;
          if (cat.top.length > 3) bad.push(`${key} top>3`);
          if (cat.count < cat.top.length) bad.push(`${key} count<top`);
          let prev = Infinity;
          for (const t of cat.top) {
            if (t.value > prev + 1e-9) bad.push(`${key} not desc`);
            prev = t.value;
            if (t.value < cat.threshold) bad.push(`${key} value<threshold`);
            if (t.oblast === "32") bad.push(`${key} abroad`);
          }
        }
        expect(bad.slice(0, 5), `${bad.length} suspicious violations`).toEqual(
          [],
        );
      });

      test("dashboard/demographic_cleavages.json: Pearson r ∈ [-1,1], spread ≥ 0", () => {
        const p = dashboardPath(election, "demographic_cleavages.json");
        if (!fs.existsSync(p)) return;
        const d = readJson<{
          rows: { spread: number; rs: (number | null)[] }[];
        }>(p);
        const bad: string[] = [];
        for (const row of d.rows) {
          if (row.spread < -1e-9) bad.push("negative spread");
          for (const r of row.rs) {
            if (r != null && (r < -1.0001 || r > 1.0001))
              bad.push(`r ${r} out of [-1,1]`);
          }
        }
        expect(bad.slice(0, 5), `${bad.length} cleavage violations`).toEqual(
          [],
        );
      });
    });
  }
});
