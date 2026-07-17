// Funds PG-serving parity audit — asserts that what the /api/db funds routes
// serve from Postgres is content-identical to the on-disk data/funds/ JSON the
// ingest still writes (the PG load source). Run this BEFORE retiring the GCS
// serving of any funds shard, and after any loader / serving-fn change.
//
//   npx tsx scripts/db/gen_funds/parity.ts            # sampled (fast, default)
//   npx tsx scripts/db/gen_funds/parity.ts --full     # every shard on disk
//
// Two payload shapes are checked:
//   • fund_payloads blobs (stored verbatim) — must equal their source file
//     across every singleton + a sample of each keyed family (or all with --full).
//   • the two reconstructed detail fns (fund_contract_detail /
//     fund_beneficiary_detail) — sampled broadly since these are BUILT from
//     typed columns, so a formatting/null regression would show here first.
//
// Equality is structural (isDeepStrictEqual after JSON.parse) — key order and
// number formatting (0 vs 0.0) don't matter, only the parsed content, which is
// exactly what the SPA consumes. Exit code is non-zero on any diff.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR } from "../lib/paths";
import { allRows, end } from "../lib/pg";

const FUNDS_DIR = path.join(PROC_DIR, "..", "funds");
const PROJECTS_DIR = path.join(FUNDS_DIR, "projects");
const DERIVED_DIR = path.join(FUNDS_DIR, "derived");
const FULL = process.argv.includes("--full");
const SAMPLE = 40; // per keyed family when not --full

const readJson = (abs: string): unknown =>
  JSON.parse(fs.readFileSync(abs, "utf8"));

// Deterministic "random" sample so runs are reproducible: every Nth file.
const sample = (files: string[]): string[] => {
  if (FULL || files.length <= SAMPLE) return files;
  const step = Math.floor(files.length / SAMPLE);
  const out: string[] = [];
  for (let i = 0; i < files.length && out.length < SAMPLE; i += step)
    out.push(files[i]);
  return out;
};

let checked = 0;
let diffs = 0;
const fail = (label: string) => {
  diffs++;
  console.error(`  DIFF ${label}`);
};

const cmp = (label: string, a: unknown, b: unknown) => {
  checked++;
  if (!isDeepStrictEqual(a, b)) fail(label);
};

const payloadOf = async (kind: string, key: string): Promise<unknown> => {
  const rows = await allRows<{ payload: unknown }>(
    "SELECT payload FROM fund_payloads WHERE kind = $1 AND key = $2",
    [kind, key],
  );
  return rows[0]?.payload ?? null;
};

const auditSingleton = async (kind: string, rel: string) => {
  const abs = path.join(FUNDS_DIR, rel);
  if (!fs.existsSync(abs)) return;
  cmp(`singleton ${kind}`, await payloadOf(kind, ""), readJson(abs));
};

// Keyed blob family: sample files in `dir`, map filename → (key, source file).
const auditKeyed = async (
  kind: string,
  dir: string,
  pred: (f: string) => boolean,
  keyFn: (f: string) => string,
) => {
  if (!fs.existsSync(dir)) return;
  const files = sample(fs.readdirSync(dir).filter(pred).sort());
  for (const f of files)
    cmp(
      `${kind}/${f}`,
      await payloadOf(kind, keyFn(f)),
      readJson(path.join(dir, f)),
    );
  console.log(`  ${kind}: ${files.length} checked`);
};

const main = async () => {
  // 1. Singleton blobs.
  const singles: [string, string][] = [
    ["index", "index.json"],
    ["projects-index", "projects/index.json"],
    ["muni-map", "projects/muni-map.json"],
    ["taxonomy", "taxonomy.json"],
    ["absorption", "derived/absorption.json"],
    ["sankey", "derived/sankey.json"],
    ["integrity", "derived/integrity.json"],
    ["mp-connected", "derived/mp_connected.json"],
    ["political-links", "derived/political_links.json"],
    ["confirmed", "confirmed.json"],
    ["rrf-context", "rrf_context.json"],
    ["themes-index", "derived/themes/index.json"],
    ["by-eik-index", "derived/by-eik/index.json"],
    ["per-mp-index", "derived/per-mp/index.json"],
    ["political-by-eik-index", "derived/political-by-eik/index.json"],
  ];
  for (const [kind, rel] of singles) await auditSingleton(kind, rel);
  console.log(`  singletons: ${singles.length} checked`);

  // 2. Keyed blob families.
  const notIndex = (f: string) => f.endsWith(".json") && f !== "index.json";
  const stripJson = (f: string) => f.slice(0, -".json".length);
  const stripSummary = (f: string) => f.slice(0, -"-summary.json".length);
  const isSummary = (f: string) => f.endsWith("-summary.json");
  await auditKeyed(
    "muni-summary",
    path.join(PROJECTS_DIR, "by-muni"),
    isSummary,
    stripSummary,
  );
  await auditKeyed(
    "program-summary",
    path.join(PROJECTS_DIR, "by-program"),
    isSummary,
    stripSummary,
  );
  await auditKeyed(
    "geo",
    path.join(PROJECTS_DIR, "by-muni-geo"),
    (f) => f.endsWith(".json"),
    stripJson,
  );
  await auditKeyed(
    "integrity-program",
    path.join(DERIVED_DIR, "integrity-by-program"),
    notIndex,
    stripJson,
  );
  await auditKeyed(
    "political-by-eik",
    path.join(DERIVED_DIR, "political-by-eik"),
    notIndex,
    stripJson,
  );
  await auditKeyed(
    "by-eik",
    path.join(DERIVED_DIR, "by-eik"),
    notIndex,
    stripJson,
  );
  await auditKeyed(
    "per-mp",
    path.join(DERIVED_DIR, "per-mp"),
    notIndex,
    stripJson,
  );
  await auditKeyed(
    "theme",
    path.join(DERIVED_DIR, "themes"),
    notIndex,
    stripJson,
  );

  // 3. Reconstructed detail fns (built from typed columns).
  const contractDir = path.join(PROJECTS_DIR, "by-contract");
  if (fs.existsSync(contractDir)) {
    const files = sample(
      fs
        .readdirSync(contractDir)
        .filter((f) => f.endsWith(".json"))
        .sort(),
    );
    for (const f of files) {
      const num = stripJson(f);
      const rows = await allRows<{ r: unknown }>(
        "SELECT fund_contract_detail($1) AS r",
        [num],
      );
      cmp(
        `contract/${f}`,
        rows[0]?.r ?? null,
        readJson(path.join(contractDir, f)),
      );
    }
    console.log(`  fund_contract_detail: ${files.length} checked`);
  }

  const beneDir = path.join(FUNDS_DIR, "beneficiaries-by-eik");
  if (fs.existsSync(beneDir)) {
    const files = sample(
      fs
        .readdirSync(beneDir)
        .filter((f) => f.endsWith(".json"))
        .sort(),
    );
    for (const f of files) {
      const eik = stripJson(f);
      const rows = await allRows<{ r: unknown }>(
        "SELECT fund_beneficiary_detail($1) AS r",
        [eik],
      );
      cmp(
        `beneficiary/${f}`,
        rows[0]?.r ?? null,
        readJson(path.join(beneDir, f)),
      );
    }
    console.log(`  fund_beneficiary_detail: ${files.length} checked`);
  }

  console.log(
    `\n${diffs === 0 ? "OK" : "DIFFERENCES FOUND"} — ${checked} payloads checked, ${diffs} diff(s)${FULL ? "" : " (sampled; --full for all)"}`,
  );
  await end();
  process.exit(diffs === 0 ? 0 : 1);
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
