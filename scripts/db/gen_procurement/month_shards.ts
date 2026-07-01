// Phase 2c — regenerate the contract month shards (contracts/<YYYY>/<YYYY-MM>.json)
// FROM SQL and verify they reproduce the on-disk rows.
//
// Month shards embed full Contract rows (113 source-dependent field orderings),
// so byte-identity isn't the goal; the check is order-independent deep-equal of
// each month's array — same rows, in the same rowSort order (validate.ts:rowSort).
// Money stays FULL precision (the decision on 2026-07-01: shards are not
// cents-rounded — the on-disk shards predate the canonicalJson *Eur rounding, so
// --write uses rawJson to match), so the compare is exact on numbers.
//
//   npm run db:gen-shards            # verify only (default)
//   npm run db:gen-shards -- --write # also write the shards (full precision)
//
// See docs/plans/sql-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR, PROC_DB } from "../lib/paths";
import { openDb } from "../lib/open";
import { rowToContract } from "../lib/procurement_schema";
import { rowSort, rawJson } from "../../procurement/validate";
import type { Contract } from "../../procurement/types";

const contractsDir = path.join(PROC_DIR, "contracts");

const liveShardFiles = (): Map<string, string> => {
  const out = new Map<string, string>(); // "YYYY-MM" -> abs path
  for (const year of fs.readdirSync(contractsDir).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const dir = path.join(contractsDir, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir))
      if (/^\d{4}-\d{2}\.json$/.test(f))
        out.set(f.slice(0, 7), path.join(dir, f));
  }
  return out;
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
  const rows: Contract[] = sqlRows.map(rowToContract);
  console.log(
    `read ${rows.length} rows from SQL in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  // Group by shard month, then sort each shard by rowSort (as writeMonthShards).
  const byMonth = new Map<string, Contract[]>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(r);
    byMonth.set(month, arr);
  }
  for (const arr of byMonth.values()) arr.sort(rowSort);

  const live = liveShardFiles();
  let match = 0;
  let diff = 0;
  let missing = 0;
  const samples: string[] = [];
  for (const [month, arr] of byMonth) {
    const liveFile = live.get(month);
    if (!liveFile) {
      missing++;
      if (samples.length < 8) samples.push(`${month} (no live)`);
      continue;
    }
    const liveRows = JSON.parse(
      fs.readFileSync(liveFile, "utf8"),
    ) as Contract[];
    if (isDeepStrictEqual(arr, liveRows)) match++;
    else {
      diff++;
      if (samples.length < 8) samples.push(month);
    }
  }
  const extra = [...live.keys()].filter((m) => !byMonth.has(m)).length;
  console.log(
    `month shards: ${match} match, ${diff} diff, ${missing} missing-live, ${extra} extra-live` +
      (samples.length ? `  e.g. ${samples.join(", ")}` : ""),
  );

  if (write) {
    for (const [month, arr] of byMonth) {
      const dir = path.join(contractsDir, month.slice(0, 4));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${month}.json`), rawJson(arr));
    }
    console.log(
      "wrote month shards (full precision) to data/procurement/contracts",
    );
  }

  const clean = diff === 0 && missing === 0 && extra === 0;
  console.log(clean ? "OK — reproduces on-disk shards" : "DIFFERENCES FOUND");
  process.exit(clean ? 0 : 1);
};

main();
