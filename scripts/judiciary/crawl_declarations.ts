// Tier 3b — the per-FILING crawl of the ИВСС declaration register.
//
// WHAT MAKES THIS A NEW SCRIPT RATHER THAN A FLAG ON THE OLD ONE. `__write_magistrate_
// holdings.ts` is keyed per MAGISTRATE, top to bottom: it fetches one declaration per person
// (`year !== latestYear` → skip), builds its roster from `batch === "annual"` only — which
// excludes all 19,422 change filings and leaves 251 magistrates with no record at all — and
// caches under `cache[name]`. Those are three of the four structures docs/plans/
// magistrate-declaration-detail-v1.md Tier 3b says have to be lifted, and none of them can be
// lifted with a flag. This crawler is the per-filing half; the old writer keeps producing the
// per-magistrate artifact it always did, unchanged, so nothing that serves today can regress.
//
// WHY A PER-FILING CORPUS IS THE POINT. The annual declaration's Таблица 1 is a FLOW —
// property ACQUIRED during the declared period — so no single filing, and no pile of annual
// filings, answers „what does this magistrate own". Only the series does, and only where an
// ENTRY declaration anchors it. Measured over a 40-magistrate sample: 10% have such a
// snapshot, so the estate arithmetic is a per-person capability. Everything else this corpus
// enables — the property detail on /person, the disposals, the covered period — needs one
// parsed record per filing, which is what this writes.
//
// OUTPUT: raw_data/judiciary/filing_cache.json, keyed by the register's own pdf path.
// GITIGNORED and ~100-200 MB, like the holdings cache beside it. Resumable: a re-run skips
// anything already in the cache, so an interrupted crawl costs only what it had not reached.
//
// ⚠️ THIS IS AN OPERATOR RUN, NOT A PIPELINE STEP. 51,040 filings against a rate-limited
// public register on plain HTTP at a bare IP (see sources.ts) — roughly 7 hours at the
// default concurrency, which is the same 4 the index crawler in __write_declarations.ts
// already uses. Do not put it in any chain, and do not raise the concurrency to be quicker:
// the register is somebody else's server and this repo's whole relationship with it is that
// it stays polite.
//
//   npx tsx scripts/judiciary/crawl_declarations.ts [--limit N] [--conc 4] [--probe]
//
// `--probe` fetches a handful and reports, to gauge the block state before committing hours.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  declarationMeta,
  formVersion,
  formEra,
  LEGACY_UNVERSIONED,
  priceCurrency,
  isRefusal,
  readTable,
  toRows,
  type DataRow,
  type Item,
  type Row,
} from "./declarationTables";
import { IVSS_REGISTER } from "./sources";
// The repo's own checkpoint writer. writeFileSync TRUNCATES before it writes, so a kill
// inside the write window leaves invalid JSON and the next run dies in JSON.parse with no
// recovery — a 3.5-hour crawl restarting from zero, which is exactly what the resumability
// promise above exists to prevent.
import { atomicWriteJsonSync } from "../lib/atomic_write";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const pdfjs = require("pdfjs-dist") as any;
// pdfjs logs three font-substitution warnings per document — it cannot fetch the standard
// font files without a `standardFontDataUrl`, which only affects GLYPH RENDERING. This
// crawler reads the text layer and renders nothing, so the warnings are pure noise: three
// lines × 51,040 filings is ~150k lines of log for zero signal, and they bury the failures
// that do matter. ERRORS-only keeps anything real.
pdfjs.GlobalWorkerOptions.workerSrc = undefined;
const QUIET = { verbosity: 0 };

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const INDEX = path.join(ROOT, "raw_data/judiciary/declarations_index.json");
const CACHE = path.join(ROOT, "raw_data/judiciary/filing_cache.json");

/** A numeric flag, REFUSED rather than coerced when it is not a number. `--limit abc` used
 *  to become NaN, fail `Number.isFinite`, and silently start the full 51,040-filing crawl;
 *  `--conc abc` crashed later with an opaque `slices[NaN].push`. */
