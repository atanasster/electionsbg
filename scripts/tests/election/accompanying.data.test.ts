// Regression net over the ACCOMPANYING cross-election shards that the reports /
// stats pipeline writes OUTSIDE the dated election folders:
//
//   data/regions/<code>_stats.json          per-region result time-series
//   data/regions/<code>_history.json         per-region turnout+winner history
//   data/sofia_stats.json                     Sofia-city (S23+S24+S25) time-series
//   data/sections/<id>_stats.json             per-section result time-series
//   data/sections/risk_history/<id>.json      per-section risk-band history
//   data/municipalities/<code>_stats.json     per-municipality result time-series
//   data/settlements/<ekatte>_stats.json      per-settlement result time-series
//   data/cluster_persistence.json + _membership.json   persistent risk loci
//   data/problem_sections_stats.json          problem-neighbourhood aggregate
//
// Every check is derived from the data on disk and reconciles these derived
// shards back against the authoritative per-election shards (region_votes,
// by-oblast sections, risk_score) — each verified to hold with ZERO violations
// across the current corpus. Auto-skips when the data tree isn't restored.
//
//   npm run test:unit -- scripts/tests/election/accompanying

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import {
  listParliamentaryElections,
  loadRegions,
  loadSections,
  readJson,
  readReport,
  reportExists,
  dataPath,
  listDataFiles,
  sample,
  addPartyVotes,
  regionVotesMap,
  SOFIA_REGIONS,
  type StatsEntry,
} from "./electionData";

const elections = new Set(listParliamentaryElections());
const haveData = elections.size > 0;
const suite = haveData ? describe : describe.skip;

const PARLIAMENTARY_RE = /^\d{4}_\d{2}_\d{2}$/;

const bandOf = (score: number): string =>
  score < 30
    ? "low"
    : score < 60
      ? "elevated"
      : score < 80
        ? "high"
        : "critical";

/** Assert every party vote in a stats entry reconciles with a source map. */
const reconcileVotes = (
  entry: StatsEntry,
  src: Record<number, number>,
  label: string,
  bad: string[],
): void => {
  for (const v of entry.results.votes) {
    if ((src[v.partyNum] ?? 0) !== v.totalVotes)
      bad.push(
        `${label} p${v.partyNum}: stats ${v.totalVotes} vs source ${src[v.partyNum] ?? 0}`,
      );
  }
};

/** Each stats entry's votes obey total = paper + machine and non-negativity. */
const votesArithmeticOk = (entry: StatsEntry): string | null => {
  for (const v of entry.results.votes as {
    partyNum: number;
    totalVotes: number;
    paperVotes?: number;
    machineVotes?: number;
  }[]) {
    if (v.totalVotes < 0) return `p${v.partyNum} negative`;
    if (
      v.paperVotes != null &&
      v.machineVotes != null &&
      v.totalVotes !== v.paperVotes + v.machineVotes
    )
      return `p${v.partyNum} total != paper+machine`;
  }
  return null;
};

