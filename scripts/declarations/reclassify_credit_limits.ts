/**
 * One-off repair: move already-parsed `debt` rows that are credit LIMITS into the
 * `credit_limit` category, in place, without re-fetching anything.
 *
 * WHY IN PLACE RATHER THAN A RE-PARSE. The classifier (`creditLimitRow`) ships with the
 * parser, so a re-parse would apply it — but the officials ingest is per-year and
 * `mergeDeclarations` REPLACES the target year's rows with whatever the run produced. For
 * 2018 the register now 404s 514 of its own listed declarations, so re-running that year
 * would delete them: the ingest's own `--max-missing` guard refuses for exactly this reason,
 * and overriding it to fix a classification would trade 514 filings for 556 relabelled rows.
 * This pass reads and rewrites the parsed JSON only, so an unreachable filing is untouched.
 *
 * WHY IT EXISTS AT ALL. A declared credit-card LIMIT is an available line, not money owed.
 * Subtracting it from net worth asserts a debt nobody declared — for Илияна Йотова it was
 * 100% of her liabilities, publishing a net worth 8% below her filing. New filings are
 * classified at parse time; this is the history that predates that.
 *
 * Idempotent, and dry-run by default:
 *
 *   npx tsx scripts/declarations/reclassify_credit_limits.ts            # report only
 *   npx tsx scripts/declarations/reclassify_credit_limits.ts --apply    # rewrite
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { creditLimitRow } from "./parse_declaration";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Every tree holding parsed declaration JSON, each an array of filings per person. */
const TREES = [
  "data/parliament/declarations",
  "data/officials/declarations",
  "data/officials/municipal/declarations",
];

type Asset = { category?: string; description?: string | null };
type Filing = { assets?: Asset[]; sourceUrl?: string };

const apply = process.argv.includes("--apply");

let filesSeen = 0;
let filesChanged = 0;
let rowsMoved = 0;
const perYear = new Map<string, number>();

for (const tree of TREES) {
  const dir = path.join(ROOT, tree);
  if (!fs.existsSync(dir)) {
    console.warn(`[reclassify] ${tree} not found — skipping`);
    continue;
  }
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dir, file);
    let filings: Filing[];
    try {
      filings = JSON.parse(fs.readFileSync(full, "utf-8")) as Filing[];
    } catch {
      console.warn(`[reclassify] unreadable ${tree}/${file} — skipping`);
      continue;
    }
    if (!Array.isArray(filings)) continue;
    filesSeen++;
    let touched = false;
    for (const filing of filings) {
      // The register folder, for reporting only — the rule itself is year-agnostic.
      const year = /register\.cacbg\.bg\/([0-9a-z_]+)\//.exec(
        filing.sourceUrl ?? "",
      )?.[1];
      for (const asset of filing.assets ?? []) {
        if (asset.category !== "debt") continue;
        if (!creditLimitRow(asset.description ?? null)) continue;
        asset.category = "credit_limit";
        touched = true;
        rowsMoved++;
        if (year) perYear.set(year, (perYear.get(year) ?? 0) + 1);
      }
    }
    if (!touched) continue;
    filesChanged++;
    // Match the ingest's own formatting so the diff is the reclassification and nothing else.
    if (apply)
      fs.writeFileSync(full, JSON.stringify(filings, null, 2) + "\n", "utf-8");
  }
}

console.log(
  `[reclassify] ${filesSeen} file(s) scanned, ${filesChanged} would change, ` +
    `${rowsMoved} row(s) debt → credit_limit`,
);
for (const [year, n] of [...perYear].sort()) console.log(`   ${year}: ${n}`);
if (!apply) console.log("[reclassify] dry run — pass --apply to write");
