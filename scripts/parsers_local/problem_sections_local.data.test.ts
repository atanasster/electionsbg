// The local neighbourhood corpus — the artifact whose apparent SHRINK made a plan conclude the
// whole feature was impossible.
//
// ⚠⚠ THE TILE SELF-HIDES ON AN EMPTY RESULT, so a matcher regression and „this município
// genuinely has none" render identically. On 2026-09-07 (`fa5260ca06`) 2019 and 2023 matched
// **2** against 7 in 2011/2015, and the presidential-analysis-sections plan (retired in
// `cf6ec257dd`; correction in `docs/deferred-followups.md`) went on to record that local
// „cannot borrow the neighbourhood catalogue" at all. That „2" was NOT a shrink: no matcher,
// catalogue or backfill code changed between then and the re-measured 8.
// The two rules needing no address are Stolipinovo (prefix) and Filipovci (suffix), so it was
// almost certainly a shard tree with no addresses yet — a re-parse rewrote
// `data/<cycle>/sections/*.json` and `--local-problem-sections` ran before `--local-coords`
// stamped the addresses back on. `docs/plans/local-neighbourhoods-coverage-v1.md` has the
// measurement. The generator now refuses to write below an address-coverage floor, and the
// coverage arm below asserts the same floor on the shard tree directly.
//
// ⚠ THE JOIN IS ЕКАТТЕ + ADDRESS, NOT THE SECTION CODE, and that is the whole design: local
// codes are NSI-oblast-prefixed while parliamentary ones are МИР-prefixed, so a code join is
// what would be impossible. These assertions are therefore about the ADDRESS match holding.
//
// ⚠ IT SKIPS ON A FRESH CLONE. `data/*_mi/problem_sections.json` is produced by
// `npm run data -- --local-problem-sections`; a checkout that has never run it has nothing to
// assert against, which must not read as „the corpus is fine".

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PROBLEM_NEIGHBORHOODS } from "../reports/problem_sections/neighborhoods";
import {
  LOCAL_ADDRESS_COVERAGE_FLOOR,
  measureLocalAddressCoverage,
} from "./problem_sections_local";

type Neighborhood = {
  id: string;
  obshtinaCode: string;
  sectionCount: number;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
};

const DATA_ROOT = path.join(process.cwd(), "data");

const cycles = fs.existsSync(DATA_ROOT)
  ? fs
      .readdirSync(DATA_ROOT)
      .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
      .filter((d) =>
        fs.existsSync(path.join(DATA_ROOT, d, "problem_sections.json")),
      )
      .sort()
  : [];

const built = cycles.map((cycle) => ({
  cycle,
  neighborhoods:
    (
      JSON.parse(
        fs.readFileSync(
          path.join(DATA_ROOT, cycle, "problem_sections.json"),
          "utf8",
        ),
      ) as { neighborhoods?: Neighborhood[] }
    ).neighborhoods ?? [],
}));
const hasCorpus = built.length > 0;

// Catalogue entries a cycle CANNOT match, each with the reason. Anything not listed here must
// match — see the set-equality arm.
const NOT_MATCHABLE: Record<string, { id: string; why: string }[]> = {
  "2011_10_23_mi": [
    {
      id: "dolno_ezerovo",
      why: "Burgas codes 020400309-315 were created ~2016 (291 stations in 2011); the earlier stations are unaddressable — every address we hold is 2022+",
    },
  ],
  "2015_10_25_mi": [
    {
      id: "dolno_ezerovo",
      why: "Burgas codes 020400309-315 were created ~2016 (the 2015 results stop at 020400290). An era-correct list EXISTS — ОИК Бургас Решение № 11 of 2015-09-09 tags 020400252-257 „кв. Д. Езерово“ — but the matcher places by address only and every address we hold is 2022+, so it is not wired in yet (see docs/deferred-followups.md)",
    },
  ],
};

