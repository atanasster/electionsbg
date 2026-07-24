// Tier 3 — durable integrity invariants over the generated procurement corpus.
// These are data-version-independent (computed FROM the data, not against a
// frozen snapshot), so they stay valid across the fortnightly ingest and form
// the standing regression net for the SQL migration: if a SQL-generated corpus
// violates key uniqueness, the EUR peg, the twin dedup, or the headline
// reconciliation, these fail immediately.
//
//   npm run test:data
//
// Auto-skips when no procurement data is on disk (e.g. a fresh CI checkout that
// hasn't restored the corpus). See docs/plans/sql-migration-v1.md (Phase 1).

import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PROC_DIR, isEikRollupFile } from "../lib/paths";
import {
  CONTRACT_SHARD_DIR,
  aggregateContracts,
  centsEqual,
} from "../lib/contracts_aggregate";
import { canonicalObject } from "../lib/canonical";

const indexPath = path.join(PROC_DIR, "index.json");
// index.json is committed but the month shards are gitignored, so a plain CI
// checkout has the index and no corpus — both must be present to aggregate.
const haveData = existsSync(indexPath) && existsSync(CONTRACT_SHARD_DIR);
const skip = haveData ? false : "no procurement data on disk";

interface IndexTotals {
  contracts: number;
  awards: number;
  amendments: number;
  contractorCount: number;
  awarderCount: number;
  totalEur: number;
}

// Compute the heavy aggregate once for the whole suite.
const agg = haveData ? aggregateContracts() : null;
const totals = haveData
  ? (canonicalObject(indexPath) as { totals: IndexTotals }).totals
  : null;

const eikJsonCount = (dir: string): number =>
  existsSync(dir) ? readdirSync(dir).filter(isEikRollupFile).length : 0;

const sampleEiks = (m: Map<string, number>, n: number): string[] => {
  const byEik = [...m.keys()].sort();
  const stride = Math.max(1, Math.floor(byEik.length / n));
  const strided = byEik.filter((_, i) => i % stride === 0);
  const byVal = [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([e]) => e);
  return [...new Set([...byVal, ...strided])];
};

test.skipIf(skip)("index totals reconcile with the month shards", () => {
  assert.equal(agg!.byTag.contract ?? 0, totals!.contracts, "contract count");
  assert.equal(
    agg!.byTag.contractAmendment ?? 0,
    totals!.amendments,
    "amendment count",
  );
  assert.equal(agg!.byTag.award ?? 0, totals!.awards, "award count");
  assert.ok(
    centsEqual(agg!.nonAmendEur, totals!.totalEur),
    `headline totalEur: index ${totals!.totalEur} vs Σ non-amendment amountEur ${agg!.nonAmendEur.toFixed(2)}`,
  );
});

test.skipIf(skip)("contract keys are globally unique", () => {
  assert.equal(
    agg!.distinctKeyCount,
    agg!.rows,
    `${agg!.duplicateKeys.length} duplicate key(s), e.g. ${agg!.duplicateKeys
      .slice(0, 5)
      .join(", ")} — see disambiguateContractKeys in contract_key.ts`,
  );
});

test.skipIf(skip)("no synthetic legacy -x twin survivors", () => {
  assert.equal(
    agg!.xTwinSurvivors,
    0,
    `${agg!.xTwinSurvivors} "-x" row(s) coexist with a real twin (double-counts ` +
      `spend) — see dropSyntheticLegacyTwins in validate.ts. Sample: ${agg!.xTwinSample.join(" | ")}`,
  );
});

test.skipIf(skip)("EUR peg (1.95583) holds on convertible rows", () => {
  assert.equal(
    agg!.pegViolations.length,
    0,
    `amountEur diverges from the locked peg, e.g. ${JSON.stringify(
      agg!.pegViolations[0],
    )} — see src/lib/currency.ts`,
  );
});

// A handful of legacy rows carry a blank EIK (no supplier/buyer id upstream).
// The corpus handles this with two conventions, both intentional: the index
// COUNTS the blank as a distinct party (it is a distinct contract row), but no
// per-entity rollup file is written for it. So file counts exclude the blank
// while index counts include it.
const nonBlank = (s: Set<string>): number => s.size - (s.has("") ? 1 : 0);

test.skipIf(skip)("contractor/awarder file counts match distinct EIKs", () => {
  assert.equal(
    eikJsonCount(path.join(PROC_DIR, "contractors")),
    nonBlank(agg!.contractorEikAll),
    "contractor rollup files vs distinct non-blank contractor EIKs (all tags)",
  );
  assert.equal(
    eikJsonCount(path.join(PROC_DIR, "awarders")),
    nonBlank(agg!.awarderEikAll),
    "awarder rollup files vs distinct non-blank awarder EIKs (all tags)",
  );
  assert.equal(
    totals!.contractorCount,
    agg!.contractorEikNonAmend.size,
    "index.contractorCount vs distinct contract-tag contractor EIKs (blank included)",
  );
  assert.equal(
    totals!.awarderCount,
    agg!.awarderEikNonAmend.size,
    "index.awarderCount vs distinct contract-tag awarder EIKs (blank included)",
  );
});

test.skipIf(skip)(
  "sampled contractor rollups reconcile (contract-only totalEur)",
  () => {
    const dir = path.join(PROC_DIR, "contractors");
    const mismatches: string[] = [];
    for (const eik of sampleEiks(agg!.contractorEur, 200)) {
      const f = path.join(dir, `${eik}.json`);
      if (!existsSync(f)) continue;
      const o = canonicalObject(f) as { totalEur: number };
      const expected = agg!.contractorEur.get(eik) ?? 0;
      if (!centsEqual(o.totalEur, expected))
        mismatches.push(
          `${eik}: file ${o.totalEur} vs Σ ${expected.toFixed(2)}`,
        );
    }
    assert.equal(
      mismatches.length,
      0,
      `contractor totalEur mismatch: ${mismatches.slice(0, 5).join(" | ")}`,
    );
  },
);

test.skipIf(skip)(
  "sampled awarder rollups reconcile (contract-only totalEur)",
  () => {
    const dir = path.join(PROC_DIR, "awarders");
    const mismatches: string[] = [];
    for (const eik of sampleEiks(agg!.awarderEur, 200)) {
      const f = path.join(dir, `${eik}.json`);
      if (!existsSync(f)) continue;
      const o = canonicalObject(f) as { totalEur: number };
      const expected = agg!.awarderEur.get(eik) ?? 0;
      if (!centsEqual(o.totalEur, expected))
        mismatches.push(
          `${eik}: file ${o.totalEur} vs Σ ${expected.toFixed(2)}`,
        );
    }
    assert.equal(
      mismatches.length,
      0,
      `awarder totalEur mismatch: ${mismatches.slice(0, 5).join(" | ")}`,
    );
  },
);
