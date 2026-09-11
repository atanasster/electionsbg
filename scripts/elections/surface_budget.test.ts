// §5.0's emit column, checked against the corpus rather than against itself.
//
// The plan makes this Phase 1's exit criterion: "every `no` row is confirmed still inside its
// budget, and every `yes` row shows the reduction that justified it." So this gate is not a
// unit test of a lookup table — it re-measures the files on disk and fails when a decision in
// `SURFACE_POLICY` has stopped matching them.
//
// ⚠ IT GATES THE MAX, NEVER THE MEAN, and that is the whole point. The plan's own table was
// measured on means and got parliamentary/settlement wrong: 7.5 KB mean reads as comfortably
// inside a 16 KiB budget, while p99 is 101.6 KB and Пловдив is 1,235 KB. A budget that only
// the average place has to meet is not a budget — the reader of the largest page is a real
// reader, and in this corpus the largest place is usually the most-read one.
//
// ⚠ AND IT GATES A DIFFERENT QUANTITY PER POLICY — but NOT the split this comment used to
// claim. It said `embedded` was judged on the surface KEY rather than on the host file, which
// is precisely the escape hatch `SURFACE_BUDGET_BYTES`' own header refuses by name: "there is
// no 'the budget applies to the key, not the host' escape … it is unfalsifiable — nothing
// measures a key that has not been generated yet — and it made `local/section` look compliant
// when it is 1.26x over." The code never implemented it either; `canonicalSizes` returns the
// same file sizes for both policies. So two of the three descriptions of one rule agreed and
// this one did not, and the one that did not sat in the header a reader consults FIRST when a
// budget test goes red — where it would have explained away the 2026-09-03 local/section
// breach as "that is the host file, the gate means the key". The real split is:
//
//   artifact   the generated file — a projection, so the budget is a real ceiling on it
//   canonical  the existing shard, because that IS what the reader downloads
//   embedded   the shard too, for the same reason — the reader downloads the same bytes
//              either way, and an over-budget `embedded` level is over budget until a
//              `budgetWaiver` says why the overage is the better trade
//
// Skips (never silently passes) when the corpus is absent: a fresh clone has no `data/<cycle>`
// tree, and "there were no files to measure" must not read as "every level is inside budget".

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SURFACE_BUDGET_BYTES,
  SURFACE_POLICY,
  artifactPath,
  emittedLevels,
  locateSurface,
} from "../../src/data/elections/surfacePath";
import type {
  ElectionKind,
  ElectionPlaceLevel,
} from "../../src/data/elections/surfaceTypes";
import { DATA_ROOT, measureCycle } from "./surface_budget";

const cycles = (): { kind: ElectionKind; cycle: string }[] => {
  if (!fs.existsSync(DATA_ROOT)) return [];
  const dirs = fs.readdirSync(DATA_ROOT);
  const parl = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .filter((d) =>
      fs.existsSync(path.join(DATA_ROOT, d, "national_summary.json")),
    )
    .sort()
    .at(-1);
  const locals = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
    .filter((d) => fs.existsSync(path.join(DATA_ROOT, d, "index.json")))
    .sort()
    .slice(-2);
  // ⚠ EVERY presidential cycle, matching `surface_budget.ts`'s own arm. The two halves of
  // one instrument had diverged: the operator-facing tool measured presidential rows while
  // this gate's hand-written list did not, so a wrong `measuredMaxBytes` on those six rows
  // was undetectable — which is exactly how one reached a commit, measured on the 2011
  // `_unplaced` residue bucket instead of on a place.
  const pres = dirs
    .filter((d) => /^\d{4}_\d{2}_\d{2}_pvr$/.test(d))
    .filter((d) =>
      fs.existsSync(path.join(DATA_ROOT, d, "national_summary.json")),
    )
    .sort();
  return [
    ...(parl ? [{ kind: "parliamentary" as const, cycle: parl }] : []),
    ...locals.map((cycle) => ({ kind: "local" as const, cycle })),
    ...pres.map((cycle) => ({ kind: "presidential" as const, cycle })),
  ];
};

const CYCLES = cycles();
const hasCorpus = CYCLES.length > 0;