describe.runIf(hasCorpus)("the local neighbourhood corpus", () => {
  it.each(built)(
    "$cycle: matched at least one curated neighbourhood",
    ({ neighborhoods }) => {
      // ⚠ A FLOOR AT ALL IS THE POINT. Zero renders as „no such places" on every município page,
      // which is exactly how a matcher that stopped matching would look.
      expect(neighborhoods.length).toBeGreaterThan(0);
    },
  );

  // Only cycles whose shard tree is on disk — `sections/` is gitignored, so a checkout holding
  // the outputs without the shards has nothing to measure, which must not read as a pass.
  const withShards = built.filter((b) =>
    fs.existsSync(path.join(DATA_ROOT, b.cycle, "sections")),
  );
  it.runIf(withShards.length > 0).each(withShards)(
    "$cycle: every address-matched settlement carries addresses (else run --local-coords)",
    ({ cycle }) => {
      // ⚠ THE CAUSE, ASSERTED WHERE IT LIVES. A stripped shard tree used to surface only as a
      // neighbourhood count three steps downstream; this fails on the tree itself, naming the
      // settlement and its measured coverage.
      const coverage = measureLocalAddressCoverage(
        path.join(DATA_ROOT, cycle, "sections"),
      );
      expect(coverage.length).toBeGreaterThan(0);
      const short = coverage.filter(
        (c) => c.coverage < LOCAL_ADDRESS_COVERAGE_FLOOR,
      );
      expect({ cycle, short }).toEqual({ cycle, short: [] });
    },
  );

  it.runIf(withShards.length > 0).each(withShards)(
    "$cycle: an addressSource stamp always travels with its address",
    ({ cycle }) => {
      // The stamp says which parliamentary election an address came from; one without an
      // address, or one that is not a date, would date a fact the shard does not hold.
      const dir = path.join(DATA_ROOT, cycle, "sections");
      const bad: string[] = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        let shard: { sections?: unknown };
        try {
          shard = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          continue;
        }
        if (!Array.isArray(shard.sections)) continue;
        for (const s of shard.sections as {
          sectionCode: string;
          address?: string;
          addressSource?: string;
        }[])
          if (
            s.addressSource !== undefined &&
            (!s.address || !/^\d{4}_\d{2}_\d{2}$/.test(s.addressSource))
          )
            bad.push(s.sectionCode);
      }
      expect({ cycle, bad }).toEqual({ cycle, bad: [] });
    },
  );

  it.each(built)(
    "$cycle: matches exactly the catalogue minus its named exclusions",
    ({ cycle, neighborhoods }) => {
      // ⚠ EQUALITY, NOT A COUNT. A lost neighbourhood and an unexplained new one both fail, and
      // so does a catalogue addition — every cycle then needs someone to decide, per cycle,
      // whether it matches — and so does a stale exclusion. The count-based test this replaced
      // could not tell 7 → 8 (a real Burgas renumbering) from a matcher change.
      const excluded = new Set((NOT_MATCHABLE[cycle] ?? []).map((e) => e.id));
      const expected = PROBLEM_NEIGHBORHOODS.map((n) => n.id).filter(
        (id) => !excluded.has(id),
      );
      expect({ cycle, ids: neighborhoods.map((n) => n.id).sort() }).toEqual({
        cycle,
        ids: expected.sort(),
      });
    },
  );

  it.each(built)(
    "$cycle: every neighbourhood resolves to a município that cycle actually has",
    ({ cycle, neighborhoods }) => {
      // ⚠ THE JOIN THE PLAN BELIEVED WAS IMPOSSIBLE, asserted. A neighbourhood whose
      // `obshtinaCode` has no shard is a row rendered on a page that does not exist.
      const dir = path.join(DATA_ROOT, cycle, "municipalities");
      if (!fs.existsSync(dir)) return;
      const shards = new Set(
        fs.readdirSync(dir).map((f) => f.replace(/\.json$/, "")),
      );
      for (const n of neighborhoods)
        expect({ id: n.id, present: shards.has(n.obshtinaCode) }).toEqual({
          id: n.id,
          present: true,
        });
    },
  );

  it.each(built)(
    "$cycle: every neighbourhood carries sections and a countable vote",
    ({ neighborhoods }) => {
      // A matched neighbourhood with no sections is a name on a page and nothing behind it.
      for (const n of neighborhoods) {
        expect(n.sectionCount).toBeGreaterThan(0);
        expect(n.numRegisteredVoters).toBeGreaterThan(0);
        // ⚠ VALID ≤ TURNED OUT ≤ REGISTERED. The whole point of this corpus is a turnout and
        // invalid-ballot comparison, so an ordering that cannot hold makes every figure on the
        // tile unreadable rather than merely wrong.
        expect(n.numValidVotes).toBeLessThanOrEqual(n.totalActualVoters);
        expect(n.totalActualVoters).toBeLessThanOrEqual(n.numRegisteredVoters);
      }
    },
  );
});
