// Decorate every per-município local-election bundle at
// data/<cycle>/municipalities/<obshtinaCode>.json with an `mpId` field on
// each candidate row whose full name matches exactly one parliament.bg MP.
//
// Why: the SPA renders mayor / council rows with `MpAvatar`, which resolves
// `findMpById(mpId) ?? findMpByName(name)`. Stamping the id at ingest time
// gives it a deterministic path; a row with no stamp falls through to the
// EXACT-name lookup and, failing that, shows initials.
//
// The matching rule lives in ./mpNameMatch.ts: exact normalised full name,
// held by one MP only. There is deliberately NO first+last fallback — it used
// to mirror the officials decorator's, and that tier attached the wrong MP's
// photo to 69% of stamped rows (a different middle name is a different father,
// i.e. a different person). See docs/plans/local-mp-photo-links-v1.md.
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
import { loadMpNameIndex, matchMp, type MpNameIndex } from "./mpNameMatch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.join(ROOT, "data");

type DecorationStats = {
  considered: number;
  stamped: number;
};

const stampMayor = (
  m: LocalMayorResult,
  idx: MpNameIndex,
  stats: DecorationStats,
): void => {
  stats.considered++;
  const id = matchMp(m.candidateName, idx)?.id;
  if (id !== undefined) {
    m.mpId = id;
    stats.stamped++;
  } else if ("mpId" in m) {
    delete m.mpId;
  }
};

const stampCouncillor = (
  c: LocalCouncilCandidate,
  idx: MpNameIndex,
  stats: DecorationStats,
): void => {
  stats.considered++;
  const id = matchMp(c.name, idx)?.id;
  if (id !== undefined) {
    c.mpId = id;
    stats.stamped++;
  } else if ("mpId" in c) {
    delete c.mpId;
  }
};

const decorateBundle = (
  bundle: LocalMunicipalityBundle,
  idx: MpNameIndex,
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
  const idx = loadMpNameIndex();
  console.log(
    `[decorate-local] loaded parliament index: ${idx.byFull.size} unique full names, ` +
      `${idx.ambiguous.size} shared by 2+ MPs (never matched)`,
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
    "Stamp mpId on every candidate row across data/<cycle>/municipalities/<obshtinaCode>.json by an exact, unique full-name match against the parliament.bg index. Drives parliament.bg photo reuse in MpAvatar.",
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