describe("surface budgets — §5.0's emit column against the corpus", () => {
  it("has a corpus to measure", () => {
    // The non-vacuity guard. Every assertion below is "no level is over budget", which an empty
    // measurement satisfies perfectly.
    if (!hasCorpus) {
      console.warn(
        "[skip] no data/<cycle> tree — run the pipeline before trusting the budget gate",
      );
      return;
    }
    expect(CYCLES.length).toBeGreaterThan(1);
  });

  it.runIf(hasCorpus)(
    "measures a plausible number of files at every level that has any",
    () => {
      // ⚠ THE SILENT-SKIP PATH. Both budget assertions below skip a row on `files === 0`, and
      // only two live rows are `canonical` at all — so a renamed directory takes the headline
      // gate fully vacuous with every test still green. Counts, not just sizes: the walker's own
      // predecessor bug moved local/section from 12,302 files to 289, a 42x difference that no
      // byte assertion noticed because the 289 aggregates are plausible-looking JSON.
      const EXPECTED_MIN_FILES: Partial<
        Record<`${ElectionKind}/${ElectionPlaceLevel}`, number>
      > = {
        "parliamentary/country": 1,
        "parliamentary/municipality": 250,
        "parliamentary/settlement": 5_000,
        "parliamentary/section": 25,
        "local/country": 1,
        "local/region": 25,
        "local/municipality": 250,
        "local/section": 10_000,
        // ⚠ The presidential tree is per ROUND and has no per-place shards, so every level
        // below the country is TWO files — one per round — and `section` is one per oblast
        // per round. A walker that stopped finding them would report 0 and pass without
        // these rows.
        "presidential/country": 1,
        "presidential/region": 2,
        "presidential/abroad": 2,
        "presidential/municipality": 2,
        "presidential/settlement": 2,
        "presidential/section": 25,
      };
      const wrong: string[] = [];
      for (const { kind, cycle } of CYCLES)
        for (const r of measureCycle(kind, cycle)) {
          const min = EXPECTED_MIN_FILES[`${kind}/${r.level}`];
          if (min === undefined) continue;
          if (r.files < min)
            wrong.push(
              `${kind}/${r.level} @ ${cycle}: ${r.files} files, expected at least ${min} ` +
                `(${r.measured}) — the walker is looking in the wrong place`,
            );
        }
      expect(wrong, wrong.join("\n")).toEqual([]);
    },
  );

  it.runIf(hasCorpus)(
    "serves no level from a file that is over its budget without a declared waiver",
    () => {
      // ⚠ THE ASSERTION THAT MOVED A DECISION. parliamentary/settlement was `canonical` on a
      // 7.5 KB mean and had a 1,235 KB max; this is what said so.
      // ⚠ `embedded` IS JUDGED ON THE SHARD, exactly as `canonical` is — the reader downloads
      // the same bytes either way. The earlier carve-out ("the budget applies to the surface
      // KEY") was unfalsifiable and made a 1.26x overage read as compliant.
      const over: string[] = [];
      for (const { kind, cycle } of CYCLES)
        for (const r of measureCycle(kind, cycle)) {
          const src = r.policy.source;
          if ((src !== "canonical" && src !== "embedded") || r.files === 0)
            continue;
          if (r.maxBytes <= r.budget) continue;
          if (r.policy.budgetWaiver) continue; // knowingly accepted — checked below
          over.push(
            `${kind}/${r.level} @ ${cycle}: max ${(r.maxBytes / 1024).toFixed(1)} KB > ` +
              `${(r.budget / 1024).toFixed(0)} KiB (${r.measured}) — flip it to "artifact" ` +
              `or declare a budgetWaiver with the arithmetic`,
          );
        }
      expect(over, over.join("\n")).toEqual([]);
    },
  );

  it.runIf(hasCorpus)(
    "keeps every budget waiver matching the corpus it excuses",
    () => {
      // A waiver is a decision with arithmetic attached, so growth must re-open it rather than
      // widening it silently. Two ways it goes stale: the level stops being over budget (delete
      // the waiver), or the overage grows past what the arithmetic justified.
      for (const { kind, cycle } of CYCLES)
        for (const r of measureCycle(kind, cycle)) {
          const w = r.policy.budgetWaiver;
          if (!w) continue;
          expect(
            r.maxBytes,
            `${kind}/${r.level} @ ${cycle} carries a waiver but is inside budget — delete it`,
          ).toBeGreaterThan(r.budget);
          const actual = r.maxBytes / r.budget;
          expect(
            actual,
            `${kind}/${r.level} @ ${cycle} is ${actual.toFixed(2)}x over, the waiver was ` +
              `argued at ${w.worstCaseOverBy}x — re-open the decision`,
          ).toBeLessThanOrEqual(w.worstCaseOverBy * 1.15);
          expect(w.objectCost).toBeGreaterThan(0);
          expect(w.note.length).toBeGreaterThan(20);
        }
    },
  );

  it.runIf(hasCorpus)(
    "still discriminates — the measurement really reads files",
    () => {
      // Without this, a walker that silently stopped finding files turns the gate above green.
      const rows = CYCLES.flatMap(({ kind, cycle }) =>
        measureCycle(kind, cycle),
      );
      const withFiles = rows.filter((r) => r.files > 0);
      expect(withFiles.length).toBeGreaterThan(6);
      // …and the sizes are real, not zeroes.
      for (const r of withFiles)
        expect(
          r.maxBytes,
          `${r.kind}/${r.level} measured 0 bytes`,
        ).toBeGreaterThan(0);
    },
  );

  it.runIf(hasCorpus)(
    "records a measurement for every level, and keeps it plausible",
    () => {
      // `measuredMaxBytes` is a dated observation kept beside each decision. A stale one is not a
      // failure, but an order-of-magnitude drift means the corpus moved under the decision.
      const drifted: string[] = [];
      for (const { kind, cycle } of CYCLES)
        for (const r of measureCycle(kind, cycle)) {
          // Compare the recorded number against the cycle it was recorded FROM. Comparing it
          // against every cycle calls a correct record stale the moment a second cycle differs.
          if (r.files === 0 || r.policy.measuredMaxBytes === 0) continue;
          if (r.policy.measuredCycle !== cycle) continue;
          const ratio = r.maxBytes / r.policy.measuredMaxBytes;
          if (ratio > 4 || ratio < 0.25)
            drifted.push(
              `${kind}/${r.level} @ ${cycle}: recorded ${r.policy.measuredMaxBytes} B, ` +
                `measured ${r.maxBytes} B (${ratio.toFixed(1)}x)`,
            );
        }
      expect(drifted, drifted.join("\n")).toEqual([]);
    },
  );
});

