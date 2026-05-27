// Post-processing step that emits a tile-sized sidecar JSON next to each
// per-município capital-programmes file. The full files routinely run
// 50-450KB raw (15-45KB gzipped) because they ship every itemised
// project's name + description text, but the tile only renders the
// top-5 projects + top-8 settlements + headline totals — so the sidecar
// truncates `projects[]` to top-30 by amount (still enough for the
// tile's top-5 plus growth headroom) and adds a `projectCount` field so
// the tile can show the original total count.
//
// Same shape as the full file (so existing TypeScript types still
// apply); the hook just fetches the `{muni}-tile.json` sidecar instead
// of `{muni}.json`.
//
// Run: tsx scripts/budget/capital_programs/__shrink_for_tile.ts

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../../../data/budget/capital_programs");

const TOP_PROJECTS = 30;

interface MoneyLike {
  amount?: number;
  amountEur?: number;
}
interface ProjectLike {
  id?: unknown;
  name?: unknown;
  total?: MoneyLike;
  // Burgas / Pleven use slightly different shapes — keep narrow.
  amount?: number;
  totalEur?: number;
}

const projectScore = (p: ProjectLike): number => {
  return p.total?.amount ?? p.total?.amountEur ?? p.amount ?? p.totalEur ?? 0;
};

interface CapitalFile {
  projects?: ProjectLike[];
  bySettlement?: Array<{ total?: MoneyLike }>;
  byRayon?: Array<{ total?: MoneyLike }>;
  // Pleven splits things differently — capture both.
  projectCount?: number;
  [k: string]: unknown;
}

let shrunkenCount = 0;
let untouched = 0;
let totalBytesBefore = 0;
let totalBytesAfter = 0;

const shrink = (filePath: string) => {
  const raw = readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as CapitalFile;

  const out: CapitalFile = { ...data };
  let shrunk = false;

  // Truncate projects[] to top-N by amount.
  if (Array.isArray(out.projects) && out.projects.length > TOP_PROJECTS) {
    if (out.projectCount == null) out.projectCount = out.projects.length;
    const sorted = [...out.projects].sort(
      (a, b) => projectScore(b) - projectScore(a),
    );
    out.projects = sorted.slice(0, TOP_PROJECTS);
    shrunk = true;
  } else if (Array.isArray(out.projects) && out.projectCount == null) {
    out.projectCount = out.projects.length;
  }

  // bySettlement[] / byRayon[] are NOT truncated. The Sofia tile uses
  // `byRayon.find(r => r.code === rayonCode)` to look up the specific
  // район for the current page — truncating to a top-N subset would
  // make outside-top-N rajons invisible. Per-rollup arrays are also
  // bounded by Bulgaria's geography (24 районi for Sofia, ≤134 villages
  // for the largest fleet município Gabrovo) so they stay reasonably
  // small even untruncated. The 80%+ savings come from projects[].

  const sidecarPath = filePath.replace(/\.json$/, "-tile.json");
  const serialized = JSON.stringify(out, null, 2) + "\n";
  writeFileSync(sidecarPath, serialized, "utf-8");

  const before = statSync(filePath).size;
  const after = Buffer.byteLength(serialized);
  totalBytesBefore += before;
  totalBytesAfter += after;
  const pctSaved = ((100 * (before - after)) / Math.max(before, 1)).toFixed(1);
  if (shrunk) {
    shrunkenCount++;
    console.log(
      `  ${basename(filePath).padEnd(28)} ${before.toLocaleString().padStart(8)} → ${after.toLocaleString().padStart(8)} (${pctSaved}% saved)`,
    );
  } else {
    untouched++;
  }
};

const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full);
    } else if (
      entry.endsWith(".json") &&
      !entry.endsWith("-tile.json") &&
      entry !== "index.json"
    ) {
      shrink(full);
    }
  }
};

console.log(
  "[shrink-for-tile] scanning data/budget/capital_programs/{year}/*.json",
);
walk(ROOT);
console.log("");
console.log(
  `[shrink-for-tile] shrunken ${shrunkenCount} files (already-small: ${untouched})`,
);
console.log(
  `[shrink-for-tile] total bytes: ${totalBytesBefore.toLocaleString()} → ${totalBytesAfter.toLocaleString()} (${(
    (100 * (totalBytesBefore - totalBytesAfter)) /
    Math.max(totalBytesBefore, 1)
  ).toFixed(1)}% saved across all sidecars)`,
);
