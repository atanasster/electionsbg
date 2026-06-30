// Tier 1 — checksum manifest comparison. Recomputes the per-category digests +
// headline totals from the live corpus and asserts they equal the committed
// baseline (data/db/procurement.manifest.json). Any byte-level drift in any
// category fails here, naming the category.
//
// Gated on DB_VERIFY=1 (via `npm run db:verify`) so the fortnightly data update
// doesn't fail the standing suite — refresh the baseline with `npm run db:manifest`.
//
// See docs/plans/sql-migration-v1.md (Phase 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROC_DIR, MANIFEST_FILE } from "../lib/paths";
import { computeManifest, type ProcurementManifest } from "../manifest";

const verify = process.env.DB_VERIFY === "1";
const haveData = existsSync(path.join(PROC_DIR, "index.json"));
const haveBaseline = existsSync(MANIFEST_FILE);

const skip = !verify
  ? "set DB_VERIFY=1 (npm run db:verify) to run manifest comparison"
  : !haveData
    ? "no procurement data on disk"
    : !haveBaseline
      ? "no committed manifest — run npm run db:manifest"
      : false;

test("live corpus matches the committed manifest", { skip }, () => {
  const baseline = JSON.parse(
    readFileSync(MANIFEST_FILE, "utf8"),
  ) as ProcurementManifest;
  const { manifest: live } = computeManifest();

  assert.deepStrictEqual(
    live.totals,
    baseline.totals,
    "headline totals drifted",
  );

  const cats = new Set([
    ...Object.keys(baseline.categories),
    ...Object.keys(live.categories),
  ]);
  const changed: string[] = [];
  for (const c of cats) {
    const b = baseline.categories[c];
    const l = live.categories[c];
    if (!b) changed.push(`${c} (new category)`);
    else if (!l) changed.push(`${c} (removed)`);
    else if (b.digest !== l.digest)
      changed.push(
        `${c} (${b.fileCount}→${l.fileCount} files, digest ${b.digest.slice(0, 8)}→${l.digest.slice(0, 8)})`,
      );
  }
  assert.equal(
    changed.length,
    0,
    `category drift: ${changed.join("; ")} — if intended, refresh with npm run db:manifest`,
  );
});
