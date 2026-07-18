// Verification — the Postgres store is a LOSSLESS representation of the contract
// corpus. Every sampled on-disk row is fetched from Postgres, rebuilt into a
// Contract, and deep-equaled against the source. deepStrictEqual is key-order
// independent, so the 113 source-dependent month-shard field orderings don't
// matter — only that every field value is captured and reconstructable. Also
// reconciles the headline SUM(amount_eur) straight from SQL against index.json.
//
// Requires the Postgres store (`npm run db:pg:up` + `db:load:pg`); auto-skips
// otherwise, so CI (no container, no corpus) skips it. Under DB_VERIFY=1 every
// row is compared; otherwise a deterministic stride sample (~5k) keeps it fast.
//
// See docs/plans/postgres-migration-v1.md.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROC_DIR } from "../lib/paths";
import { allRows, end } from "../lib/pg";
import { rowToContract } from "../lib/procurement_schema";
import { canonicalObject } from "../lib/canonical";
import type { Contract } from "../../procurement/types";

const haveData = existsSync(path.join(PROC_DIR, "index.json"));
const probe = async (): Promise<string | false> => {
  if (!haveData) return "no procurement data on disk";
  try {
    const n = Number(
      Object.values(
        (
          await allRows<{ n: string }>("SELECT count(*) AS n FROM contracts")
        )[0],
      )[0],
    );
    if (!n) return "contracts table empty — run npm run db:load:pg";
  } catch {
    return "no Postgres — run npm run db:pg:up + db:load:pg";
  }
  return false;
};

const skip = await probe();
afterAll(async () => {
  await end();
});

const full = process.env.DB_VERIFY === "1";
const monthShardDir = path.join(PROC_DIR, "contracts");

test.skipIf(skip)(
  "Postgres losslessly captures the contract corpus",
  async () => {
    // Pull the whole table once; rebuild Contracts, key them for O(1) lookup.
    const raw = await allRows<Record<string, string | number | null>>(
      "SELECT * FROM contracts",
    );
    const byKey = new Map<string, Contract>();
    for (const r of raw) {
      const c = rowToContract(r);
      byKey.set(c.key, c);
    }

    const shardFiles: string[] = [];
    for (const year of readdirSync(monthShardDir).sort()) {
      const dir = path.join(monthShardDir, year);
      if (year === "by-id" || !statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir).sort())
        if (f.endsWith(".json")) shardFiles.push(path.join(dir, f));
    }
    let onDisk = 0;
    for (const f of shardFiles)
      onDisk += (JSON.parse(readFileSync(f, "utf8")) as Contract[]).length;

    assert.equal(byKey.size, onDisk, "row count: Postgres vs month shards");

    const stride = full ? 1 : Math.max(1, Math.floor(onDisk / 5000));
    let i = 0;
    let compared = 0;
    const mismatches: string[] = [];
    let sumNonAmendEur = 0;
    for (const f of shardFiles) {
      const arr = JSON.parse(readFileSync(f, "utf8")) as Contract[];
      for (const src of arr) {
        if (
          typeof src.amountEur === "number" &&
          src.tag !== "contractAmendment"
        )
          sumNonAmendEur += src.amountEur;
        if (i++ % stride !== 0) continue;
        const rebuilt = byKey.get(src.key);
        if (!rebuilt) {
          mismatches.push(`${src.key}: absent from Postgres`);
          continue;
        }
        try {
          assert.deepStrictEqual(rebuilt, src);
        } catch {
          mismatches.push(src.key);
        }
        compared++;
      }
    }

    assert.equal(
      mismatches.length,
      0,
      `lossy capture for ${mismatches.length} row(s), e.g. ${mismatches.slice(0, 5).join(", ")}`,
    );
    assert.ok(compared > 0, "no rows compared");

    // Headline reconciles straight from SQL against the index. The builder now
    // sums the per-row amountEur (identical VALUES to PG's SUM(amount_eur)) — but
    // PG parallel-aggregates them, folding partial sums in worker-completion order
    // that differs from the builder's shard-read order. Over 300k doubles that
    // float non-associativity leaves sub-cent noise (~0.7 cent observed), so a
    // cents-exact compare of two cross-engine 300k-row sums is inherently flaky at
    // the rounding boundary. Reconcile at whole-EURO granularity instead — the
    // grain the UI renders (formatEur) and PG payloads ROUND() to. This still
    // catches any systematic method drift (the retired per-currency-convert path
    // skewed the headline €8.11 = 8 whole euros); it only tolerates the
    // irreducible float-order residual that no builder change can remove. The
    // per-entity rollups (tests 10/11) stay cents-exact — those sums are small and
    // order-insensitive at the cent scale.
    const euroEqual = (a: number, b: number): boolean =>
      Math.round(a) === Math.round(b);
    const sqlSum = Number(
      Object.values(
        (
          await allRows<{ s: string }>(
            "SELECT SUM(amount_eur) AS s FROM contracts WHERE tag != 'contractAmendment'",
          )
        )[0],
      )[0],
    );
    const totals = (
      canonicalObject(path.join(PROC_DIR, "index.json")) as {
        totals: { totalEur: number };
      }
    ).totals;
    assert.ok(
      euroEqual(sqlSum, totals.totalEur),
      `SQL SUM(amount_eur) ${sqlSum} vs index.totalEur ${totals.totalEur}`,
    );
    assert.ok(
      euroEqual(sumNonAmendEur, sqlSum),
      `on-disk Σ ${sumNonAmendEur} vs SQL SUM ${sqlSum}`,
    );

    console.log(
      `  round-trip: ${compared}/${onDisk} rows compared (stride ${stride})`,
    );
  },
);
