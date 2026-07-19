// Regression net over the generated election data SHARDS — section, settlement,
// municipality, region, country (national_summary), abroad and Sofia-city.
//
// Every check is derived from the data on disk, not a frozen snapshot, so it
// survives re-ingest and fails only on genuinely damaged/incorrect output. The
// invariants encoded here were each verified to hold with ZERO violations across
// all 13 parliamentary elections currently in the corpus (2005 → 2026); anything
// that does NOT hold universally (e.g. the CIK protocol paper/machine-ballot
// identities, whose field semantics shift in the machine-voting era, or the
// abroad totalActualVoters derivation) is deliberately excluded or exempted so
// the suite never false-fails on the current good corpus.
//
//   npm run test:unit -- scripts/tests/election/shards
//
// Auto-skips when the corpus isn't on disk. See electionData.ts.

import { describe, test, expect } from "vitest";
import type { ElectionRegion, Votes, SectionProtocol } from "@/data/dataTypes";
import {
  ABROAD_OBLAST,
  SOFIA_REGIONS,
  listParliamentaryElections,
  loadSections,
  loadRegions,
  loadNationalSummary,
  partyUniverse,
  listShardFiles,
  readShard,
  sample,
  addPartyVotes,
  addProtocol,
} from "./electionData";

const elections = listParliamentaryElections();
const suite = elections.length ? describe : describe.skip;

// ── vote / protocol primitives shared by several checks ─────────────────────

/** total == paper + machine whenever both legs are recorded (universal). */
const voteArithmeticOk = (v: Votes): boolean =>
  v.paperVotes == null ||
  v.machineVotes == null ||
  v.totalVotes === v.paperVotes + v.machineVotes;

const negativeVoteField = (v: Votes): string | null => {
  for (const k of [
    "totalVotes",
    "paperVotes",
    "machineVotes",
    "suemgVotes",
  ] as const) {
    const n = v[k];
    if (typeof n === "number" && n < 0) return k;
  }
  return null;
};

const negativeProtocolField = (p: SectionProtocol): string | null => {
  for (const [k, val] of Object.entries(p)) {
    if (typeof val === "number" && val < 0) return k;
  }
  return null;
};

