// CLI entry for the KZP "Колко струва" price ingest. Postgres is the only store:
// there is no data/prices/*.json serving tree any more.
//
//   npm run prices                       daily: fetch new days, load, rebuild
//   npm run prices -- --no-build         load only, skip catalog/payloads
//   npm run prices -- --build-only       rebuild catalog + payloads from Postgres
//   npm run prices -- --backfill --from 2026-01-02 --to 2026-07-09
//                                        one-off historical replay, OLDEST FIRST
//   npm run prices -- --archive          also cold-archive raw ZIPs to GCS
//
// Backfill is a flag-gated operator step, never in the watcher/CI. raw_data/prices
// is gitignored; the durable copy is the private Coldline archive, because
// kolkostruva.bg advertises only ~14 days.
//
// See docs/plans/consumption-pg-v1.md.

import fs from "node:fs";
import path from "node:path";
import { downloadDay, listAvailableDates } from "./lib/fetch";
import { loadDay, type DayStats } from "./load_day";
import { appendDataChange } from "../lib/data-changes";
import { seedDict } from "./seed_dict";
import { rebuildCatalog } from "./rebuild_catalog";
import { buildProductDays } from "./build_product_days";
import { buildPayloads } from "./build_payloads";
import { exportSlugs } from "./export_slugs";
import { withClient, allRows, end } from "../db/lib/pg";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const RAW_DIR = path.join(ROOT, "raw_data/prices");

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

/** Days already in Postgres. The loader is idempotent; skipping is just faster. */
const loadedDays = async (): Promise<Set<string>> => {
  const rows = await allRows<{ day: string }>(
    "SELECT DISTINCT day::text AS day FROM price_grid_days",
  );
  return new Set(rows.map((r) => r.day));
};

const main = async (): Promise<void> => {
  const archive = has("--archive");
  const loaded: DayStats[] = [];

  await withClient(async (c) => {
    await c.query("BEGIN");
    await seedDict(c);
    await c.query("COMMIT");
  });

  if (!has("--build-only")) {
    const already = await loadedDays();
    let dates: string[];

    if (has("--backfill")) {
      const from = val("--from") ?? "2026-01-02";
      const to =
        val("--to") ??
        new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      dates = eachDate(from, to);
      console.log(`[prices] backfill ${from} … ${to} (${dates.length} days)`);
    } else {
      const advertised = await listAvailableDates();
      // --force keeps the latest already-loaded day so a re-published day can be
      // re-loaded on the DAILY path. Without this, the pre-filter drops it and
      // the loop's --force guard never fires (FINDING-007). load_day's step-0
      // undo makes the re-load correct.
      dates = has("--force")
        ? advertised
        : advertised.filter((d) => !already.has(d));
      if (dates.length === 0) console.log("[prices] up to date — nothing new");
    }

    // Oldest-first, always: out-of-order loading corrupts the step function and
    // leaves price_current reflecting the wrong day.
    dates.sort();

    for (const date of dates) {
      if (already.has(date) && !has("--force")) continue;
      const local = path.join(RAW_DIR, `${date}.zip`);
      // downloadDay skips the fetch when the ZIP is already on disk, but still
      // archives it (cp -n). Never bypass it when --archive is set.
      const zip =
        fs.existsSync(local) && !archive
          ? local
          : await downloadDay(date, { archive });
      if (!zip) {
        console.log(`[prices] ${date}: not published yet (404), skipping`);
        continue;
      }
      // Backfill replays known-good history; --force is a deliberate re-load.
      // Both bypass the drop floor (a real historical dip must not block them).
      const skipFloor = has("--backfill") || has("--force");
      const s = await loadDay(zip, date, { skipFloor });
      loaded.push(s);
      console.log(
        `[prices] ${s.day}: ${s.observations.toLocaleString()} rows · ` +
          `${s.settlements} settlements · ${s.chains} chains · ` +
          `+${s.factsInserted.toLocaleString()} facts, ${s.factsClosed.toLocaleString()} closed` +
          (s.unresolved ? ` · ${s.unresolved} unresolved` : "") +
          (s.legacyCodes
            ? ` · ${s.legacyCodes} legacy-code rows skipped`
            : "") +
          (s.parseErrors ? ` · ⚠ ${s.parseErrors} chain parse errors` : ""),
      );
    }
  }

  if (!has("--no-build")) {
    await rebuildCatalog();
    await buildProductDays();
    await buildPayloads();
    await exportSlugs();
  }
  await end();

  // Self-report to the public /data/updates log. Prices are PG-only, so a daily
  // run leaves `git diff --stat data/` empty (only product_slugs.json moves, and
  // rarely) — the orchestrator's generic filesystem gate would never fire. So
  // the ingest reports its own change here, based on what it actually loaded,
  // and process-watch-report skips the generic append for update-prices.
  // dedupeSameDay makes a same-day re-run (or a stray orchestrator append)
  // replace rather than duplicate. Skip on backfill (a one-off operator step).
  if (loaded.length && !has("--backfill")) {
    const last = loaded[loaded.length - 1];
    const daysWord =
      loaded.length === 1
        ? "1 daily archive"
        : `${loaded.length} daily archives`;
    appendDataChange({
      skill: "update-prices",
      summary: `КЗП retail prices refreshed through ${last.day} (+${daysWord}; ${last.observations.toLocaleString()} store rows, ${last.settlements} settlements, ${last.chains} chains)`,
      source: "КЗП Колко струва (retail prices)",
      dedupeSameDay: true,
    });
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
