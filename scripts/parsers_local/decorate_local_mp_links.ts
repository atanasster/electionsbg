// Decorate every per-município local-election bundle at
// data/<cycle>/municipalities/<obshtinaCode>.json with an `mpId` field on
// each candidate row whose normalised name matches a parliament.bg MP.
//
// Why: the SPA renders mayor / council rows with `MpAvatar`, which falls
// back to a fuzzy `findMpByName` lookup at render time. That lookup misses
// silently when middle names differ between sources (CIK vs parliament.bg).
// Stamping the MP id at ingest time gives `MpAvatar` a deterministic
// `findMpById` path and keeps the photo-reuse coverage stable.
//
// Mirrors the matching strategy in scripts/officials/decorate_candidate_links.ts
// — diacritic-stripped uppercase, with a first+last fallback for cases
// where one source dropped the middle name. Photo-bearing MPs win
// collisions so the avatar surfaces a face when there is one.
//
// Covers all four candidate-bearing slots of LocalMunicipalityBundle:
//   - mayor.round1[], mayor.round2[], mayor.elected
//   - council[].candidates[]
//   - kmetstva[].candidates[]
//   - districts[].candidates[]
//
// Re-runnable: idempotent. Walks every data/<cycle>/municipalities/*.json
// for cycles matching mi / chmi / chmi_nov.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";
import type {
  LocalMunicipalityBundle,
  LocalMayorResult,
  LocalCouncilCandidate,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.join(ROOT, "data");
const PARLIAMENT_INDEX = path.join(DATA_ROOT, "parliament", "index.json");

const normalise = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[-\s]+/g, " ")
    .trim();

const firstLastKey = (s: string): string => {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normalise(s);
  return normalise(`${parts[0]} ${parts[parts.length - 1]}`);
};

type MpRow = { id: number; photoUrl?: string };

const loadParliamentIndex = (): {
  byFull: Map<string, MpRow>;
  byFirstLast: Map<string, MpRow>;
} => {
  const idx = JSON.parse(fs.readFileSync(PARLIAMENT_INDEX, "utf8")) as {
    mps: Array<{ id: number; normalizedName?: string; photoUrl?: string }>;
  };
  const byFull = new Map<string, MpRow>();
  const byFirstLast = new Map<string, MpRow>();
  for (const m of idx.mps) {
    if (!m.normalizedName) continue;
    const full = normalise(m.normalizedName);
    const fl = firstLastKey(m.normalizedName);
    const row: MpRow = { id: m.id, photoUrl: m.photoUrl };
    // Photo-bearing wins; otherwise first-wins (so the lowest-id MP keeps
    // the slot, matching the officials decorator's behaviour).
    const prevFull = byFull.get(full);
    if (!prevFull || (row.photoUrl && !prevFull.photoUrl)) {
      byFull.set(full, row);
    }
    const prevFl = byFirstLast.get(fl);
    if (!prevFl || (row.photoUrl && !prevFl.photoUrl)) {
      byFirstLast.set(fl, row);
    }
  }
  return { byFull, byFirstLast };
};

const lookupMpId = (
  name: string,
  idx: ReturnType<typeof loadParliamentIndex>,
): number | undefined => {
  if (!name) return undefined;
  const full = idx.byFull.get(normalise(name));
  if (full) return full.id;
  const fl = idx.byFirstLast.get(firstLastKey(name));
  return fl?.id;
};

type DecorationStats = {
  considered: number;
  stamped: number;
};

const stampMayor = (
  m: LocalMayorResult,
  idx: ReturnType<typeof loadParliamentIndex>,
  stats: DecorationStats,
): void => {
  stats.considered++;
  const id = lookupMpId(m.candidateName, idx);
  if (id !== undefined) {
    m.mpId = id;
    stats.stamped++;
  } else if ("mpId" in m) {
    delete m.mpId;
  }
};

const stampCouncillor = (
  c: LocalCouncilCandidate,
  idx: ReturnType<typeof loadParliamentIndex>,
  stats: DecorationStats,
): void => {
  stats.considered++;
  const id = lookupMpId(c.name, idx);
  if (id !== undefined) {
    c.mpId = id;
    stats.stamped++;
  } else if ("mpId" in c) {
    delete c.mpId;
  }
};

const decorateBundle = (
  bundle: LocalMunicipalityBundle,
  idx: ReturnType<typeof loadParliamentIndex>,
  stats: DecorationStats,
): void => {
  for (const m of bundle.mayor.round1) stampMayor(m, idx, stats);
  if (bundle.mayor.round2) {
    for (const m of bundle.mayor.round2) stampMayor(m, idx, stats);
  }
  if (bundle.mayor.elected) stampMayor(bundle.mayor.elected, idx, stats);
  for (const party of bundle.council) {
    for (const c of party.candidates) stampCouncillor(c, idx, stats);
  }
  for (const k of bundle.kmetstva) {
    for (const c of k.candidates) stampMayor(c, idx, stats);
  }
  for (const d of bundle.districts) {
    for (const c of d.candidates) stampMayor(c, idx, stats);
  }
};

const localCycleDirs = (): string[] =>
  fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /_(mi|chmi|chmi_nov)$/.test(d.name))
    .map((d) => d.name)
    .sort();

const main = (dryRun: boolean): void => {
  const idx = loadParliamentIndex();
  console.log(
    `[decorate-local] loaded parliament index: ${idx.byFull.size} MPs by full name`,
  );

  const cycles = localCycleDirs();
  const totals = { bundles: 0, considered: 0, stamped: 0 };
  for (const cycle of cycles) {
    const dir = path.join(DATA_ROOT, cycle, "municipalities");
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const stats: DecorationStats = { considered: 0, stamped: 0 };
    for (const f of files) {
      const file = path.join(dir, f);
      const bundle = JSON.parse(
        fs.readFileSync(file, "utf8"),
      ) as LocalMunicipalityBundle;
      decorateBundle(bundle, idx, stats);
      if (!dryRun) {
        fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + "\n", "utf8");
      }
    }
    totals.bundles += files.length;
    totals.considered += stats.considered;
    totals.stamped += stats.stamped;
    const pct =
      stats.considered === 0
        ? "0%"
        : `${((stats.stamped / stats.considered) * 100).toFixed(2)}%`;
    console.log(
      `[decorate-local] ${cycle}: ${files.length} bundle(s), ` +
        `${stats.stamped}/${stats.considered} candidate rows stamped (${pct})`,
    );
  }
  const pct =
    totals.considered === 0
      ? "0%"
      : `${((totals.stamped / totals.considered) * 100).toFixed(2)}%`;
  console.log(
    `[decorate-local] ${dryRun ? "dry-run " : ""}done — ` +
      `${totals.bundles} bundle(s) across ${cycles.length} cycle(s), ` +
      `${totals.stamped}/${totals.considered} stamped (${pct})`,
  );
};

const cli = command({
  name: "decorate-local-mp-links",
  description:
    "Stamp mpId on every candidate row across data/<cycle>/municipalities/<obshtinaCode>.json by matching normalised names against the parliament.bg index. Drives parliament.bg photo reuse in MpAvatar.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Count would-stamp matches without writing the bundles.",
    }),
  },
  handler: ({ dryRun }) => main(dryRun),
});

run(cli, process.argv.slice(2));