const arg = (flag: string, dflt: number): number => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const raw = process.argv[i + 1];
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n) || n <= 0) {
    console.error(
      `${flag} needs a positive number, got ${JSON.stringify(raw)}`,
    );
    process.exit(1);
  }
  return n;
};

/** One parsed filing. Everything here is per-DOCUMENT — the grain the old cache lacks. */
export interface FilingRecord {
  /** The register's own path, and this record's key. */
  pdf: string;
  name: string;
  /** The register's page-heading year. NOT the covered period — see `periodYear`. */
  year: number;
  /** The register directory (`annual` | `change`), NOT the declaration type. */
  registerDir: string;
  /** The form revision, or null for pre-v3.0. Decides whether the tables are readable. */
  formVersion: string | null;
  /** What the declarant ticked: annual | entry | exit | post-exit | interests | unknown. */
  kind: string;
  /** The calendar year the filing COVERS, or null where the form leaves it blank. */
  periodYear: number | null;
  /** The unit BOTH price columns are denominated in, read from the column's own header —
   *  „Цена на сделката /лева/" on v3.0, „…/евро/" on v4.0 after Bulgaria's 2026-01-01 euro
   *  changeover. NEVER derived from the version or the year: 2026 carries both forms, so the
   *  year would restate 3,483 filings' prices at 1.95583×. Null only where the document
   *  states none, in which case the tables are refused rather than stored unitless. */
  priceCurrency: "BGN" | "EUR" | null;
  /** Which of the two 12-column LAYOUTS this document uses — `legacy` (v2.x and the
   *  unversioned 2017-2020 form) or `modern` (v3.0/v4.0). The loader picks its column map
   *  from this; the two orders differ in where the MONEY and the YEAR sit, so a wrong era is
   *  a shifted row rather than a missing one. Null for a revision the parser does not map. */
  formEra: "legacy" | "modern" | null;
  /** Таблица 1 — property ACQUIRED in the period (or, on an ENTRY filing, the whole estate).
   *  A refusal reason instead of rows when the document could not be mapped. */
  table1: DataRow[] | { refused: string };
  /** Таблица 2 — property transferred away in the period. */
  table2: DataRow[] | { refused: string };
}

const pagesOf = async (bytes: Uint8Array): Promise<Row[][]> => {
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    ...QUIET,
  }).promise;
  const out: Row[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items: Item[] = tc.items
      .filter((i: any) => typeof i.str === "string" && i.str.trim())
      .map((i: any) => ({
        s: i.str.replace(/\s+/g, " ").trim(),
        x: i.transform[4],
        y: i.transform[5],
      }));
    out.push(toRows(items));
  }
  return out;
};

const readOne = (
  pages: Row[][],
  caption: RegExp,
  columns: number,
): DataRow[] | { refused: string } => {
  const t = readTable(pages, caption, columns);
  return isRefusal(t) ? { refused: t.kind } : t.rows;
};

const parse = (
  e: { pdf: string; name: string; year: number; batch: string },
  pages: Row[][],
): FilingRecord => {
  const meta = declarationMeta(pages[1] ?? []);
  return {
    pdf: e.pdf,
    name: e.name,
    year: e.year,
    registerDir: e.batch,
    formVersion: formVersion(pages),
    priceCurrency: priceCurrency(pages),
    formEra: formEra(formVersion(pages) ?? LEGACY_UNVERSIONED),
    kind: meta.kind,
    periodYear: meta.periodYear,
    table1: readOne(pages, /Право на собственост и ограничени вещни права/, 12),
    table2: readOne(pages, /Прехвърляне на имоти през предходната година/, 10),
  };
};

/** A string flag's value, or null. Mirrors `arg` above, which is numeric-only. */
const strArg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const raw = process.argv[i + 1];
  if (!raw || raw.startsWith("--"))
    throw new Error(`${flag} needs a value, e.g. ${flag} 4.0`);
  return raw;
};

