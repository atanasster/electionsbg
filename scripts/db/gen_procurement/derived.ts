// Phase 2c — generate the derived/ analytics FROM SQL and verify they reproduce
// the on-disk JSON. All flow from the SQL-built rollups (buildRollupsFromRows),
// plus the existing cross-reference outputs (mp_connected / pep_connected) which
// the JS builders also consume as inputs.
//
//   npm run db:gen-derived            # verify only (default)
//   npm run db:gen-derived -- --write # also write the files
//
// cpv_competition / top_contractors / awarder_concentration are deterministic
// (a final sort washes out read order) → byte-identical. flow / flow_full order
// their nodes+links by the awarder readdir walk (FS-dependent, non-deterministic
// even for the JS builder) → verified content-equal (same node set + link
// multiset), not byte-identical.
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
  buildTopContractorsFrom,
  buildAwarderConcentrationFrom,
  buildFlowFrom,
  trimFlow,
} from "../../procurement/derived";
import { buildCpvCompetitionFromRows } from "../../procurement/cpv_competition";
import {
  rowSort,
  canonicalJson,
  assertFlowIntegrity,
} from "../../procurement/validate";
import type {
  AwarderRollup,
  Contract,
  ContractorRollup,
  FlowFile,
  MpConnectedFile,
} from "../../procurement/types";
import type { PepConnectedFile } from "../../procurement/pep_connected";

const derivedDir = path.join(PROC_DIR, "derived");

const readJson = <T>(rel: string, fallback: T): T => {
  const p = path.join(PROC_DIR, rel);
  return fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf8")) as T)
    : fallback;
};

const norm = (v: unknown): unknown =>
  stripVolatile(JSON.parse(canonicalJson(v)));

// Byte-level compare (run-stamps stripped).
const byteCmp = (label: string, gen: unknown, rel: string): string => {
  const live = path.join(PROC_DIR, rel);
  if (!fs.existsSync(live)) return `${label}: no live file`;
  const l = stripVolatile(JSON.parse(fs.readFileSync(live, "utf8")));
  return isDeepStrictEqual(norm(gen), l) ? `${label}: OK` : `${label}: DIFF`;
};

// Content-equal compare for the sankey flow (order-normalized).
const flowNorm = (f: FlowFile): unknown => {
  const s = norm(f) as FlowFile;
  return {
    nodes: [...s.nodes].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    links: [...s.links].sort(
      (a, b) =>
        `${a.source}>${a.target}`.localeCompare(`${b.source}>${b.target}`) ||
        a.valueEur - b.valueEur,
    ),
  };
};
const flowCmp = (label: string, gen: FlowFile, rel: string): string => {
  const live = path.join(PROC_DIR, rel);
  if (!fs.existsSync(live)) return `${label}: no live file`;
  const l = JSON.parse(fs.readFileSync(live, "utf8")) as FlowFile;
  return isDeepStrictEqual(flowNorm(gen), flowNorm(l))
    ? `${label}: OK (content)`
    : `${label}: DIFF`;
};

interface TopFile {
  total: number;
  entries: Array<{ eik: string }>;
}

