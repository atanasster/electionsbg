// Phase 2c — generate index.json (+ the derived-of-derived feeds risk_feed /
// concentration_full / person_procurement_index) FROM SQL and verify they
// reproduce the on-disk JSON.
//
// index.json = totals (SQL rollups) + years/months (from the contract dates) +
// periods (bundles.json) + crossReference/officialsCrossReference summaries over
// the SQL-reproducible mp_connected / pep_connected. The three risk feeds are
// pure re-derivations of the (SQL-reproducible) derived files, so verifying them
// here doubles as a determinism + non-staleness check.
//
//   npm run db:gen-index            # verify only (default)
//   npm run db:gen-index -- --write # also write index.json + the risk feeds
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
import {
  buildRiskFeed,
  writeRiskFeed,
  buildConcentrationFull,
  writeConcentrationFull,
  buildPersonIndex,
  writePersonIndex,
} from "../../procurement/risk_feed";
import { rowSort, canonicalJson } from "../../procurement/validate";
import type {
  BundlesIndex,
  Contract,
  MpConnectedFile,
  ProcurementIndex,
} from "../../procurement/types";
import type { PepConnectedFile } from "../../procurement/pep_connected";

const DERIVED_DIR = path.join(PROC_DIR, "derived");
const now = "";

const readJson = <T>(rel: string): T | null => {
  const p = path.join(PROC_DIR, rel);
  return fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf8")) as T)
    : null;
};

const byteCmp = (label: string, gen: unknown, rel: string): boolean => {
  const abs = path.join(PROC_DIR, rel);
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

  const { totals } = buildRollupsFromRows(rows, PROC_DIR);
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();

  const bundles = readJson<BundlesIndex>("bundles.json");
  const periods = (bundles?.entries ?? []).map((b) => ({
    bundleUuid: b.datasetUuid,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
  }));

  // crossReference summary over mp_connected (sums euro across ALL pairs — a
  // contractor tied to 2 MPs counts twice, matching ingest.ts).
  const mp = readJson<MpConnectedFile>("derived/mp_connected.json");
  let crossReference: ProcurementIndex["crossReference"];
  if (mp) {
    const mpSet = new Set<number>();
    const cSet = new Set<string>();
    let totalEur = 0;
    const totalOther: Record<string, number> = {};
    for (const e of mp.entries) {
      mpSet.add(e.mpId);
      cSet.add(e.contractorEik);
      totalEur += e.totalEur;
      for (const [c, a] of Object.entries(e.totalOther))
        totalOther[c] = (totalOther[c] ?? 0) + a;
    }
    crossReference = {
      generatedAt: now,
      mpCount: mpSet.size,
      contractorCount: cSet.size,
      pairCount: mp.entries.length,
      totalEur,
      totalOther,
    };
  }

  // officialsCrossReference over pep_connected (de-duped by contractor EIK).
  const pep = readJson<PepConnectedFile>("derived/pep_connected.json");
  let officialsCrossReference: ProcurementIndex["officialsCrossReference"];
  if (pep && pep.entries.length > 0) {
    const slugs = new Set<string>();
    const byEik = new Map<string, number>();
    for (const e of pep.entries) {
      slugs.add(e.slug);
      if (!byEik.has(e.contractorEik)) byEik.set(e.contractorEik, e.totalEur);
    }
    let totalEur = 0;
    for (const v of byEik.values()) totalEur += v;
    officialsCrossReference = {
      generatedAt: now,
      officialCount: slugs.size,
      contractorCount: byEik.size,
      pairCount: pep.entries.length,
      totalEur,
    };
  }

  const index: ProcurementIndex = {
    generatedAt: now,
    lastIngest: now,
    years,
    months,
    totals,
    periods,
    ...(crossReference ? { crossReference } : {}),
    ...(officialsCrossReference ? { officialsCrossReference } : {}),
  };

  const results = [
    byteCmp("index", index, "index.json"),
    // Derived-of-derived: re-run the JS builders over the (SQL-reproducible)
    // derived files — a determinism + non-staleness check.
    byteCmp("risk_feed", buildRiskFeed(DERIVED_DIR), "derived/risk_feed.json"),
    byteCmp(
      "concentration_full",
      buildConcentrationFull(DERIVED_DIR),
      "derived/concentration_full.json",
    ),
    byteCmp(
      "person_procurement_index",
      buildPersonIndex(DERIVED_DIR),
      "derived/person_procurement_index.json",
    ),
  ];

  if (write) {
    const stamp = new Date().toISOString();
    fs.writeFileSync(
      path.join(PROC_DIR, "index.json"),
      canonicalJson({ ...index, generatedAt: stamp, lastIngest: stamp }),
    );
    writeRiskFeed(DERIVED_DIR, buildRiskFeed(DERIVED_DIR));
    writeConcentrationFull(DERIVED_DIR, buildConcentrationFull(DERIVED_DIR));
    writePersonIndex(DERIVED_DIR, buildPersonIndex(DERIVED_DIR));
    console.log(
      "wrote index.json + risk_feed + concentration_full + person index",
    );
  }

  const clean = results.every(Boolean);
  console.log(
    clean ? "OK — reproduces on-disk index + feeds" : "DIFFERENCES FOUND",
  );
  process.exit(clean ? 0 : 1);
};

main();
