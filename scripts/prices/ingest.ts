// CLI entry for the KZP "Колко струва" price ingest.
//
//   tsx scripts/prices/ingest.ts                 daily: fetch newly-published
//                                                days, parse, rebuild artifacts
//   tsx scripts/prices/ingest.ts --no-build      fetch+parse only
//   tsx scripts/prices/ingest.ts --build-only    rebuild artifacts from cache
//   tsx scripts/prices/ingest.ts --backfill --from 2026-01-02 --to 2026-06-07
//                                                one-off historical pull
//   tsx scripts/prices/ingest.ts --archive       also cold-copy raw ZIPs to GCS
//
// Backfill is a flag-gated operator step (never in the watcher/CI) — it pulls
// ~25 MB/day back to euro-adoption day. See docs/plans/prices_kolkostruva_design.md.

import fs from "node:fs";
import path from "node:path";
import { downloadDay, listAvailableDates } from "./lib/fetch";
import { parseDay } from "./parse";
import { buildPriceIndex } from "./build_index";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CACHE_DIR = path.join(ROOT, "data/prices/_cache/daily");

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

const main = async (): Promise<void> => {
  const archive = has("--archive");

  if (!has("--build-only")) {
    let dates: string[];
    if (has("--backfill")) {
      const from = val("--from") ?? "2026-01-02";
      const to =
        val("--to") ??
        new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      dates = eachDate(from, to);
      console.log(`[prices] backfill ${from} … ${to} (${dates.length} days)`);
    } else {
      // Daily mode: only fetch advertised days we haven't cached yet.
      const cached = new Set(
        fs.existsSync(CACHE_DIR)
          ? fs.readdirSync(CACHE_DIR).map((f) => f.replace(/\.json$/, ""))
          : [],
      );
      dates = (await listAvailableDates()).filter((d) => !cached.has(d));
      if (dates.length === 0) console.log("[prices] up to date — nothing new");
    }

    for (const date of dates) {
      const cacheFile = path.join(CACHE_DIR, `${date}.json`);
      if (fs.existsSync(cacheFile) && !has("--force")) continue;
      try {
        const zip = await downloadDay(date, { archive });
        if (!zip) {
          console.log(`[prices] ${date}: not published yet (404), skipping`);
          continue;
        }
        await parseDay(zip, date);
      } catch (e) {
        console.error(
          `[prices] ${date}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  if (!has("--no-build")) buildPriceIndex();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