// top_contractors is a ranked top-1000. The on-disk file predates amendment
// exclusion, so it still contains amendment-only contractors (some of which
// crack the top 1000, displacing real ones). We accept those as the known stale
// artifact: green iff shared entries are identical and every added/dropped eik
// is explained by the amendment-only set.
const topCmp = (
  gen: TopFile,
  rel: string,
  amendmentOnly: Set<string>,
): string => {
  const live = path.join(PROC_DIR, rel);
  if (!fs.existsSync(live)) return "top_contractors: no live file";
  const g = norm(gen) as TopFile;
  const l = stripVolatile(JSON.parse(fs.readFileSync(live, "utf8"))) as TopFile;
  const gm = new Map(g.entries.map((e) => [e.eik, e]));
  const lm = new Map(l.entries.map((e) => [e.eik, e]));
  for (const [eik, ge] of gm) {
    const le = lm.get(eik);
    if (le && !isDeepStrictEqual(ge, le))
      return `top_contractors: DIFF (field diff at ${eik})`;
  }
  const badLive = [...lm.keys()].filter(
    (k) => !gm.has(k) && !amendmentOnly.has(k),
  );
  const badGen = [...gm.keys()].filter(
    (k) => !lm.has(k) && amendmentOnly.has(k),
  );
  const stale = [...lm.keys()].filter((k) => !gm.has(k)).length;
  if (badLive.length === 0 && badGen.length === 0)
    return `top_contractors: OK (current code; on-disk has ${stale} stale amendment-only)`;
  return `top_contractors: DIFF (unexpected live+${badLive.slice(0, 5)} gen+${badGen.slice(0, 5)})`;
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

  const { contractors, awarders } = buildRollupsFromRows(rows, PROC_DIR);
  // The JS derived builders read the SERIALIZED (cents-rounded) rollup files, so
  // to match on-disk byte-for-byte we feed them rollups round-tripped through
  // canonicalJson — otherwise sharePct = full/full diverges from rounded/rounded
  // in the 6th decimal, and copied *Eur values would differ by a cent.
  const contractorsR = JSON.parse(
    canonicalJson(contractors),
  ) as ContractorRollup[];
  const awardersR = JSON.parse(canonicalJson(awarders)) as AwarderRollup[];

  const mpConnected = readJson<MpConnectedFile>("derived/mp_connected.json", {
    generatedAt: "",
    total: 0,
    entries: [],
  });
  const pepConnected = readJson<PepConnectedFile>(
    "derived/pep_connected.json",
    {
      generatedAt: "",
      total: 0,
      officialCount: 0,
      entries: [],
    },
  );

  // Amendment-only contractors (in amendment rows but no contract-tag row) —
  // current code writes no rollup for them; the on-disk derived files predate
  // that and still include them. Used to characterize the top_contractors diff.
  const contractTagEik = new Set<string>();
  const amendEik = new Set<string>();
  for (const r of rows) {
    if (r.contractorEik === "") continue;
    if (r.tag === "contractAmendment") amendEik.add(r.contractorEik);
    else contractTagEik.add(r.contractorEik);
  }
  const amendmentOnly = new Set(
    [...amendEik].filter((e) => !contractTagEik.has(e)),
  );

  const cpv = buildCpvCompetitionFromRows(rows);
  const top = buildTopContractorsFrom(contractorsR, mpConnected);
  const conc = buildAwarderConcentrationFrom(awardersR);
  const flow = buildFlowFrom(awardersR, mpConnected, pepConnected);
  const preview = trimFlow(flow);

  const results = [
    byteCmp("cpv_competition", cpv, "derived/cpv_competition.json"),
    topCmp(top, "derived/top_contractors.json", amendmentOnly),
    byteCmp(
      "awarder_concentration",
      conc,
      "derived/awarder_concentration.json",
    ),
    flowCmp("flow_full", flow, "derived/flow_full.json"),
    flowCmp("flow (preview)", preview, "derived/flow.json"),
  ];
  results.forEach((r) => console.log(r));

  if (write) {
    fs.mkdirSync(derivedDir, { recursive: true });
    assertFlowIntegrity(flow, "flow_full.json");
    assertFlowIntegrity(preview, "flow.json (preview)");
    const w = (name: string, obj: unknown) =>
      fs.writeFileSync(path.join(derivedDir, name), canonicalJson(obj));
    w("cpv_competition.json", cpv);
    w("top_contractors.json", top);
    w("awarder_concentration.json", conc);
    w("flow_full.json", flow);
    w("flow.json", preview);
    console.log(
      "wrote derived/{cpv_competition,top_contractors,awarder_concentration,flow_full,flow}.json",
    );
  }

  const clean = results.every((r) => r.includes("OK"));
  console.log(
    clean ? "OK — reproduces on-disk derived files" : "DIFFERENCES FOUND",
  );
  process.exit(clean ? 0 : 1);
};

main();
