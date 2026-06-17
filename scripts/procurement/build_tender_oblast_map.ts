// Tier D (doc-internal geo): build a buyer-EIK → oblast (NUTS3) map from the
// ЦАИС ЕОП "поръчки" (tenders) open-data feed.
//
// The contracts ("договори") feed carries no buyer location, but the sibling
// tenders feed in the same storage.eop.bg daily buckets carries
// `executionPlaceNuts` (place of performance) — 100% populated, NUTS3 = oblast —
// AND `buyerRegistryNumber`, so a buyer's oblast falls straight out of it with no
// contract join and no external register. This is reachable now (storage.eop.bg
// works even when data.egov.bg blocks the МОН register).
//
// Use (see docs/plans/procurement-awarder-geo-v2.md, Tier D): the oblast is a
// REGION hint, not a settlement — it can't pin `by_settlement` on its own
// (NUTS3 ≠ EKATTE). Its value is DISAMBIGUATING the Tier-A name-parse: when an
// awarder name yields a settlement that exists in several oblasti, the buyer's
// modal oblast picks the right EKATTE and raises the confidence. awarder_geo_map
// consumes this map as the resolver's `region` hint.
//
// Two modes (mirrors ingest_eop):
//   - INCREMENTAL (default): fetch the last ~30 tender days into the cache.
//   - BACKFILL (--backfill --from 2020-01-01): the full history (one-off).
// The map is always rebuilt from ALL cached tender days, so one full backfill
// makes it complete; later incremental runs just refresh recent days.
//
// Output: data/procurement/derived/buyer_oblast_map.json
//   { generatedAt, buyers, awarders: { <eik>: { nuts, n, distinct } } }

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { canonicalEik, isValidEik } from "./eik";
import { canonicalJson } from "./validate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const OUT_FILE = path.join(PROCUREMENT_DIR, "derived", "buyer_oblast_map.json");
const CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_tenders",
);
const EOP_BASE = "https://storage.eop.bg";

interface TenderRecord {
  buyerRegistryNumber?: string;
  executionPlaceNuts?: string;
}

const tendersKey = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `Автоматично генерирани данни за поръчки, публикувани в ЦАИС ЕОП на ${d}.${m}.${y}.json`;
};
const dayUrl = (day: string): string =>
  `${EOP_BASE}/open-data-${day}/${encodeURIComponent(tendersKey(day))}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const enumerateDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// Fetch one day's tenders, caching gzipped. null = day not published (403/404).
const fetchDay = async (
  day: string,
  refresh: boolean,
): Promise<TenderRecord[] | null> => {
  const cacheFile = path.join(CACHE_DIR, `${day}.json.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return JSON.parse(
      zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8"),
    ) as TenderRecord[];
  }
  const url = dayUrl(day);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "electionsbg.com data pipeline (procurement/eop-tenders)",
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${day} → ${res.status} ${res.statusText}`);
  if (new URL(res.url || url).host !== new URL(url).host)
    throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
  const body = await res.json();
  const records: TenderRecord[] = Array.isArray(body)
    ? (body as TenderRecord[])
    : ((body?.data ?? []) as TenderRecord[]);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(records)));
  return records;
};

// NUTS3 only: a 5-char "BGxxx". The bare "BG" (national) and empties are skipped
// — they carry no oblast.
const isNuts3 = (v: string): boolean => /^BG\d{3}$/.test(v);

const main = async (args: {
  from: string;
  to: string;
  backfill: boolean;
  refreshCache: boolean;
  delayMs: number;
}): Promise<void> => {
  const days = enumerateDays(args.from, args.to);
  if (days.length > 40 && !args.backfill)
    throw new Error(
      `window is ${days.length} days — pass --backfill to confirm a large crawl`,
    );

  // 1. Fetch the window into the cache.
  let published = 0;
  let missing = 0;
  for (const day of days) {
    try {
      const recs = await fetchDay(day, args.refreshCache);
      if (recs == null) {
        missing++;
        continue;
      }
      published++;
    } catch (e) {
      console.log(`  ! ${day}: ${(e as Error).message}`);
      continue;
    }
    if (!args.refreshCache && args.delayMs > 0) await sleep(args.delayMs);
  }
  console.log(
    `→ fetched window ${args.from}…${args.to}: ${published} published / ${missing} unpublished day(s)`,
  );

  // 2. Rebuild the map from ALL cached tender days (full history, not just the
  //    window) — so one --backfill makes it complete.
  if (!fs.existsSync(CACHE_DIR)) {
    console.error("no cached tender days yet — run a --backfill first");
    process.exit(1);
  }
  const perBuyer = new Map<string, Map<string, number>>();
  let cachedDays = 0;
  let tenders = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!f.endsWith(".json.gz")) continue;
    cachedDays++;
    const recs = JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(path.join(CACHE_DIR, f)))
        .toString("utf8"),
    ) as TenderRecord[];
    for (const r of recs) {
      tenders++;
      const eik = canonicalEik(r.buyerRegistryNumber);
      const nuts = (r.executionPlaceNuts ?? "").trim();
      if (!isValidEik(eik) || !isNuts3(nuts)) continue;
      const m = perBuyer.get(eik) ?? new Map<string, number>();
      m.set(nuts, (m.get(nuts) ?? 0) + 1);
      perBuyer.set(eik, m);
    }
  }

  // Modal oblast per buyer (the place its procedures most often run in).
  const awarders: Record<
    string,
    { nuts: string; n: number; distinct: number }
  > = {};
  for (const [eik, counts] of perBuyer) {
    let best = "";
    let bestN = 0;
    let total = 0;
    for (const [nuts, n] of counts) {
      total += n;
      if (n > bestN) {
        best = nuts;
        bestN = n;
      }
    }
    awarders[eik] = { nuts: best, n: total, distinct: counts.size };
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      buyers: Object.keys(awarders).length,
      cachedDays,
      tenders,
      awarders,
    }),
  );
  console.log(
    `✓ wrote ${OUT_FILE}\n` +
      `  ${Object.keys(awarders).length} buyer(s) → modal oblast from ${tenders.toLocaleString()} tender(s) across ${cachedDays} cached day(s)`,
  );
  console.log(
    `→ now rebuild the geo map: npx tsx scripts/procurement/awarder_geo_map.ts`,
  );
};

const cli = command({
  name: "build_tender_oblast_map",
  args: {
    from: option({
      type: optional(string),
      long: "from",
      description: "First tender day (YYYY-MM-DD). Default: 30 days ago.",
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "Last tender day (YYYY-MM-DD). Default today.",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "Confirm a large (>40-day) crawl window.",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download cached days.",
      defaultValue: () => false,
    }),
    delayMs: option({
      type: optional(string),
      long: "delay-ms",
      description: "Politeness delay between live day fetches (default 150).",
    }),
  },
  handler: (args) =>
    main({
      from:
        args.from ??
        new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: args.to ?? new Date().toISOString().slice(0, 10),
      backfill: !!args.backfill,
      refreshCache: !!args.refreshCache,
      delayMs: args.delayMs ? parseInt(args.delayMs, 10) : 150,
    }),
});

run(cli, process.argv.slice(2));