const main = async (): Promise<void> => {
  const limit = arg("--limit", Infinity);
  const conc = Math.max(1, Math.min(6, arg("--conc", 4)));
  const probe = process.argv.includes("--probe");

  const index: Array<{
    year: number;
    name: string;
    pdf: string;
    batch: string;
  }> = JSON.parse(fs.readFileSync(INDEX, "utf8"));

  const cache: Record<string, FilingRecord> = fs.existsSync(CACHE)
    ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
    : {};
  const before = Object.keys(cache).length;

  // ALL filings — every year, BOTH directories. That is the whole difference from the old
  // roster, which took one annual per magistrate.
  //
  // `--reparse <version>` re-fetches ONLY the filings a previous run refused as that form
  // version, so newly mapping a form costs its own filings rather than the whole 51,040-PDF
  // register (~3.5 h against ~1 min for v4.0's 201). The refusal the cache already stores
  // names the version it saw, so the set needs no network and no database to compute.
  //
  // ⚠️ It re-fetches rather than re-reading, because the cache stores the PARSE and not the
  // document — there is no stored text to re-run a new map over.
  // `--backfill-currency` re-reads every filing that HAS rows but no recorded price unit —
  // i.e. anything parsed before the euro reissue was mapped. It is deliberately not a
  // version rule: inferring „v3.0 means лева" is the exact shortcut priceCurrency() exists to
  // refuse, and it would bake an assumption into 11,584 stored prices. Refused filings are
  // skipped because they store no price to attach a unit to.
  const backfillCurrency = process.argv.includes("--backfill-currency");
  const reparse = strArg("--reparse");
  let todo = index.filter((e) => !cache[e.pdf]);
  if (backfillCurrency) {
    const wanted = index.filter((e) => {
      const r = cache[e.pdf];
      if (!r || r.priceCurrency) return false;
      return Array.isArray(r.table1) || Array.isArray(r.table2);
    });
    console.log(
      `--backfill-currency: ${wanted.length} filing(s) hold rows with no recorded price unit`,
    );
    todo = wanted;
  } else if (reparse) {
    const wanted = index.filter((e) => {
      const r = cache[e.pdf];
      if (!r) return false;
      const t1 = r.table1 as { refused?: string };
      if (Array.isArray(r.table1) || typeof t1.refused !== "string")
        return false;
      // `--reparse legacy` covers all four pre-v3.0 buckets at once — v2.0, v2.1, v2.2 and
      // the unversioned 2017-2020 form, which share one column layout. Naming versions one
      // at a time would mean four crawls over the same refused population.
      if (reparse === "legacy")
        return formEra(r.formVersion ?? LEGACY_UNVERSIONED) === "legacy";
      return r.formVersion === reparse;
    });
    console.log(
      `--reparse ${reparse}: ${wanted.length} previously-refused filing(s) to re-read`,
    );
    todo = wanted;
  }
  if (probe) todo = todo.slice(0, 8);
  else if (Number.isFinite(limit)) todo = todo.slice(0, limit);

  console.log(
    `${index.length} filing(s) in the register · ${before} already cached · ` +
      `${todo.length} to fetch, concurrency ${conc}` +
      (probe ? "  [PROBE]" : ""),
  );
  if (!todo.length) {
    console.log("nothing to do.");
    return;
  }
  const started = Date.now();

  let done = 0;
  let failed = 0;
  /** Failures by MESSAGE, so a wall of 403s is one loud line rather than a counter. Keeping
   *  only the first N samples hid exactly that: a register that starts refusing at hour two
   *  contributes nothing to a first-40 list while inflating the total. */
  const failureKinds = new Map<string, number>();
  const recentFailures: string[] = [];
  /** Consecutive failures across all workers. A crawl that has stopped working should stop
   *  ASKING — otherwise the politeness delay becomes the whole cycle (a 403 returns in ~20 ms
   *  against a ~1.2 s success) and four workers hammer a bare-IP host at ~30 req/s for hours. */
  let consecutiveFailures = 0;
  let aborted = false;
  const ABORT_AFTER = 50;

  // Save periodically so an interrupted run keeps what it has. Written via tmp+rename, so a
  // kill during the write leaves the PREVIOUS checkpoint intact rather than a truncated file
  // that the next run cannot parse. Measured ~529 B/record, i.e. ~27 MB for the full corpus.
  const save = (): void => atomicWriteJsonSync(CACHE, cache);

  const worker = async (slice: typeof todo): Promise<void> => {
    for (const e of slice) {
      try {
        const res = await fetch(new URL(e.pdf, IVSS_REGISTER).href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pages = await pagesOf(new Uint8Array(await res.arrayBuffer()));
        cache[e.pdf] = parse(e, pages);
        consecutiveFailures = 0;
      } catch (err) {
        failed++;
        consecutiveFailures++;
        const msg = (err as Error).message;
        failureKinds.set(msg, (failureKinds.get(msg) ?? 0) + 1);
        recentFailures.push(`${e.pdf}: ${msg}`);
        if (recentFailures.length > 20) recentFailures.shift();
        if (consecutiveFailures >= ABORT_AFTER && !aborted) {
          aborted = true;
          console.error(
            `\n⛔ ${ABORT_AFTER} consecutive failures — stopping rather than hammering the ` +
              `register. Last: ${msg}\nRe-run to resume; ${Object.keys(cache).length} ` +
              `filing(s) are already cached.`,
          );
        }
      }
      if (aborted) return;
      done++;
      if (done % 250 === 0) {
        save();
        const rate = done / ((Date.now() - started) / 1000);
        const left = (todo.length - done) / Math.max(rate, 0.01);
        console.log(
          `  ${done}/${todo.length} · ${failed} failed · ${rate.toFixed(1)}/s · ` +
            `~${(left / 60).toFixed(0)} min left`,
        );
      }
      // Politeness, per worker. With conc=4 that is ~4 requests per 120 ms window.
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  // Round-robin rather than contiguous blocks so every worker spans the whole corpus: a
  // block-per-worker split would have one worker on 2017 and another on 2026, and a
  // year-shaped failure would look like a dead worker.
  const slices: (typeof todo)[] = Array.from({ length: conc }, () => []);
  todo.forEach((e, i) => slices[i % conc].push(e));
  await Promise.all(slices.map(worker));
  // --probe is the cheap safety check before committing hours; rewriting the whole cache to
  // record 8 rows would make it perform the one risky operation it exists to de-risk.
  if (!probe) save();

  const secs = (Date.now() - started) / 1000;
  const now = Object.keys(cache).length;
  console.log(
    `\ncached ${now} filing(s) (+${now - before}), ${failed} failed, ` +
      `${(secs / 60).toFixed(1)} min`,
  );
  if (failed) {
    // BY KIND first — that is what separates "a few malformed PDFs" from "the register went
    // away at hour two", which a bare count and a first-N sample cannot.
    console.log(`\nfailures by kind:`);
    for (const [k, v] of [...failureKinds]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12))
      console.log(`  ${String(v).padStart(6)} × ${k}`);
    console.log(`\nmost recent:`);
    for (const f of recentFailures) console.log(`  ${f}`);
    process.exitCode = 1;
  }

  // A quick read of what was actually obtained, so a run reports its own usefulness rather
  // than only its size.
  const rows = Object.values(cache);
  const kinds = new Map<string, number>();
  let v30 = 0;
  let t1Rows = 0;
  let t1Refused = 0;
  for (const r of rows) {
    kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    if (r.formVersion === "3.0") v30++;
    if (Array.isArray(r.table1)) t1Rows += r.table1.length;
    else t1Refused++;
  }
  console.log(`\nof ${rows.length} cached filings:`);
  console.log(
    `  v3.0 form (tables readable): ${v30} (${((100 * v30) / rows.length).toFixed(1)}%)`,
  );
  console.log(`  Таблица 1 rows read: ${t1Rows}; refused: ${t1Refused}`);
  console.log(
    `  kinds: ${[...kinds]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
