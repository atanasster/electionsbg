// Phase 2c — generate the per-settlement procurement shards FROM SQL and verify
// they reproduce the on-disk JSON byte-for-byte.
//
// Inputs, all SQL-derivable: awarder rollups (buildRollupsFromRows) + per-awarder
// contract lists (buildAwarderContractsFiles) + the static EKATTE registry. The
// JS builder reads the SERIALIZED (cents-rounded) rollup + awarder_contracts
// files, so we round the in-memory ones through canonicalJson first (else summed
// settlement totals and top-contract ranking diverge). Outputs are fully sorted,
// so awarder input order doesn't matter → byte-identical.
//
//   npm run db:gen-settlement            # verify only (default)
//   npm run db:gen-settlement -- --write # also write the files
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
import { buildAwarderContractsFiles } from "../../procurement/awarder_contracts";
import {
  buildBySettlementData,
  type EkatteEntry,
} from "../../procurement/by_settlement";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type { AwarderRollup, Contract } from "../../procurement/types";

const bsDir = path.join(PROC_DIR, "by_settlement");
const norm = (v: unknown): unknown =>
  stripVolatile(JSON.parse(canonicalJson(v)));

const byteCmp = (label: string, gen: unknown, abs: string): boolean => {
  if (!fs.existsSync(abs)) {
    console.log(`${label}: no live file`);
    return false;
  }
  const ok = isDeepStrictEqual(
    norm(gen),
    stripVolatile(JSON.parse(fs.readFileSync(abs, "utf8"))),
  );
  console.log(`${label}: ${ok ? "OK" : "DIFF"}`);
  return ok;
};

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

  const now = new Date().toISOString();
  const { awarders } = buildRollupsFromRows(rows, PROC_DIR);
  // Round to match what the JS builder reads from the serialized files.
  const awardersR = JSON.parse(canonicalJson(awarders)) as AwarderRollup[];
  const acMap = new Map<string, Contract[]>();
  for (const f of buildAwarderContractsFiles(rows, now))
    acMap.set(f.eik, JSON.parse(canonicalJson(f.contracts)) as Contract[]);
  const getAwarderContracts = (eik: string): Contract[] => acMap.get(eik) ?? [];

  const ekIndex = JSON.parse(
    fs.readFileSync(path.join(PROC_DIR, "..", "ekatte_index.json"), "utf8"),
  ) as EkatteEntry[];

  const data = buildBySettlementData(
    awardersR,
    getAwarderContracts,
    ekIndex,
    now,
  );

  // Per-settlement files.
  const liveEkattes = new Set(
    fs
      .readdirSync(bsDir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => f.slice(0, -5)),
  );
  const genEkattes = new Set<string>();
  let match = 0;
  let diff = 0;
  let missing = 0;
  const samples: string[] = [];
  for (const f of data.settlements) {
    genEkattes.add(f.ekatte);
    const live = path.join(bsDir, `${f.ekatte}.json`);
    if (!fs.existsSync(live)) {
      missing++;
      continue;
    }
    if (
      isDeepStrictEqual(
        norm(f),
        stripVolatile(JSON.parse(fs.readFileSync(live, "utf8"))),
      )
    )
      match++;
    else {
      diff++;
      if (samples.length < 8) samples.push(f.ekatte);
    }
  }
  const extra = [...liveEkattes].filter((e) => !genEkattes.has(e)).length;
  console.log(
    `settlements: ${match} match, ${diff} diff, ${missing} missing-live, ${extra} extra-live` +
      (samples.length ? `  e.g. ${samples.join(", ")}` : ""),
  );

  const natOk = byteCmp(
    "_national",
    data.national,
    path.join(bsDir, "_national.json"),
  );
  const idxOk = byteCmp("index", data.index, path.join(bsDir, "index.json"));

  if (write) {
    fs.mkdirSync(bsDir, { recursive: true });
    for (const f of data.settlements)
      fs.writeFileSync(path.join(bsDir, `${f.ekatte}.json`), canonicalJson(f));
    fs.writeFileSync(
      path.join(bsDir, "_national.json"),
      canonicalJson(data.national),
    );
    fs.writeFileSync(path.join(bsDir, "index.json"), canonicalJson(data.index));
    for (const file of fs.readdirSync(bsDir)) {
      if (!/^\d+\.json$/.test(file)) continue;
      if (!data.keptEkattes.has(file.slice(0, -5)))
        fs.unlinkSync(path.join(bsDir, file));
    }
    console.log("wrote by_settlement/*");
  }

  const clean = diff === 0 && missing === 0 && extra === 0 && natOk && idxOk;
  console.log(
    clean ? "OK — reproduces on-disk by_settlement" : "DIFFERENCES FOUND",
  );
  process.exit(clean ? 0 : 1);
};

main();
