// Phase 2c — generate the cross-domain joins (mp_connected, pep_connected) FROM
// SQL and verify they reproduce the on-disk JSON byte-for-byte.
//
// These join the SQL contractor rollups to inputs from OTHER domains, which the
// JS builders also read as-is:
//   • company_politicians (kind='mp')       the gated MP↔company link set
//   • company_politicians (kind='official') the gated officials↔company link set
// So the only thing that changes vs the JS pipeline is that the contractor
// rollups come from SQL. Rollups are round-tripped through canonicalJson to match
// the serialized files the JS builders read.
//
// ⚠️ AN ARM WHOSE INPUT IS MISSING FAILS — it does not skip. A skipped arm prints one line
// and contributes no `false`, so a verifier reduced to zero arms would report on a corpus it
// never compared. The mp arm's input moved from `companies-index.json` (deleted, Tier 5) to
// Postgres, and the whole point of the move is that it is now ALWAYS reachable when the rest
// of this generator is: it reads its contractor rollups from the same database.
//
//   npm run db:gen-xref            # verify only (default)
//   npm run db:gen-xref -- --write # also write mp_connected / pep_connected (+ shards)
//
// See docs/plans/sql-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR } from "../lib/paths";
import { readContractsFromPg } from "../lib/rows";
import { stripVolatile } from "../lib/canonical";
import { buildRollupsFromRows } from "../../procurement/rollups";
import { mpLinkageAvailable, readOfficialLinkRows } from "../../lib/mp_linkage";
import {
  buildEikLinkageMap,
  buildMpConnectedFrom,
  writeMpConnected,
} from "../../procurement/cross_reference";
import {
  buildPepConnectedFrom,
  writePepConnected,
} from "../../procurement/pep_connected";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type { Contract, ContractorRollup } from "../../procurement/types";

const DERIVED_DIR = path.join(PROC_DIR, "derived");

const byteCmp = (label: string, gen: unknown, abs: string): boolean => {
  if (!fs.existsSync(abs)) {
    console.log(`${label}: no live file`);
    return false;
  }
  const ok = isDeepStrictEqual(
    stripVolatile(JSON.parse(canonicalJson(gen))),
    stripVolatile(JSON.parse(fs.readFileSync(abs, "utf8"))),
  );
  console.log(`${label}: ${ok ? "OK" : "DIFF"}`);
  return ok;
};

const main = async (): Promise<void> => {
  const write = process.argv.includes("--write");

  const t0 = Date.now();
  const rows: Contract[] = (await readContractsFromPg()).sort(rowSort);
  console.log(
    `read ${rows.length} rows from Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const { contractors } = buildRollupsFromRows(rows, PROC_DIR);
  const contractorsR = JSON.parse(
    canonicalJson(contractors),
  ) as ContractorRollup[];
  const byEik = new Map(contractorsR.map((c) => [c.eik, c]));
  const getContractor = (eik: string): ContractorRollup | null =>
    byEik.get(eik) ?? null;

  const results: boolean[] = [];

  // mp_connected — needs the gated MP↔company link set, from the same database as the
  // rollups above. Deliberately NOT gated into a skip (see the ⚠️ in the header): an absent
  // table is a FAIL. It is probed only so the failure names the fix, rather than surfacing
  // `relation "company_politicians" does not exist` out of main().catch.
  if (await mpLinkageAvailable()) {
    const linkageMap = await buildEikLinkageMap();
    const mp = buildMpConnectedFrom(getContractor, linkageMap);
    results.push(
      byteCmp("mp_connected", mp, path.join(DERIVED_DIR, "mp_connected.json")),
    );
    if (write) writeMpConnected(DERIVED_DIR, mp);
  } else {
    console.log(
      "mp_connected: FAIL — company_politicians is not reachable; run db:load:tr:pg",
    );
    results.push(false);
  }

  // pep_connected — the officials arm of the same gated link set, from the same database as
  // the rollups above. Deliberately NOT gated into a skip (see the ⚠️ in the header): an
  // absent table is a FAIL. Probed only so the failure names the fix.
  if (await mpLinkageAvailable()) {
    const links = await readOfficialLinkRows(
      "the pep_connected parity check would compare against nothing.",
    );
    const pep = buildPepConnectedFrom(links, getContractor);
    results.push(
      byteCmp(
        "pep_connected",
        pep,
        path.join(DERIVED_DIR, "pep_connected.json"),
      ),
    );
    if (write) writePepConnected(DERIVED_DIR, pep);
  } else {
    console.log(
      "pep_connected: FAIL — company_politicians is not reachable; run db:load:tr:pg",
    );
    results.push(false);
  }

  if (write) console.log("wrote mp_connected / pep_connected (+ shards)");
  const clean = results.length > 0 && results.every(Boolean);
  console.log(
    clean ? "OK — reproduces on-disk cross-reference" : "DIFFERENCES FOUND",
  );
  process.exit(clean ? 0 : 1);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
