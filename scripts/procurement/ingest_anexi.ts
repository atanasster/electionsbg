// ЦАИС ЕОП flat-feed ANNEX ("анекси") ingest — the current-value source.
//
// Why this exists. Our contract corpus stores the AT-SIGNING value (`amountEur`).
// After signing, a contract's value can change via annexes (анекси) — scope
// reductions, price increases, term extensions. ЦАИС ЕОП publishes each annex in
// a sibling flat file in the SAME daily storage.eop.bg bucket as the `договори`
// feed (see ingest_eop.ts). Each annex record carries `lastContractValue`,
// `currentContractValue` and `contractValueDifference`: the CURRENT (post-annex)
// contract value. This is exactly the "текуща стойност" SIGMA (sigma.midt.bg)
// lists by default — verified to the cent (annex currentContractValue for
// 00435-2021-0071 = €18,662,153.65 == SIGMA `currentEur`).
//
// This module ONLY fetches + caches the raw annex feed, one gzipped file per day
// under raw_data/procurement/anexi/. The enrichment pass
// (anexi_current_value.ts) reads the cache, folds each contract's annexes to its
// latest current value, and FLIPS `amountEur` to that current value on the shard
// (preserving the at-signing value in `signingAmountEur`). Splitting fetch from
// fold mirrors ingest_eop.ts + eop_field_map.ts.
//
//   tsx scripts/procurement/ingest_anexi.ts                              # incremental (~30d)
//   tsx scripts/procurement/ingest_anexi.ts --backfill --from 2020-01-01 # full history
//   tsx scripts/procurement/anexi_current_value.ts --apply               # fold onto shards
//
// Re-runnable: the daily cache file is authoritative; --refresh re-fetches. No
// downstream rebuild here (the fold script does that).

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, option, optional, string, flag, boolean } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/anexi");
const EOP_BASE = "https://storage.eop.bg";

// One raw annex record from the flat анекси feed. Only the fields the fold pass
// consumes are typed; the source carries ~30 columns (mirrors the договори feed
// plus the three value columns below).
export interface EopAnnexRecord {
  uniqueProcurementNumber?: string; // proper УНП ("00044-…") or ЦАИС "T…" id
  tenderId?: string;
  buyerRegistryNumber?: string;
  supplierRegisterNumber?: string; // ";"-joined for consortia, like договори
  contractNumber?: string;
  lotIdentifier?: string;
  contractDate?: string;
  publicationDate?: string; // annex publication — latest wins per contract
  lastContractValue?: string; // value before this annex (BG-formatted)
  currentContractValue?: string; // value after this annex ("текуща стойност")
  contractValueDifference?: string;
  contractCurrency?: string;
}

// The flat анекси object key embeds the day as DD.MM.YYYY, exactly like the
// договори key (ingest_eop.ts::dogovoriKey). Same bucket, sibling file.
const anexiKey = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `Автоматично генерирани данни за анекси, публикувани в ЦАИС ЕОП на ${d}.${m}.${y}.json`;
};

const dayUrl = (day: string): string =>
  `${EOP_BASE}/open-data-${day}/${encodeURIComponent(anexiKey(day))}`;

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

// Fetch a day's annex records, caching the raw JSON gzipped. Returns null when
// the day is not published (403/404) — the bucket is sparse. Mirrors
// ingest_eop.ts::fetchDay exactly (same host guard, same envelope handling).
const fetchDay = async (
  day: string,
  refresh: boolean,
): Promise<EopAnnexRecord[] | null> => {
  const cacheFile = path.join(CACHE_DIR, `${day}.json.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    const raw = zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
    return JSON.parse(raw) as EopAnnexRecord[];
  }
  const url = dayUrl(day);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "electionsbg.com data pipeline (procurement/anexi)",
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 404) return null; // not published
  if (!res.ok) throw new Error(`GET ${day} → ${res.status} ${res.statusText}`);
  if (new URL(res.url || url).host !== new URL(url).host)
    throw new Error(`refusing cross-host redirect for ${day}: ${res.url}`);
  const body = await res.json();
  const records: EopAnnexRecord[] = Array.isArray(body)
    ? (body as EopAnnexRecord[])
    : ((body?.data ?? body?.contracts ?? []) as EopAnnexRecord[]);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(records)));
  return records;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const main = async (opts: {
  from?: string;
  to?: string;
  backfill: boolean;
  refresh: boolean;
}): Promise<void> => {
  const to = opts.to ?? todayIso();
  const from =
    opts.from ??
    (opts.backfill
      ? "2020-01-01"
      : new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000)
          .toISOString()
          .slice(0, 10));
  const days = enumerateDays(from, to);
  console.log(
    `анекси ingest: ${from} → ${to} (${days.length} days)` +
      (opts.backfill ? " [backfill]" : " [incremental]"),
  );

  let published = 0;
  let records = 0;
  let fetched = 0;
  for (const day of days) {
    const cached =
      !opts.refresh && fs.existsSync(path.join(CACHE_DIR, `${day}.json.gz`));
    let rows: EopAnnexRecord[] | null;
    try {
      rows = await fetchDay(day, opts.refresh);
    } catch (e) {
      console.warn(`  ${day}: ${(e as Error).message}`);
      continue;
    }
    if (!cached) {
      fetched++;
      await sleep(120); // be gentle on the bucket, only on real fetches
    }
    if (rows == null) continue;
    published++;
    records += rows.length;
    if (published % 100 === 0 || (!cached && rows.length))
      console.log(`  ${day}: ${rows.length} annexes (${records} cumulative)`);
  }
  console.log(
    `\n✓ ${published} published days, ${records} annex records, ${fetched} newly fetched.`,
  );
  console.log("Next: tsx scripts/procurement/anexi_current_value.ts --apply");
};

const cli = command({
  name: "ingest_anexi",
  args: {
    from: option({
      type: optional(string),
      long: "from",
      description: "YYYY-MM-DD start",
    }),
    to: option({
      type: optional(string),
      long: "to",
      description: "YYYY-MM-DD end (default today)",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "full 2020→ history",
      defaultValue: () => false,
    }),
    refresh: flag({
      type: optional(boolean),
      long: "refresh",
      description: "re-fetch cached days",
      defaultValue: () => false,
    }),
  },
  handler: (a) =>
    main({
      from: a.from,
      to: a.to,
      backfill: !!a.backfill,
      refresh: !!a.refresh,
    }),
});

run(cli, process.argv.slice(2));
