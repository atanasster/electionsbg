// Phase 2c — generate the per-election (by_ns) pre-aggregates FROM SQL and
// verify they reproduce the on-disk JSON byte-for-byte.
//
// by_ns joins the contract rows (from SQL) against mp_connected / pep_connected
// (SQL-reproducible) + the awarder geo, oblast map, and EKATTE catalog (read
// as-is, all SQL-reproducible or external-static). buildByNs writes 6 file
// families per election (main + flow/people/concentration/risk_feed/by_settlement).
// We run it into a temp dir (passing the real input paths so its outDir-relative
// reads still resolve) and diff every file against data/procurement/by_ns/.
//
//   npm run db:gen-byns            # verify only (default; builds to a temp dir)
//   npm run db:gen-byns -- --write # write to data/procurement/by_ns
//
// See docs/plans/sql-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR, PROC_DB } from "../lib/paths";
import { openDb } from "../lib/open";
import { rowToContract } from "../lib/procurement_schema";
import { stripVolatile, walkJsonFiles } from "../lib/canonical";
import { buildByNs } from "../../procurement/by_ns";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type { Contract, MpConnectedFile } from "../../procurement/types";
import type { PepConnectedFile } from "../../procurement/pep_connected";

const BY_NS_DIR = path.join(PROC_DIR, "by_ns");
// Temp build target for verify mode — under the gitignored scripts/db/.cache
// (never committed, never bucket-synced). buildByNs's input reads are decoupled
// from outDir via the explicit path opts below, so outDir can live anywhere.
const TEMP_DIR = path.join(
  PROC_DIR,
  "..",
  "..",
  "scripts",
  "db",
  ".cache",
  "by_ns_sqlcheck",
);
const rel = (...p: string[]) => path.join(PROC_DIR, "..", ...p);

const readJson = <T>(abs: string): T =>
  JSON.parse(fs.readFileSync(abs, "utf8")) as T;

const main = (): void => {
  if (!fs.existsSync(PROC_DB)) {
    console.error(`No ${PROC_DB} — run npm run db:load first.`);
    process.exit(1);
  }
  const write = process.argv.includes("--write");

  const db = openDb(PROC_DB, { readOnly: true });
  const t0 = Date.now();
  const rows: Contract[] = (
    db.prepare("SELECT * FROM contracts").all() as Array<
      Record<string, string | number | null>
    >
  )
    .map(rowToContract)
    .sort(rowSort);
  db.close();
  console.log(
    `read ${rows.length} rows from SQL in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const mpConnected = readJson<MpConnectedFile>(
    path.join(BY_NS_DIR, "..", "derived", "mp_connected.json"),
  );
  const pepConnected = readJson<PepConnectedFile>(
    path.join(BY_NS_DIR, "..", "derived", "pep_connected.json"),
  );
  const elections = readJson<Array<{ name: string }>>(
    rel("..", "src", "data", "json", "elections.json"),
  );

  const outDir = write ? BY_NS_DIR : TEMP_DIR;
  if (!write) fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  const res = buildByNs({
    contractsDir: path.join(PROC_DIR, "contracts"),
    contracts: rows,
    mpConnected,
    pepConnected,
    outDir,
    elections,
    // Real input paths so temp-outDir builds still read the true inputs.
    oblastMapPath: path.join(PROC_DIR, "derived", "buyer_oblast_map.json"),
    awardersDir: path.join(PROC_DIR, "awarders"),
    ekattePath: rel("ekatte_index.json"),
  });
  console.log(
    `built ${res.files} file(s) across ${res.ranges.length} election(s)`,
  );

  if (write) {
    console.log("wrote data/procurement/by_ns/*");
    process.exit(0);
  }

  // Compare every generated file to its on-disk counterpart.
  let match = 0;
  let diff = 0;
  const samples: string[] = [];
  const genRel = new Set<string>();
  for (const abs of walkJsonFiles(TEMP_DIR)) {
    const r = path.relative(TEMP_DIR, abs);
    genRel.add(r);
    const live = path.join(BY_NS_DIR, r);
    if (!fs.existsSync(live)) {
      diff++;
      if (samples.length < 8) samples.push(`${r} (no live)`);
      continue;
    }
    const g = stripVolatile(JSON.parse(canonicalJson(readJson(abs))));
    const l = stripVolatile(JSON.parse(fs.readFileSync(live, "utf8")));
    if (isDeepStrictEqual(g, l)) match++;
    else {
      diff++;
      if (samples.length < 8) samples.push(r);
    }
  }
  const extra = walkJsonFiles(BY_NS_DIR)
    .map((a) => path.relative(BY_NS_DIR, a))
    .filter((r) => !genRel.has(r)).length;

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log(
    `by_ns: ${match} match, ${diff} diff, ${extra} extra-live` +
      (samples.length ? `  e.g. ${samples.join(", ")}` : ""),
  );
  const clean = diff === 0 && extra === 0;
  console.log(clean ? "OK — reproduces on-disk by_ns" : "DIFFERENCES FOUND");
  process.exit(clean ? 0 : 1);
};

main();
