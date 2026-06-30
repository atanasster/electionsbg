// Phase 2b verification — the SQL store is a LOSSLESS representation of the
// contract corpus. For each sampled on-disk row we fetch its SQL row, rebuild a
// Contract, and deep-equal it against the source. deepStrictEqual is key-order
// independent, so the 113 source-dependent month-shard field orderings don't
// matter here — only that every field value is captured and reconstructable.
//
// Requires the DB built by `npm run db:load`; auto-skips otherwise. Under
// DB_VERIFY=1 every one of the ~301k rows is compared; otherwise a deterministic
// stride sample (~5k) keeps the standing suite fast.
//
// See docs/plans/sql-migration-v1.md (Phase 2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROC_DIR, PROC_DB } from "../lib/paths";
import { openDb } from "../lib/open";
import { rowToContract } from "../lib/procurement_schema";
import { centsEqual } from "../lib/contracts_aggregate";
import { canonicalObject } from "../lib/canonical";
import type { Contract } from "../../procurement/types";

const haveData = existsSync(path.join(PROC_DIR, "index.json"));
const haveDb = existsSync(PROC_DB);
const skip = !haveData
  ? "no procurement data on disk"
  : !haveDb
    ? "no procurement.sqlite — run npm run db:load"
    : false;

const full = process.env.DB_VERIFY === "1";
const monthShardDir = path.join(PROC_DIR, "contracts");

interface SqlRow {
  [col: string]: string | number | null;
}

test("SQL store losslessly captures the contract corpus", { skip }, () => {
  const db = openDb(PROC_DB, { readOnly: true });
  try {
    const dbCount = (
      db.prepare("SELECT COUNT(*) AS n FROM contracts").get() as { n: number }
    ).n;

    // Total on-disk row count first, to size the stride deterministically.
    let onDisk = 0;
    const shardFiles: string[] = [];
    for (const year of readdirSync(monthShardDir).sort()) {
      const dir = path.join(monthShardDir, year);
      if (year === "by-id" || !statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir).sort())
        if (f.endsWith(".json")) shardFiles.push(path.join(dir, f));
    }
    for (const f of shardFiles)
      onDisk += (JSON.parse(readFileSync(f, "utf8")) as Contract[]).length;

    assert.equal(dbCount, onDisk, "row count: SQL vs month shards");

    const stride = full ? 1 : Math.max(1, Math.floor(onDisk / 5000));
    const getByKey = db.prepare("SELECT * FROM contracts WHERE key = ?");

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
        const row = getByKey.get(src.key) as SqlRow | undefined;
        if (!row) {
          mismatches.push(`${src.key}: absent from SQL`);
          continue;
        }
        const rebuilt = rowToContract(row);
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

    // Headline reconciles straight from SQL (cents-exact against the index).
    const sqlSum = (
      db
        .prepare(
          "SELECT SUM(amount_eur) AS s FROM contracts WHERE tag != 'contractAmendment'",
        )
        .get() as { s: number }
    ).s;
    const totals = (
      canonicalObject(path.join(PROC_DIR, "index.json")) as {
        totals: { totalEur: number };
      }
    ).totals;
    assert.ok(
      centsEqual(sqlSum, totals.totalEur),
      `SQL SUM(amount_eur) ${sqlSum} vs index.totalEur ${totals.totalEur}`,
    );
    assert.ok(
      centsEqual(sumNonAmendEur, sqlSum),
      `on-disk Σ ${sumNonAmendEur} vs SQL SUM ${sqlSum}`,
    );

    console.log(
      `  round-trip: ${compared}/${onDisk} rows compared (stride ${stride})`,
    );
  } finally {
    db.close();
  }
});
