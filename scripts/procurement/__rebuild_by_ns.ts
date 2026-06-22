// One-off: regenerate the per-NS aggregates (by_ns/<date>.json + the new
// by_ns/flow/ and by_ns/people/ sidecars) from whatever is already on disk —
// reuses the current derived/mp_connected.json + derived/pep_connected.json so
// it needs no network and no companies-index/TR rebuild.
//
//   npx tsx scripts/procurement/__rebuild_by_ns.ts
//
// This is the same buildByNs call the full ingest makes; isolated here so the
// per-NS flow/people slices can be rebuilt without re-running the whole
// derived pipeline. Safe to delete — it reads/writes only data/procurement/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildByNs } from "./by_ns";
import type { MpConnectedFile } from "./types";
import type { PepConnectedFile } from "./pep_connected";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const DERIVED_DIR = path.join(PROCUREMENT_DIR, "derived");
const BY_NS_DIR = path.join(PROCUREMENT_DIR, "by_ns");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

const mpConnected = JSON.parse(
  fs.readFileSync(path.join(DERIVED_DIR, "mp_connected.json"), "utf8"),
) as MpConnectedFile;
const pepConnected = JSON.parse(
  fs.readFileSync(path.join(DERIVED_DIR, "pep_connected.json"), "utf8"),
) as PepConnectedFile;
const elections = JSON.parse(
  fs.readFileSync(ELECTIONS_INDEX, "utf8"),
) as Array<{ name: string }>;

const res = buildByNs({
  contractsDir: CONTRACTS_DIR,
  mpConnected,
  pepConnected,
  outDir: BY_NS_DIR,
  elections,
});
console.log(
  `by_ns/: ${res.files} per-election file(s) + flow/ + people/ sidecars across ${res.ranges.length} election(s)`,
);
