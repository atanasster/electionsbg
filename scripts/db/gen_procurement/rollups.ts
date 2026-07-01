// Phase 2c — generate the per-contractor / per-awarder rollups FROM SQL and
// verify they reproduce the on-disk JSON byte-for-byte (run-stamps aside).
//
// Reuses the exact accumulator the JS pipeline uses (rollups.ts:
// buildRollupsFromRows) — the only thing that changes is the row SOURCE: instead
// of reading month shards, we SELECT * FROM contracts and re-sort by rowSort so
// the iteration order (hence last-write-wins names + per-currency float
// summation) is identical. This proves the SQL store can drive the derived layer.
//
//   npm run db:gen-rollups          # verify only (default)
//   npm run db:gen-rollups -- --write   # also write the files
//
// See docs/plans/sql-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR, PROC_DB } from "../lib/paths";
import { openDb } from "../lib/open";
import { rowToContract } from "../lib/procurement_schema";
import { stripVolatile } from "../lib/canonical";
import { buildRollupsFromRows } from "../../procurement/rollups";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type { Contract } from "../../procurement/types";

interface RollupOut {
  eik: string;
}

interface CompareResult {
  match: number;
  diff: number;
  missing: number;
  extraLive: number;
  diffSamples: string[];
}

const compareDir = (kind: string, rollups: RollupOut[]): CompareResult => {
  const dir = path.join(PROC_DIR, kind);
  const liveEiks = new Set(
    fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => f.slice(0, -5)),
  );
  const genEiks = new Set<string>();
  let match = 0;
  let diff = 0;
  let missing = 0;
  const diffSamples: string[] = [];

  for (const r of rollups) {
    if (r.eik === "") continue; // blank EIK gets no rollup file by design
    genEiks.add(r.eik);
    const liveFile = path.join(dir, `${r.eik}.json`);
    if (!fs.existsSync(liveFile)) {
      missing++;
      if (diffSamples.length < 8) diffSamples.push(`${r.eik} (no live file)`);
      continue;
    }
    const gen = stripVolatile(JSON.parse(canonicalJson(r)));
    const live = stripVolatile(JSON.parse(fs.readFileSync(liveFile, "utf8")));
    if (isDeepStrictEqual(gen, live)) {
      match++;
    } else {
      diff++;
      if (diffSamples.length < 8) diffSamples.push(r.eik);
    }
  }

  const extraLive = [...liveEiks].filter((e) => !genEiks.has(e)).length;
  return { match, diff, missing, extraLive, diffSamples };
};

// First differing line between the generated and live canonical JSON, for the
// first mismatching eik — turns "diff: 3" into something actionable.
const showFirstDiff = (kind: string, rollups: RollupOut[]): void => {
  for (const r of rollups) {
    if (r.eik === "") continue;
    const liveFile = path.join(PROC_DIR, kind, `${r.eik}.json`);
    if (!fs.existsSync(liveFile)) continue;
    const gen = JSON.parse(canonicalJson(r));
    const live = JSON.parse(fs.readFileSync(liveFile, "utf8"));
    if (isDeepStrictEqual(stripVolatile(gen), stripVolatile(live))) continue;
    const g = canonicalJson(gen).split("\n");
    const l = canonicalJson(live).split("\n");
    for (let i = 0; i < Math.max(g.length, l.length); i++) {
      if (g[i] !== l[i]) {
        console.log(`  first diff in ${kind}/${r.eik}.json @ line ${i + 1}:`);
        console.log(`    live: ${(l[i] ?? "<absent>").trim()}`);
        console.log(`    sql : ${(g[i] ?? "<absent>").trim()}`);
        return;
      }
    }
  }
};

const main = (): void => {
  if (!fs.existsSync(PROC_DB)) {
    console.error(`No ${PROC_DB} — run npm run db:load first.`);
    process.exit(1);
  }
  const write = process.argv.includes("--write");

  const db = openDb(PROC_DB, { readOnly: true });
  const t0 = Date.now();
  const sqlRows = db.prepare("SELECT * FROM contracts").all() as Array<
    Record<string, string | number | null>
  >;
  db.close();
  const rows: Contract[] = sqlRows.map(rowToContract).sort(rowSort);
  console.log(
    `read ${rows.length} rows from SQL in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const { contractors, awarders } = buildRollupsFromRows(rows, PROC_DIR);

  const c = compareDir("contractors", contractors);
  const a = compareDir("awarders", awarders);

  const report = (kind: string, r: CompareResult): void => {
    console.log(
      `${kind}: ${r.match} match, ${r.diff} diff, ${r.missing} missing-live, ${r.extraLive} extra-live` +
        (r.diffSamples.length ? `  e.g. ${r.diffSamples.join(", ")}` : ""),
    );
  };
  report("contractors", c);
  report("awarders", a);
  if (c.diff > 0) showFirstDiff("contractors", contractors);
  if (a.diff > 0) showFirstDiff("awarders", awarders);

  if (write) {
    for (const [kind, list] of [
      ["contractors", contractors],
      ["awarders", awarders],
    ] as const) {
      const dir = path.join(PROC_DIR, kind);
      fs.mkdirSync(dir, { recursive: true });
      const keep = new Set<string>();
      for (const r of list)
        if (r.eik !== "") {
          fs.writeFileSync(path.join(dir, `${r.eik}.json`), canonicalJson(r));
          keep.add(`${r.eik}.json`);
        }
      // Orphan sweep: drop per-EIK rollups no longer produced (e.g. the 34
      // stale amendment-only contractors) — the JS writeRollups never pruned
      // these, so a --write flip must, or they linger and re-enter top_contractors.
      for (const f of fs.readdirSync(dir))
        if (/^\d+\.json$/.test(f) && !keep.has(f))
          fs.unlinkSync(path.join(dir, f));
    }
    console.log(
      "wrote rollups (+ orphan sweep) to data/procurement/{contractors,awarders}",
    );
  }

  const clean =
    c.diff === 0 && c.missing === 0 && a.diff === 0 && a.missing === 0;
  console.log(
    clean ? "OK — byte-identical to on-disk rollups" : "DIFFERENCES FOUND",
  );
  process.exit(clean ? 0 : 1);
};

main();
