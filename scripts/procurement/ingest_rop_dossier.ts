// Pre-ЦАИС РОП per-procedure DOSSIER scraper — recovers the REAL CPV code that
// the legacy annual CSVs and the awards register both omit.
//
// Why this exists. Pre-2020 CPV coverage in the contracts corpus is very sparse
// (2011–2017 ≈ 5–9%, 2018 ≈ 9%, 2019 ≈ 12%) because neither feed the site
// ingests carries a CPV column for those years: the legacy annual CSVs
// (legacy_csv.ts) have no CPV field at all, and the ЦАИС ЕОП flat feed
// (eop_field_map.ts) starts in 2020. The only place the granular CPV survives is
// the ОБЯВЛЕНИЕ (contract notice) document inside each procedure's РОП dossier.
//
// The dossier IS still live on www.aop.bg, at:
//     https://www.aop.bg/case2.php?mode=show_doc&doc_id=<ID на документа>&newver=2
// (windows-1251). The `ID на документа` that keys it is the SAME id the legacy
// CSV carried — legacy_csv.ts embeds it in every row's ocid as
// `aop-legacy-<year>-<docId>`, so we recover it from the corpus with no re-parse.
// The notice's «Код съгласно … речник (CPV) NNNNNNNN» is the procedure's main
// object CPV; verified 30/30 УНП-exact and ~97% CPV-bearing on a 2015/16 sample
// (the misses are below-threshold обяви whose real document lives in the separate
// 9-digit register, not here — those stay for the textbook heuristic).
//
//   # default: scrape every distinct pre-2020 legacy docId that still lacks a CPV
//   tsx scripts/procurement/ingest_rop_dossier.ts --backfill
//   tsx scripts/procurement/ingest_rop_dossier.ts --backfill --limit 200   # smoke test
//   # id-range mode (УНП→docId gap-fill, e.g. the 2018 rop rows): self-keys by the
//   # УНП read out of each fetched notice.
//   tsx scripts/procurement/ingest_rop_dossier.ts --backfill --from-id 830000 --to-id 870000
//
// Output: raw_data/procurement/rop_dossier/_cpv_map.json = { [docId]: {unp,cpv} }.
// The map is MERGED across runs and the per-doc HTML is gzip-cached, so a crawl is
// fully resumable — a re-run only fetches docs it hasn't seen. eop_field_map.ts
// reads this map to fill Contract.cpv (see its dossier pass), then rebuild.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/rop_dossier",
);
const MAP_FILE = path.join(CACHE_DIR, "_cpv_map.json");

const DOC_URL = "https://www.aop.bg/case2.php";

// One recovered dossier fact: the notice's procedure УНП and main CPV. `cpv` is
// null for a doc that resolved but carried no CPV (a below-threshold обява stub),
// so a resume never re-fetches it.
interface DossierFact {
  unp: string | null;
  cpv: string | null;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// The docId is the trailing numeric token of a legacy ocid. The year segment can
// itself contain a dash (`aop-legacy-2011-2015-693699`), so match the tail, not a
// fixed field position.
const docIdFromOcid = (ocid: string): string | undefined =>
  ocid.startsWith("aop-legacy-")
    ? (ocid.match(/-(\d+)$/)?.[1] ?? undefined)
    : undefined;

const UNP_RE = /\d{5}-\d{4}-\d{4,}/;
// The notice labels the CPV variously: «Общ терминологичен речник (CPV)» on
// newer forms, «Класификатора на ОП (CPV)» on older ones — the `(CPV)<code>`
// anchor is common to both. The FIRST such code is the main object CPV (the
// summary/Раздел II.1 field); additional/per-lot codes follow.
const CPV_RE = /\(\s*CPV\s*\)\s*[:\-]?\s*(\d{8})/i;

// ---- read the docIds to scrape from the on-disk corpus -----------------------

// Collect every distinct pre-2020 legacy docId that still has ≥1 CPV-less
// contract row, paired with that procedure's УНП (for the exact-match check).
const collectLegacyDocIds = (): Map<string, string | null> => {
  const out = new Map<string, string | null>();
  if (!fs.existsSync(CONTRACTS_DIR)) return out;
  for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
    if (!/^\d{4}$/.test(year) || year >= "2020") continue;
    const dir = path.join(CONTRACTS_DIR, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(f)) continue;
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const docId = docIdFromOcid(r.ocid);
        if (!docId) continue;
        if (r.cpv && r.cpv.trim()) continue; // already has a CPV — skip
        // Prefer to remember the УНП; keep the first non-empty one seen.
        if (!out.has(docId)) out.set(docId, r.unp ?? null);
        else if (!out.get(docId) && r.unp) out.set(docId, r.unp);
      }
    }
  }
  return out;
};