suite("accompanying election shards", () => {
  // ── data/regions/<code>_stats.json ────────────────────────────────────────
  describe("region stats time-series", () => {
    const files = listDataFiles("regions", "_stats.json");
    test("each entry reconciles with that election's region_votes", () => {
      const bad: string[] = [];
      for (const f of files) {
        const key = f.replace("_stats.json", "");
        const stats = readJson<StatsEntry[]>(dataPath("regions", f));
        for (const e of stats) {
          if (!elections.has(e.name)) continue; // only parliamentary on disk
          const arith = votesArithmeticOk(e);
          if (arith) bad.push(`${key}@${e.name} ${arith}`);
          const src = regionVotesMap(e.name, key);
          if (src) reconcileVotes(e, src, `${key}@${e.name}`, bad);
        }
      }
      expect(bad.slice(0, 8), `${bad.length} region-stats violations`).toEqual(
        [],
      );
    });
  });

  // ── data/regions/<code>_history.json ──────────────────────────────────────
  describe("region history", () => {
    const files = listDataFiles("regions", "_history.json");
    test("sorted asc, votes desc, pct/turnout in range", () => {
      const bad: string[] = [];
      for (const f of files) {
        const key = f.replace("_history.json", "");
        const { history } = readJson<{
          history: {
            election: string;
            registeredVoters?: number;
            actualVoters?: number;
            turnoutPct?: number;
            votes: { totalVotes: number; pct: number }[];
          }[];
        }>(dataPath("regions", f));
        let prevEl = "";
        for (const e of history) {
          if (e.election < prevEl) bad.push(`${key} history not asc`);
          prevEl = e.election;
          let prevVotes = Infinity;
          for (const v of e.votes) {
            if (v.totalVotes > prevVotes)
              bad.push(`${key}@${e.election} votes not desc`);
            prevVotes = v.totalVotes;
            if (v.pct < 0 || v.pct > 100)
              bad.push(`${key}@${e.election} pct ${v.pct} out of [0,100]`);
          }
          if (e.registeredVoters && e.actualVoters && e.turnoutPct != null) {
            const t = (100 * e.actualVoters) / e.registeredVoters;
            if (Math.abs(t - e.turnoutPct) > 0.1)
              bad.push(`${key}@${e.election} turnoutPct off`);
          }
        }
      }
      expect(
        bad.slice(0, 8),
        `${bad.length} region-history violations`,
      ).toEqual([]);
    });
  });

  // ── data/sofia_stats.json ─────────────────────────────────────────────────
  describe("Sofia-city stats", () => {
    test("each entry == Σ regions S23/S24/S25 for that election", () => {
      if (!fs.existsSync(dataPath("sofia_stats.json"))) return;
      const stats = readJson<StatsEntry[]>(dataPath("sofia_stats.json"));
      const bad: string[] = [];
      for (const e of stats) {
        if (!elections.has(e.name)) continue;
        const src: Record<number, number> = {};
        for (const r of loadRegions(e.name).filter((r) =>
          SOFIA_REGIONS.includes(r.key),
        ))
          addPartyVotes(src, r.results.votes);
        reconcileVotes(e, src, `sofia@${e.name}`, bad);
      }
      expect(bad.slice(0, 8), `${bad.length} sofia-stats violations`).toEqual(
        [],
      );
    });
  });

  // ── data/sections/<id>_stats.json (sampled) ───────────────────────────────
  describe("section stats time-series (sampled)", () => {
    test("sampled section stats reconcile with the latest by-oblast shard", () => {
      const latest = [...elections].sort().pop()!;
      const sections = loadSections(latest);
      const bySection = new Map(sections.map((s) => [s.section, s]));
      const bad: string[] = [];
      let checked = 0;
      for (const s of sample(sections, 300)) {
        const f = dataPath("sections", `${s.section}_stats.json`);
        if (!fs.existsSync(f)) continue;
        const stats = readJson<StatsEntry[]>(f);
        const e = stats.find((x) => x.name === latest);
        if (!e) continue;
        checked++;
        const src: Record<number, number> = {};
        addPartyVotes(src, bySection.get(s.section)!.results?.votes ?? []);
        reconcileVotes(e, src, s.section, bad);
      }
      expect(checked, "some section stats sampled").toBeGreaterThan(50);
      expect(bad.slice(0, 8), `${bad.length} section-stats violations`).toEqual(
        [],
      );
    });
  });

  // ── data/sections/risk_history/<id>.json (sampled) ────────────────────────
  describe("section risk history (sampled)", () => {
    const dir = "sections/risk_history";
    test("≥2 entries, sorted asc, ranges, and band/score reconcile with risk_score", () => {
      const files = listDataFiles(dir);
      if (files.length === 0) return;
      // Cache each election's section→{score,band} once, lazily.
      const riskCache = new Map<
        string,
        Map<string, { score: number; band: string }>
      >();
      const riskFor = (election: string) => {
        if (riskCache.has(election)) return riskCache.get(election)!;
        const m = new Map<string, { score: number; band: string }>();
        if (reportExists(election, "section", "risk_score.json")) {
          const r = readReport<{
            rows: { section: string; score: number; band: string }[];
          }>(election, "section", "risk_score.json");
          for (const row of r.rows)
            m.set(row.section, { score: row.score, band: row.band });
        }
        riskCache.set(election, m);
        return m;
      };

      const bad: string[] = [];
      for (const f of sample(files, 300)) {
        const id = f.replace(".json", "");
        const hist = readJson<
          {
            election: string;
            turnoutPct: number;
            winnerSharePct?: number;
            score?: number;
            band?: string;
            signalsAvailable?: number;
            signalsTotal?: number;
          }[]
        >(dataPath(dir, f));
        if (hist.length < 2) bad.push(`${id} has <2 entries`);
        let prevEl = "";
        for (const e of hist) {
          if (e.election < prevEl) bad.push(`${id} not asc`);
          prevEl = e.election;
          if (
            e.winnerSharePct != null &&
            (e.winnerSharePct < 0 || e.winnerSharePct > 100)
          )
            bad.push(`${id}@${e.election} winnerSharePct out of range`);
          if (e.score != null) {
            if (e.score < 0 || e.score > 100)
              bad.push(`${id}@${e.election} score out of range`);
            if (e.band && e.band !== bandOf(e.score))
              bad.push(
                `${id}@${e.election} band ${e.band} != ${bandOf(e.score)}`,
              );
            if (e.signalsTotal != null && e.signalsTotal !== 7)
              bad.push(`${id}@${e.election} signalsTotal != 7`);
            // reconcile against the authoritative per-election risk_score
            const rs = riskFor(e.election).get(id);
            if (
              rs &&
              (Math.abs(rs.score - e.score) > 0.001 || rs.band !== e.band)
            )
              bad.push(`${id}@${e.election} score/band != risk_score.json`);
          }
        }
      }
      expect(bad.slice(0, 8), `${bad.length} risk-history violations`).toEqual(
        [],
      );
    });
  });

  // ── data/municipalities & settlements _stats (sampled) ────────────────────
  for (const [label, sub] of [
    ["municipality", "municipalities"],
    ["settlement", "settlements"],
  ] as const) {
    describe(`${label} stats time-series (sampled)`, () => {
      test("sampled entries reconcile with the dated shard of the same key", () => {
        const latest = [...elections].sort().pop()!;
        const files = sample(listDataFiles(sub, "_stats.json"), 200);
        const bad: string[] = [];
        let checked = 0;
        for (const f of files) {
          const key = f.replace("_stats.json", "");
          const dated = dataPath(latest, sub, `${key}.json`);
          if (!fs.existsSync(dated)) continue;
          const stats = readJson<StatsEntry[]>(dataPath(sub, f));
          const e = stats.find((x) => x.name === latest);
          if (!e) continue;
          const arith = votesArithmeticOk(e);
          if (arith) bad.push(`${key} ${arith}`);
          checked++;
          const src: Record<number, number> = {};
          addPartyVotes(
            src,
            readJson<{
              results: { votes: { partyNum: number; totalVotes: number }[] };
            }>(dated).results.votes,
          );
          reconcileVotes(e, src, key, bad);
        }
        expect(checked, `some ${label} stats sampled`).toBeGreaterThan(20);
        expect(
          bad.slice(0, 8),
          `${bad.length} ${label}-stats violations`,
        ).toEqual([]);
      });
    });
  }

  // ── data/cluster_persistence.json + membership ────────────────────────────
  describe("cluster persistence", () => {
    test("loci: electionCount == appearances == ≥2, sectionCount == sections.length, sorted", () => {
      if (!fs.existsSync(dataPath("cluster_persistence.json"))) return;
      const cp = readJson<{
        loci: {
          id: string;
          electionCount: number;
          sectionCount: number;
          sections: string[];
          maxScore?: number;
          appearances?: unknown[];
        }[];
      }>(dataPath("cluster_persistence.json"));
      const bad: string[] = [];
      let prevCount = Infinity;
      for (const l of cp.loci) {
        if (l.electionCount < 2) bad.push(`${l.id} electionCount<2`);
        if (l.appearances && l.appearances.length !== l.electionCount)
          bad.push(`${l.id} appearances != electionCount`);
        if (l.sectionCount !== l.sections.length)
          bad.push(`${l.id} sectionCount != sections.length`);
        if (l.electionCount > prevCount)
          bad.push(`${l.id} loci not sorted by electionCount desc`);
        prevCount = l.electionCount;
      }
      // A section should belong to essentially one persistent locus.
      const seen = new Map<string, number>();
      for (const l of cp.loci)
        for (const s of l.sections) seen.set(s, (seen.get(s) ?? 0) + 1);
      const multi = [...seen.values()].filter((n) => n > 1).length;
      const totalMemberships = [...seen.values()].reduce((a, b) => a + b, 0);
      expect(
        multi / Math.max(1, totalMemberships),
        "sections in multiple loci",
      ).toBeLessThan(0.01);
      expect(bad.slice(0, 8), `${bad.length} locus violations`).toEqual([]);
    });

    test("membership sidecar points at real loci", () => {
      const memFile = dataPath("cluster_persistence_membership.json");
      const cpFile = dataPath("cluster_persistence.json");
      if (!fs.existsSync(memFile) || !fs.existsSync(cpFile)) return;
      const lociIds = new Set(
        readJson<{ loci: { id: string }[] }>(cpFile).loci.map((l) => l.id),
      );
      const mem =
        readJson<Record<string, { id: string; electionCount: number }>>(
          memFile,
        );
      const bad = Object.entries(mem)
        .filter(([, v]) => !lociIds.has(v.id))
        .map(([s]) => s);
      expect(
        bad.slice(0, 8),
        `${bad.length} membership rows point at a missing locus`,
      ).toEqual([]);
    });
  });

  // ── data/problem_sections_stats.json ──────────────────────────────────────
  describe("problem-sections aggregate stats", () => {
    test("each entry: valid election name + vote arithmetic", () => {
      if (!fs.existsSync(dataPath("problem_sections_stats.json"))) return;
      const stats = readJson<StatsEntry[]>(
        dataPath("problem_sections_stats.json"),
      );
      const bad: string[] = [];
      for (const e of stats) {
        if (!PARLIAMENTARY_RE.test(e.name))
          bad.push(`bad election name ${e.name}`);
        const arith = votesArithmeticOk(e);
        if (arith) bad.push(`${e.name} ${arith}`);
      }
      expect(bad.slice(0, 8), `${bad.length} problem-stats violations`).toEqual(
        [],
      );
    });
  });
});
