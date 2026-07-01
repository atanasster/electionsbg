// Phase 2c — generate the cross-domain joins (mp_connected, pep_connected) FROM
// SQL and verify they reproduce the on-disk JSON byte-for-byte.
//
// These join the SQL contractor rollups to inputs from OTHER domains, which the
// JS builders also read as-is:
//   • data/parliament/companies-index.json  (MP↔company graph, from /update-connections)
//   • raw_data/tr/state.sqlite               (TR namesake counts, for the linkage guard)
//   • data/officials/derived/company_links.json (officials↔company graph)
// So the only thing that changes vs the JS pipeline is that the contractor
// rollups come from SQL. Rollups are round-tripped through canonicalJson to match
// the serialized files the JS builders read.
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
import {
  buildTrNamesakeCounts,
  buildEikLinkageMap,
  buildMpConnectedFrom,
  writeMpConnected,
} from "../../procurement/cross_reference";
import {
  buildPepConnectedFrom,
  writePepConnected,
  type CompanyLinksFile,
} from "../../procurement/pep_connected";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type { Contract, ContractorRollup } from "../../procurement/types";

const rel = (...p: string[]) => path.join(PROC_DIR, "..", ...p);
const COMPANIES_INDEX = rel("parliament", "companies-index.json");
const COMPANY_LINKS = rel("officials", "derived", "company_links.json");
const TR_DB = rel("..", "raw_data", "tr", "state.sqlite");
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

  // mp_connected — needs companies-index.json + TR namesake counts.
  if (fs.existsSync(COMPANIES_INDEX)) {
    const trNamesake = buildTrNamesakeCounts(TR_DB);
    const linkageMap = buildEikLinkageMap(COMPANIES_INDEX, trNamesake);
    const mp = buildMpConnectedFrom(getContractor, linkageMap);
    results.push(
      byteCmp("mp_connected", mp, path.join(DERIVED_DIR, "mp_connected.json")),
    );
    if (write) writeMpConnected(DERIVED_DIR, mp);
  } else {
    console.log("mp_connected: skipped (no companies-index.json)");
  }

  // pep_connected — needs officials company_links.json.
  if (fs.existsSync(COMPANY_LINKS)) {
    const links = JSON.parse(
      fs.readFileSync(COMPANY_LINKS, "utf8"),
    ) as CompanyLinksFile;
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
    console.log("pep_connected: skipped (no company_links.json)");
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