// ---- fetch + parse -----------------------------------------------------------

const docUrl = (docId: string): string =>
  `${DOC_URL}?mode=show_doc&doc_id=${docId}&newver=2`;

// Fetch one dossier document (windows-1251), caching it gzipped. Retries on
// timeout / 5xx / network error — the register is frequently slow.
const fetchDoc = async (docId: string, refresh: boolean): Promise<string> => {
  const cacheFile = path.join(CACHE_DIR, `${docId}.html.gz`);
  if (!refresh && fs.existsSync(cacheFile)) {
    return zlib.gunzipSync(fs.readFileSync(cacheFile)).toString("utf8");
  }
  const url = docUrl(docId);
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "electionsbg.com data pipeline (procurement/rop_dossier)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`GET doc ${docId} → ${res.status}`);
      // Same-host guard: never follow a redirect off aop.bg.
      if (new URL(res.url || url).host !== new URL(url).host) {
        throw new Error(`refusing cross-host redirect for ${docId}: ${res.url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const html = new TextDecoder("windows-1251").decode(buf);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, zlib.gzipSync(Buffer.from(html, "utf8")));
      return html;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < 4) await sleep(attempt * 2_000);
    }
  }
  throw lastErr ?? new Error(`GET doc ${docId} failed`);
};

const parseDoc = (html: string): DossierFact => {
  // Strip tags to plain text; the notice is a table of labelled cells.
  const txt = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const unp = txt.match(UNP_RE)?.[0] ?? null;
  const cpv = txt.match(CPV_RE)?.[1] ?? null;
  return { unp, cpv };
};

// ---- resumable map I/O -------------------------------------------------------

const loadMap = (): Record<string, DossierFact> => {
  if (!fs.existsSync(MAP_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) as Record<
      string,
      DossierFact
    >;
  } catch {
    return {};
  }
};

const saveMap = (map: Record<string, DossierFact>): void => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Deterministic key order so the (gitignored) map diffs cleanly if inspected.
  const sorted: Record<string, DossierFact> = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  fs.writeFileSync(MAP_FILE, JSON.stringify(sorted, null, 0));
};

// Run `worker` over `items` with at most `concurrency` in flight.
const runPool = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          await worker(items[i], i);
        } catch {
          /* worker logs its own failure; keep the pool going */
        }
      }
    },
  );
  await Promise.all(runners);
};

const main = async (args: {
  backfill: boolean;
  fromId?: number;
  toId?: number;
  limit?: number;
  concurrency: number;
  refreshCache: boolean;
}): Promise<void> => {
  // Build the work-list of docIds, with the expected УНП where the corpus knows
  // it (null in id-range mode, where we self-key from each fetched notice).
  let work: Array<{ docId: string; expectUnp: string | null }> = [];
  if (args.fromId != null && args.toId != null) {
    if (args.toId < args.fromId) throw new Error("--to-id < --from-id");
    if (args.toId - args.fromId > 200_000)
      throw new Error(
        `id range is ${args.toId - args.fromId} wide — split it (safety cap 200k)`,
      );
    for (let id = args.fromId; id <= args.toId; id++)
      work.push({ docId: String(id), expectUnp: null });
    console.log(
      `→ id-range mode: docIds ${args.fromId}…${args.toId} (${work.length})`,
    );
  } else {
    const docIds = collectLegacyDocIds();
    work = [...docIds].map(([docId, expectUnp]) => ({ docId, expectUnp }));
    console.log(
      `→ corpus mode: ${work.length.toLocaleString()} distinct pre-2020 legacy ` +
        `docId(s) with a CPV-less row`,
    );
  }

  if (!args.backfill && work.length > 200)
    throw new Error(
      `${work.length} docId(s) to scrape — pass --backfill to confirm a large crawl`,
    );

  const map = loadMap();
  // Skip docIds already resolved in a prior run (cache-hits are cheap, but this
  // avoids re-parsing tens of thousands of cached files on every resume).
  const before = work.length;
  work = work.filter((w) => !(w.docId in map) || args.refreshCache);
  if (args.limit != null) work = work.slice(0, args.limit);
  console.log(
    `→ ${work.length.toLocaleString()} to fetch ` +
      `(${(before - work.length).toLocaleString()} already in map)`,
  );

  const agg = {
    fetched: 0,
    withCpv: 0,
    noCpv: 0,
    unpMismatch: 0,
    failed: 0,
  };
  let done = 0;
  let sinceSave = 0;

  await runPool(work, args.concurrency, async ({ docId, expectUnp }) => {
    let html: string;
    try {
      html = await fetchDoc(docId, args.refreshCache);
    } catch {
      agg.failed++;
      return;
    }
    const fact = parseDoc(html);
    agg.fetched++;
    if (fact.cpv) agg.withCpv++;
    else agg.noCpv++;
    // Integrity guard: in corpus mode the notice's own УНП must equal the УНП the
    // corpus attached to this docId. A mismatch means the id space drifted — drop
    // the CPV (don't graft a wrong sector) and count it.
    if (expectUnp && fact.unp && fact.unp !== expectUnp) {
      agg.unpMismatch++;
      map[docId] = { unp: fact.unp, cpv: null };
    } else {
      map[docId] = fact;
    }
    done++;
    if (++sinceSave >= 500) {
      saveMap(map);
      sinceSave = 0;
    }
    if (done % 250 === 0 || done === work.length)
      console.log(
        `  …${done}/${work.length} — cpv ${agg.withCpv}, no-cpv ${agg.noCpv}, ` +
          `mismatch ${agg.unpMismatch}, fail ${agg.failed}`,
      );
  });

  saveMap(map);
  const total = Object.keys(map).length;
  const withCpv = Object.values(map).filter((f) => f.cpv).length;
  console.log(
    `→ this run: fetched ${agg.fetched.toLocaleString()}, ` +
      `CPV ${agg.withCpv.toLocaleString()}, no-CPV ${agg.noCpv.toLocaleString()}, ` +
      `УНП-mismatch ${agg.unpMismatch.toLocaleString()}, failed ${agg.failed.toLocaleString()}`,
  );
  console.log(
    `→ map now holds ${total.toLocaleString()} docId(s), ` +
      `${withCpv.toLocaleString()} with a CPV → ${MAP_FILE}`,
  );
  if (agg.failed > 0)
    console.log(
      `  ⚠ ${agg.failed} doc(s) failed after retries — re-run (cache makes it cheap) to finish`,
    );
  console.log(
    `✓ done. Enrich + rebuild:\n` +
      `    npx tsx scripts/procurement/eop_field_map.ts --apply\n` +
      `    npx tsx scripts/procurement/rebuild_from_cache.ts`,
  );
};

const cli = command({
  name: "ingest_rop_dossier",
  args: {
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description: "Confirm a large (>200-doc) crawl.",
      defaultValue: () => false,
    }),
    fromId: option({
      type: optional(string),
      long: "from-id",
      description: "id-range mode: first doc_id (self-keys by each notice's УНП).",
    }),
    toId: option({
      type: optional(string),
      long: "to-id",
      description: "id-range mode: last doc_id.",
    }),
    limit: option({
      type: optional(string),
      long: "limit",
      description: "Cap the number of docs fetched this run (smoke test).",
    }),
    concurrency: option({
      type: optional(string),
      long: "concurrency",
      description: "Docs fetched in parallel (default 6). The register is slow.",
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download docs even when a cached copy exists.",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      backfill: !!args.backfill,
      fromId: args.fromId ? parseInt(args.fromId, 10) : undefined,
      toId: args.toId ? parseInt(args.toId, 10) : undefined,
      limit: args.limit ? parseInt(args.limit, 10) : undefined,
      concurrency: args.concurrency
        ? Math.max(1, parseInt(args.concurrency, 10))
        : 6,
      refreshCache: !!args.refreshCache,
    }),
});

run(cli, process.argv.slice(2));