describe("surface paths", () => {
  const LEVELS: ElectionPlaceLevel[] = [
    "country",
    "region",
    "abroad",
    "municipality",
    "settlement",
    "section",
  ];

  it("locates exactly the levels that emit at an artifact path", () => {
    for (const kind of Object.keys(SURFACE_POLICY) as ElectionKind[]) {
      const emits = new Set(emittedLevels(kind));
      expect(emits.size, `${kind} emits nothing`).toBeGreaterThan(0);
      for (const level of LEVELS) {
        const loc = locateSurface(kind, level, "2026_04_19", "56784");
        if (emits.has(level)) {
          expect(loc.source, `${kind}/${level} emits`).toBe("artifact");
          expect(loc.source === "artifact" && loc.path).toBeTruthy();
        } else {
          expect(loc.source, `${kind}/${level}`).not.toBe("artifact");
          expect(loc.source).toBe(SURFACE_POLICY[kind][level].source);
        }
      }
    }
  });

  it("says PENDING, not `none`, when a level emits and the id has not arrived", () => {
    // ⚠ THE DISTINCTION THE OLD `string | null` COLLAPSED. A route param still resolving looks
    // identical to "this level never emits", so the obvious `if (!path) renderLegacy()` fires
    // mid-load and the page keeps the legacy body for ever, at a 200.
    expect(locateSurface("local", "municipality", "2023_10_29_mi").source).toBe(
      "pending",
    );
    expect(
      locateSurface("local", "municipality", "2023_10_29_mi", "PAZ19").source,
    ).toBe("artifact");
    expect(locateSurface("local", "abroad", "2023_10_29_mi", "32").source).toBe(
      "none",
    );
    expect(locateSurface("parliamentary", "country", "2026_04_19").source).toBe(
      "canonical",
    );
    expect(locateSurface("local", "section", "2023_10_29_mi", "1").source).toBe(
      "embedded",
    );
  });

  it("shards sections by oblast prefix, never flat (§5.0)", () => {
    // 12,721 files in one directory is a listing and filesystem cost with no upside.
    const p = artifactPath("section", "2026_04_19", "162300012")!;
    expect(p).toBe("2026_04_19/surface/section/by-oblast/16/162300012.json");
  });

  it("puts abroad in the region directory, declaring the level in the artifact", () => {
    // Abroad IS oblast 32 — one shard among the region shards. Its own directory would give the
    // same data two paths; the DESCRIPTOR is what selects the abroad composition.
    expect(artifactPath("abroad", "2026_04_19", "32")).toBe(
      "2026_04_19/surface/region/32.json",
    );
  });

  it("returns null for an id-bearing level with no id, rather than a malformed path", () => {
    // `.../municipality/undefined.json` is a 404 that looks like a missing place.
    expect(artifactPath("municipality", "2023_10_29_mi")).toBeNull();
    expect(artifactPath("country", "2023_10_29_mi")).toBe(
      "2023_10_29_mi/surface/country.json",
    );
  });

  it("writes every artifact inside its own cycle directory", () => {
    for (const kind of Object.keys(SURFACE_POLICY) as ElectionKind[])
      for (const level of emittedLevels(kind)) {
        const p = artifactPath(level, "CYCLE", "ID")!;
        expect(p.startsWith("CYCLE/surface/"), `${kind}/${level}: ${p}`).toBe(
          true,
        );
        expect(p.endsWith(".json")).toBe(true);
        expect(path.normalize(p)).toBe(p); // no traversal, no double slash
      }
  });

  it("declares a budget for every level", () => {
    for (const level of LEVELS)
      expect(SURFACE_BUDGET_BYTES[level], level).toBeGreaterThan(0);
  });

  it("gives every kind × level a policy with a stated reason", () => {
    for (const kind of Object.keys(SURFACE_POLICY) as ElectionKind[])
      for (const level of LEVELS) {
        const p = SURFACE_POLICY[kind][level];
        expect(p, `${kind}/${level}`).toBeTruthy();
        // A decision with no reason is a decision nobody can re-check.
        expect(
          p.reason.length,
          `${kind}/${level} has no reason`,
        ).toBeGreaterThan(20);
        expect(p.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
  });

  it("never emits a local abroad artifact — local elections are not held abroad", () => {
    expect(emittedLevels("local")).not.toContain("abroad");
    expect(locateSurface("local", "abroad", "2023_10_29_mi", "32").source).toBe(
      "none",
    );
  });
});