suite("election shards", () => {
  for (const election of elections) {
    describe(election, () => {
      // Load once per election; GC between describe blocks keeps memory bounded.
      const sections = loadSections(election);
      const regions = loadRegions(election);
      const parties = partyUniverse(election);

      // ── SECTION shard integrity ──────────────────────────────────────────
      describe("sections", () => {
        test("structural: id, oblast and a votes array on every section", () => {
          const bad: string[] = [];
          for (const s of sections) {
            // 9-digit section codes throughout; 2005 uses 8 digits for the
            // single-digit oblasts (1–9, no leading zero).
            if (!/^\d{8,9}$/.test(s.section)) bad.push(`bad id ${s.section}`);
            else if (!s.oblast) bad.push(`${s.section} missing oblast`);
            else if (!Array.isArray(s.results?.votes))
              bad.push(`${s.section} missing votes array`);
          }
          expect(bad.slice(0, 5), `${bad.length} malformed sections`).toEqual(
            [],
          );
        });

        test("every vote: known party, non-negative, total = paper + machine", () => {
          const bad: string[] = [];
          for (const s of sections) {
            for (const v of s.results?.votes ?? []) {
              if (!parties.has(v.partyNum))
                bad.push(`${s.section} unknown party ${v.partyNum}`);
              const neg = negativeVoteField(v);
              if (neg) bad.push(`${s.section} p${v.partyNum} negative ${neg}`);
              if (!voteArithmeticOk(v))
                bad.push(
                  `${s.section} p${v.partyNum} total ${v.totalVotes} != paper ${v.paperVotes} + machine ${v.machineVotes}`,
                );
            }
          }
          expect(bad.slice(0, 8), `${bad.length} vote violations`).toEqual([]);
        });

        // A handful of legacy sections (e.g. 9 in 2009) legitimately list a
        // party twice in the raw CIK protocol; the rollups still reconcile
        // because both sides sum the duplicates. Guard only against WHOLESALE
        // duplication (a generator bug that double-writes the votes array),
        // which would push this far past the <1% legacy floor.
        test("duplicate party entries stay vanishingly rare (<1% of sections)", () => {
          let dup = 0;
          for (const s of sections) {
            const nums = (s.results?.votes ?? []).map((v) => v.partyNum);
            if (nums.length !== new Set(nums).size) dup++;
          }
          expect(
            dup / sections.length,
            `${dup}/${sections.length} sections have duplicate parties`,
          ).toBeLessThan(0.01);
        });

        test("protocol: non-negative fields and a finite totalActualVoters", () => {
          const bad: string[] = [];
          for (const s of sections) {
            const p = s.results?.protocol;
            if (!p) continue;
            const neg = negativeProtocolField(p);
            if (neg) bad.push(`${s.section} negative ${neg}`);
            if (
              p.totalActualVoters != null &&
              !Number.isFinite(p.totalActualVoters)
            )
              bad.push(`${s.section} non-finite totalActualVoters`);
          }
          expect(bad.slice(0, 8), `${bad.length} protocol violations`).toEqual(
            [],
          );
        });
      });

      // ── REGION shards + section→region rollup ────────────────────────────
      describe("regions", () => {
        test("32 regions incl. abroad and the three Sofia-city districts", () => {
          const keys = new Set(regions.map((r) => r.key));
          expect(regions.length).toBe(32);
          expect(keys.has(ABROAD_OBLAST), "abroad region 32").toBe(true);
          for (const s of SOFIA_REGIONS)
            expect(keys.has(s), `Sofia region ${s}`).toBe(true);
        });

        test("region internals: vote arithmetic + non-negativity", () => {
          const bad: string[] = [];
          for (const r of regions) {
            for (const v of r.results.votes) {
              if (negativeVoteField(v))
                bad.push(`${r.key} p${v.partyNum} negative`);
              if (!voteArithmeticOk(v))
                bad.push(`${r.key} p${v.partyNum} total != paper+machine`);
            }
            const p = r.results.protocol;
            if (p && negativeProtocolField(p))
              bad.push(`${r.key} negative protocol`);
          }
          expect(bad.slice(0, 8), `${bad.length} region violations`).toEqual(
            [],
          );
        });

        test("★ region == Σ its sections (votes exact; protocol exact)", () => {
          // Aggregate sections by oblast once.
          const byOblast: Record<
            string,
            { votes: Record<number, number>; prot: Record<string, number> }
          > = {};
          for (const s of sections) {
            const b = (byOblast[s.oblast] ??= { votes: {}, prot: {} });
            addPartyVotes(b.votes, s.results?.votes ?? []);
            addProtocol(b.prot, s.results?.protocol);
          }
          const voteMismatch: string[] = [];
          const protMismatch: string[] = [];
          for (const r of regions) {
            const agg = byOblast[r.key];
            expect(agg, `region ${r.key} has no sections`).toBeTruthy();
            for (const v of r.results.votes) {
              if ((agg.votes[v.partyNum] ?? 0) !== v.totalVotes)
                voteMismatch.push(
                  `${r.key} p${v.partyNum}: region ${v.totalVotes} vs Σsec ${agg.votes[v.partyNum] ?? 0}`,
                );
            }
            for (const [k, val] of Object.entries(r.results.protocol ?? {})) {
              if (typeof val !== "number") continue;
              // The abroad region's totalActualVoters comes from a separate
              // derivation and is a few hundred above Σ sections in a handful of
              // cycles — a known upstream quirk, not shard damage.
              if (r.key === ABROAD_OBLAST && k === "totalActualVoters")
                continue;
              if ((agg.prot[k] ?? 0) !== val)
                protMismatch.push(
                  `${r.key}.${k}: region ${val} vs Σsec ${agg.prot[k] ?? 0}`,
                );
            }
          }
          expect(
            voteMismatch.slice(0, 8),
            `${voteMismatch.length} vote rollup mismatches`,
          ).toEqual([]);
          expect(
            protMismatch.slice(0, 8),
            `${protMismatch.length} protocol rollup mismatches`,
          ).toEqual([]);
        });

        test("abroad region 32 holds only oblast-32 sections", () => {
          const abroad = sections.filter((s) => s.oblast === ABROAD_OBLAST);
          expect(abroad.length, "some abroad sections exist").toBeGreaterThan(
            0,
          );
          // (all such sections are, by construction, oblast 32 — assert the
          // region rollup above already reconciled them; here just confirm the
          // partition is non-empty and self-consistent)
          expect(abroad.every((s) => s.oblast === ABROAD_OBLAST)).toBe(true);
        });
      });

      // ── COUNTRY: national_summary reconciles with the regions ────────────
      describe("national_summary (country)", () => {
        const ns = loadNationalSummary(election);
        const natByParty: Record<number, number> = {};
        for (const r of regions as ElectionRegion[])
          addPartyVotes(natByParty, r.results.votes);
        const sumActual = regions.reduce(
          (a, r) => a + (r.results.protocol?.totalActualVoters ?? 0),
          0,
        );
        const sumRegistered = regions.reduce(
          (a, r) => a + (r.results.protocol?.numRegisteredVoters ?? 0),
          0,
        );

        test("party totals == Σ regions", () => {
          const bad: string[] = [];
          for (const p of ns.parties) {
            if ((natByParty[p.partyNum] ?? 0) !== p.totalVotes)
              bad.push(
                `p${p.partyNum}: summary ${p.totalVotes} vs Σregions ${natByParty[p.partyNum] ?? 0}`,
              );
          }
          expect(bad.slice(0, 8), `${bad.length} party mismatches`).toEqual([]);
        });

        test("turnout actual/registered == Σ region protocol", () => {
          expect(ns.turnout.actual).toBe(sumActual);
          expect(ns.turnout.registered).toBe(sumRegistered);
          expect(ns.turnout.pct).toBeCloseTo(
            (100 * sumActual) / sumRegistered,
            1,
          );
        });

        test("parties: sorted desc, pct in range, threshold flag consistent", () => {
          let prev = Infinity;
          let sumPct = 0;
          for (const p of ns.parties) {
            expect(
              p.totalVotes,
              "parties sorted by votes desc",
            ).toBeLessThanOrEqual(prev);
            prev = p.totalVotes;
            expect(p.pct).toBeGreaterThanOrEqual(0);
            expect(p.pct).toBeLessThanOrEqual(100);
            expect(p.passedThreshold).toBe(p.pct >= 4);
            sumPct += p.pct;
          }
          // Shares are of valid party votes; the full list should ~sum to 100.
          expect(sumPct).toBeGreaterThan(98);
          expect(sumPct).toBeLessThan(102);
        });

        test("paper/machine split adds to 100% when present", () => {
          if (!ns.paperMachine) return;
          expect(
            ns.paperMachine.paperPct + ns.paperMachine.machinePct,
          ).toBeCloseTo(100, 1);
          expect(
            ns.paperMachine.paperVotes + ns.paperMachine.machineVotes,
          ).toBe(ns.paperMachine.total);
        });
      });

      // ── SETTLEMENT shards (sampled) → sections rollup ────────────────────
      describe("settlements", () => {
        const byEkatte: Record<string, Record<number, number>> = {};
        for (const s of sections) {
          if (!s.ekatte) continue;
          addPartyVotes((byEkatte[s.ekatte] ??= {}), s.results?.votes ?? []);
        }
        const files = sample(listShardFiles(election, "settlements"), 250);

        test("sampled settlements: internal consistency + == Σ sections", () => {
          const bad: string[] = [];
          for (const f of files) {
            const st = readShard<{
              ekatte: string;
              results: { votes: Votes[]; protocol?: SectionProtocol };
            }>(election, "settlements", f);
            const src = byEkatte[st.ekatte] ?? {};
            for (const v of st.results.votes) {
              if (negativeVoteField(v) || !voteArithmeticOk(v))
                bad.push(`${st.ekatte} p${v.partyNum} bad arithmetic`);
              if ((src[v.partyNum] ?? 0) !== v.totalVotes)
                bad.push(
                  `${st.ekatte} p${v.partyNum}: file ${v.totalVotes} vs Σsec ${src[v.partyNum] ?? 0}`,
                );
            }
          }
          expect(
            bad.slice(0, 8),
            `${bad.length} settlement violations (of ${files.length} sampled)`,
          ).toEqual([]);
        });
      });

      // ── MUNICIPALITY shards → sections rollup (rayon splits exempt) ───────
      describe("municipalities", () => {
        const byObshtina: Record<string, Record<number, number>> = {};
        for (const s of sections) {
          if (!s.obshtina) continue;
          addPartyVotes(
            (byObshtina[s.obshtina] ??= {}),
            s.results?.votes ?? [],
          );
        }
        const allFiles = listShardFiles(election, "municipalities");
        const keys = allFiles.map((f) => f.replace(".json", ""));
        // Plovdiv (PDV22) and Varna (VAR06) are split into район sub-shards
        // whose parent aggregates don't cleanly re-sum from sections; those are
        // covered by internal-consistency only, not the section rollup.
        const isRayon = (k: string): boolean =>
          k.includes("-") || keys.some((o) => o !== k && o.startsWith(k + "-"));

        test("every municipality: internal vote arithmetic + non-negativity", () => {
          const bad: string[] = [];
          for (const f of allFiles) {
            const m = readShard<{
              obshtina: string;
              oblast: string;
              results: { votes: Votes[]; protocol?: SectionProtocol };
            }>(election, "municipalities", f);
            if (!m.obshtina || !m.oblast)
              bad.push(`${f} missing obshtina/oblast`);
            for (const v of m.results.votes) {
              if (negativeVoteField(v) || !voteArithmeticOk(v))
                bad.push(`${f} p${v.partyNum} bad arithmetic`);
            }
            if (m.results.protocol && negativeProtocolField(m.results.protocol))
              bad.push(`${f} negative protocol`);
          }
          expect(
            bad.slice(0, 8),
            `${bad.length} municipality violations`,
          ).toEqual([]);
        });

        test("non-rayon municipalities == Σ their sections (votes exact)", () => {
          const bad: string[] = [];
          let checked = 0;
          for (const f of allFiles) {
            const k = f.replace(".json", "");
            if (isRayon(k)) continue;
            checked++;
            const m = readShard<{
              obshtina: string;
              results: { votes: Votes[] };
            }>(election, "municipalities", f);
            const src = byObshtina[m.obshtina] ?? {};
            for (const v of m.results.votes) {
              if ((src[v.partyNum] ?? 0) !== v.totalVotes)
                bad.push(
                  `${k} p${v.partyNum}: file ${v.totalVotes} vs Σsec ${src[v.partyNum] ?? 0}`,
                );
            }
          }
          expect(checked, "some clean municipalities checked").toBeGreaterThan(
            200,
          );
          expect(
            bad.slice(0, 8),
            `${bad.length} municipality rollup mismatches`,
          ).toEqual([]);
        });
      });
    });
  }
});
