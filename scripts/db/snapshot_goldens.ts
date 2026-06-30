// Writes the Tier 2 golden fixtures: canonicalized (run-stamp stripped) copies
// of the hand-picked entities into scripts/db/__golden__/procurement/, mirroring
// their relative paths. Stored pretty-printed so git diffs are readable.
//
// Re-run after an intentional, reviewed data change (e.g. the fortnightly
// procurement ingest) to refresh the baseline:
//   npm run db:goldens
//
// See docs/plans/sql-migration-v1.md (Phase 1).

import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { PROC_DIR, GOLDEN_DIR } from "./lib/paths";
import { canonicalObject } from "./lib/canonical";
import { getGoldenTargets } from "./golden_targets";

if (!existsSync(path.join(PROC_DIR, "index.json"))) {
  console.error(
    `No procurement data at ${PROC_DIR} — nothing to snapshot. ` +
      `Run the procurement ingest first.`,
  );
  process.exit(1);
}

// Rebuild from scratch so a removed target doesn't leave a stale golden behind.
rmSync(GOLDEN_DIR, { recursive: true, force: true });

const targets = getGoldenTargets();
let written = 0;
for (const rel of targets) {
  const obj = canonicalObject(path.join(PROC_DIR, rel));
  const dest = path.join(GOLDEN_DIR, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(obj, null, 2)}\n`);
  written++;
}

console.log(
  `golden fixtures → ${path.relative(process.cwd(), GOLDEN_DIR)} (${written} files)`,
);
