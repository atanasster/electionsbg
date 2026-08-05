// Folds the cached КФН quarterly ZIP under
// raw_data/budget/kfn/statistics_{YYYY}_q{N}.zip into data/budget/kfn/funds.json.
//
// MERGES, never overwrites — see mergeArchive.ts. The served file retains every
// quarter ever ingested, because it is the durable store: raw_data/budget/ is
// gitignored, so a series re-derived from the ZIPs on disk would be a property
// of one machine. Re-running the same quarter is a no-op.
//
//   tsx scripts/budget/kfn/__write_funds.ts [--zip <name>] [--allow-shrink]
//
// The КФН ZIP GETs cleanly from fsc.bg (Apache 200), so this ingest can be
// automated; kept as a __write_ runner for parity with the other budget ingests.
//
//   tsx scripts/budget/kfn/__write_funds.ts
//
// Served at /budget/kfn/funds.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseKfnZip, isZip, type KfnFundsArchive } from "./parse_kfn";
import {
  mergeKfnArchive,
  KfnShrinkError,
  KfnPillarGapError,
} from "./mergeArchive";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.resolve(__dirname, "../../../raw_data/budget/kfn");
const OUT_FILE = path.resolve(__dirname, "../../../data/budget/kfn/funds.json");

const main = (): void => {
  if (!fs.existsSync(RAW_DIR)) {
    console.log(`No ${RAW_DIR}. Fetch the latest КФН quarterly ZIP, e.g.:
  curl -sSL -o raw_data/budget/kfn/statistics_2025_q2.zip \\
    "https://www.fsc.bg/wp-content/uploads/2025/08/statistics_2025_q2-1.zip"`);
    process.exit(1);
  }
  // Newest ZIP by filename (statistics_YYYY_qN.zip sorts chronologically).
  // `--zip <name>` targets one explicitly, which is how a back-catalogue of
  // quarters is seeded into the archive one at a time.
  const zips = fs
    .readdirSync(RAW_DIR)
    .filter((f) => /\.zip$/i.test(f))
    .sort();
  const want = process.argv.indexOf("--zip");
  const latest = want >= 0 ? process.argv[want + 1] : zips[zips.length - 1];
  if (!latest) {
    console.log(`No .zip under ${RAW_DIR}.`);
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(path.join(RAW_DIR, latest)));
  if (!isZip(bytes)) {
    console.log(`${latest} is not a ZIP (soft-404 HTML?).`);
    process.exit(1);
  }
  const file = parseKfnZip(bytes);

  const existing: KfnFundsArchive | null = fs.existsSync(OUT_FILE)
    ? (JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as KfnFundsArchive)
    : null;
  // A file written by the pre-merge revision has `funds` at the top level and
  // no `periods`. Lift it into the archive rather than discarding it — it is
  // one real quarter and there is no other copy of it.
  const seeded: KfnFundsArchive | null =
    existing && !existing.periods
      ? {
          generatedAt: existing.generatedAt,
          source: existing.source,
          latestPeriod: (existing as unknown as { period: string }).period,
          periods: [
            {
              period: (existing as unknown as { period: string }).period,
              periodLabel: (existing as unknown as { periodLabel: string })
                .periodLabel,
              funds: (existing as unknown as { funds: typeof file.funds })
                .funds,
            },
          ],
        }
      : existing;

  let merged;
  try {
    merged = mergeKfnArchive(
      seeded,
      file,
      process.argv.includes("--allow-shrink"),
    );
  } catch (e) {
    if (e instanceof KfnShrinkError || e instanceof KfnPillarGapError) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged.archive, null, 2), "utf8");

  const byPillar = new Map<string, number>();
  for (const f of file.funds)
    byPillar.set(f.pillar, (byPillar.get(f.pillar) ?? 0) + 1);
  console.log(
    `→ ${merged.replaced ? "replaced" : "added"} ${file.periodLabel} ` +
      `(${file.period}) — ${file.funds.length} funds [${[...byPillar]
        .map(([p, n]) => `${p}:${n}`)
        .join(
          " ",
        )}]; archive now ${merged.archive.periods.length} period(s): ` +
      merged.archive.periods.map((p) => p.periodLabel).join(", "),
  );
};

main();
