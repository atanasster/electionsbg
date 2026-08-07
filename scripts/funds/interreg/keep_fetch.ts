// The keep.eu client: index walk, detail fetch, raw cache.
//
// Tier T0 of docs/plans/interreg-funds-ingest-v1.md §8.
//
// WHY A WALK AND NOT A QUERY. keep.eu's search endpoint accepts filters and
// IGNORES them. Measured 2026-08-06: `?programme=342`, `?programmes[]=342`,
// `?programme__id=342` and a POST body of `{"programmes":{…}}` each return the
// same unfiltered 32,702 projects. So the only way to learn which projects
// belong to our 22 programmes is to page the whole index — 5,451 pages at
// 6 results/page — and filter client-side on `programme.id`, which the index
// row does carry. Budget ~2 h at 8-way concurrency; a detail pass over the
// ~1,930 admitted projects adds ~40 min.
//
// The index is ordered by keep id DESCENDING, which is what makes an
// incremental refresh cheap: stop as soon as a page contains an id we already
// hold. That is NOT sufficient on its own — see `WalkOptions.stopAtKeepId` —
// but it is the right first pass.
//
// EVERYTHING HERE IS BUILT FOR A ~2 h UNATTENDED RUN against a small public
// service. That is why no single page failure ends the walk, why the caller can
// checkpoint after every wave, why every request carries a timeout, and why the
// detail pass returns its failures instead of throwing them.
//
// Data credit: keep.eu (INTERACT). Their terms require crediting keep.eu with a
// link wherever these figures are published; `/data/sources` carries it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWriteFileSync } from "../../lib/atomic_write";
import { admittedKeepProgrammeIds, programmeFor } from "./programmes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

/**
 * Gitignored: ~1,930 detail JSONs, re-fetchable from keep.eu on demand.
 *
 * Overridable so a test can point the cache layer at a temp directory. Without
 * the seam the only way to exercise these six functions is against the real
 * cache, which collides with a running crawl.
 */
export const RAW_DIR =
  process.env.INTERREG_RAW_DIR ?? path.join(ROOT, "raw_data/interreg/keep");

export const KEEP_BASE = "https://keep.eu";

// Identifying, not a browser impersonation. keep.eu publishes this data for
// reuse and asks for attribution rather than blocking robots, so the polite
// thing is to say who we are and how to reach us.
const UA =
  "electionsbg.com-interreg-ingest/1.0 (+https://electionsbg.com/data/sources)";

/** Backoff between attempts, ms. Bounded: an operator being refused for longer
 *  than this wants to know, not to watch a script hang. */
const RETRY_DELAY_MS = [2_000, 8_000, 20_000];

/** Per-request ceiling. Without it a stalled socket falls back to undici's
 *  300 s default and holds one of only 8 slots for five minutes. */
const REQUEST_TIMEOUT_MS = 60_000;

/** keep.eu serves this index 6 rows per page and ignores every page-size hint. */
export const INDEX_PAGE_SIZE = 6;

/** Ceiling on parallel requests. keep.eu is a small public service run by a
 *  programme secretariat, not a CDN; 8 is already generous. */
export const MAX_CONCURRENCY = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Injectable transport, so the walk logic is unit-testable without a network. */
export type Fetcher = (url: string) => Promise<Response>;

const realFetch: Fetcher = (url) =>
  fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

/** One row of `/api/search/projects/`. Only the fields the walk needs. */
export interface KeepIndexRow {
  id: number;
  acronym?: string | null;
  programme?: { id: number; title?: string } | null;
}

export interface KeepIndexPage {
  count: number;
  total_pages: number;
  results: KeepIndexRow[];
}

/**
 * A refusal that retrying cannot fix — a 4xx that is not rate limiting. It must
 * be its own class rather than a plain Error: the retry loop's catch has to
 * distinguish "the server said no" from "the socket died", and a bare throw
 * inside the try is indistinguishable from a network fault.
 */
export class NonRetryableError extends Error {}

/** A 404 is a real answer about a real id — keep.eu's ids are not contiguous —
 *  so a crawl records it and moves on instead of aborting. */
export class NotFoundError extends NonRetryableError {}

/** A 200 whose body is not JSON: an interstitial or a maintenance page. Named
 *  so the operator is not told "unexpected token <" three times over. */
export class NonJsonResponseError extends Error {}

const validateConcurrency = (n: number, where: string): void => {
  if (!Number.isInteger(n) || n < 1)
    throw new Error(
      `${where}: concurrency must be a positive integer, got ${JSON.stringify(n)}`,
    );
};

/**
 * GET a keep.eu JSON endpoint, retrying past a transient refusal.
 *
 * Retries 429, 5xx, timeouts and network errors. Does NOT retry any other 4xx:
 * a 400 or a 403 will say the same thing three times over and just burn the
 * backoff. A non-JSON 200 IS retried (an interstitial usually clears) but is
 * reported under its own name so the cause is legible.
 */
export const fetchKeepJson = async <T>(
  url: string,
  fetcher: Fetcher = realFetch,
): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAY_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS[attempt - 1]);
    try {
      const res = await fetcher(url);
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new NonJsonResponseError(
            `GET ${url} → ${res.status} with a non-JSON body (likely an interstitial)`,
          );
        }
      }
      const msg = `GET ${url} → ${res.status} ${res.statusText}`;
      if (res.status === 404) throw new NotFoundError(msg);
      if (res.status !== 429 && res.status < 500)
        throw new NonRetryableError(msg);
      lastErr = new Error(msg);
    } catch (e) {
      if (e instanceof NonRetryableError) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

export const indexPageUrl = (page: number): string =>
  `${KEEP_BASE}/api/search/projects/?page=${page}`;

export const projectDetailUrl = (keepId: number): string =>
  `${KEEP_BASE}/api/project/${keepId}/`;

export const programmeDetailUrl = (keepProgrammeId: number): string =>
  `${KEEP_BASE}/api/programme/${keepProgrammeId}/`;

/** A project we admit, as learned from the index (before any detail fetch). */
export interface AdmittedRow {
  keepId: number;
  keepProgrammeId: number;
  programmeCode: string;
}

export interface WalkOptions {
  /**
   * Stop once a page contains a keep id at or below this. The index is
   * id-descending, so everything past it is already held.
   *
   * DERIVE THIS FROM THE MANIFEST, NOT FROM THE DETAIL CACHE. The two are
   * different stores and they disagree when either is damaged; taking the id
   * from the cache while taking the row set from the manifest is how a lost
   * manifest silently collapses the corpus to a handful of rows and still exits
   * 0. `crawl.ts` refuses that combination outright.
   *
   * NOT a complete refresh strategy either way: keep.eu re-imports whole
   * programmes (ROBG 21-27 in 2026-04, BSB NEXT in 2026-05, Euro-MED in
   * 2026-06), revising rows in place, and the index exposes no `modified`. Use
   * this weekly for new operations and a full walk monthly for revisions.
   */
  stopAtKeepId?: number;
  concurrency?: number;
  /** Hard cap on pages, for a smoke run. */
  maxPages?: number;
  fetcher?: Fetcher;
  /** Called once per wave — NOT once per page. A per-page modulus is how the
   *  first version managed to print nothing at all for two hours: pages arrive
   *  in multiples of the concurrency, so `done % 80` never fired at 8-way. */
  onProgress?: (done: number, total: number, admitted: number) => void;
  /**
   * Called once per wave with the rows accumulated so far, so a caller can
   * persist progress. Without this the whole walk lives in memory until it
   * returns, and a single unhealthy page two hours in loses all of it.
   */
  onCheckpoint?: (rows: AdmittedRow[], pagesFetched: number) => void;
}

export interface WalkResult {
  rows: AdmittedRow[];
  pagesFetched: number;
  total: number;
  /** Pages that failed twice. A short corpus then has a stated cause. */
  failedPages: number[];
  /**
   * `count` as page 1 reported it, and as the last page did.
   *
   * THIS IS THE ONLY HONEST SHIFT DETECTOR. A project inserted at the top
   * mid-walk shifts every later page down by one row and exactly one row is
   * never served to us; `seen` catches the opposite case (a deletion causing a
   * repeat) but nothing catches a skip. The obvious check — adjacent pages must
   * abut, `page[n].last - page[n+1].first === 1` — is WRONG here, because
   * keep.eu ids are sparse: 32,702 projects with a maximum id of 34,025 means
   * ~1,300 ids simply do not exist, so a gap is the norm and the check would
   * fire on almost every boundary. Total drift is the signal that survives
   * sparse ids.
   */
  countAtStart: number;
  countAtEnd: number;
  /** True when the index moved under the walk in either direction, so
   *  pagination shifted and rows may have been skipped or truncated. */
  indexShifted: boolean;
}

/**
 * Page the whole project index and return the rows belonging to admitted
 * programmes.
 *
 * Fetches in waves of `concurrency` so the stop condition is evaluated against
 * a complete wave: with requests in flight it is otherwise possible to stop on
 * page N while page N-1 is still unresolved, silently dropping its rows.
 *
 * A page that stays unhealthy past the retry budget is RECORDED, not thrown.
 * Letting one bad page reject its wave and unwind a two-hour run — discarding
 * every row already collected — is the wrong trade. `failedPages` is retried
 * once at the end and whatever still fails is returned for the caller to report.
 */
export const walkIndex = async (
  opts: WalkOptions = {},
): Promise<WalkResult> => {
  const {
    stopAtKeepId,
    concurrency = MAX_CONCURRENCY,
    maxPages,
    fetcher = realFetch,
    onProgress,
    onCheckpoint,
  } = opts;
  validateConcurrency(concurrency, "walkIndex");
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1))
    throw new Error(
      `walkIndex: maxPages must be a positive integer, got ${JSON.stringify(maxPages)}`,
    );

  // Hoisted out of the loop deliberately: this is a 22-element derivation and
  // the walk runs 5,451 times.
  const admitted = new Set(admittedKeepProgrammeIds());

  const first = await fetchKeepJson<KeepIndexPage>(indexPageUrl(1), fetcher);
  const totalPages = Math.min(
    first.total_pages,
    maxPages ?? Number.POSITIVE_INFINITY,
  );

  const rows: AdmittedRow[] = [];
  const seen = new Set<number>();
  let pagesFetched = 0;
  let reachedKnown = false;
  let lastCount = first.count;

  const collect = (page: KeepIndexPage): void => {
    lastCount = page.count ?? lastCount;

    for (const r of page.results ?? []) {
      // Set BEFORE the admission filter: the stop tracks position in the index,
      // not position in the admitted subset. Inverting these two would make an
      // incremental walk run to page 5,451 every time.
      if (stopAtKeepId !== undefined && r.id <= stopAtKeepId)
        reachedKnown = true;
      const pid = r.programme?.id;
      if (pid === undefined || pid === null) continue;
      if (!admitted.has(pid)) continue;
      if (stopAtKeepId !== undefined && r.id <= stopAtKeepId) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push({
        keepId: r.id,
        keepProgrammeId: pid,
        programmeCode: programmeFor(pid)!.code,
      });
    }
  };

  collect(first);
  pagesFetched = 1;
  onProgress?.(pagesFetched, totalPages, rows.length);

  const failedPages: number[] = [];

  const runWave = async (wave: number[]): Promise<void> => {
    const settled = await Promise.allSettled(
      wave.map((p) => fetchKeepJson<KeepIndexPage>(indexPageUrl(p), fetcher)),
    );
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") collect(s.value);
      else failedPages.push(wave[i]);
    });
    pagesFetched += settled.length;
  };

  for (
    let start = 2;
    start <= totalPages && !reachedKnown;
    start += concurrency
  ) {
    const wave: number[] = [];
    for (let p = start; p < start + concurrency && p <= totalPages; p++)
      wave.push(p);

    await runWave(wave);
    onProgress?.(pagesFetched, totalPages, rows.length);
    onCheckpoint?.(rows, pagesFetched);
  }

  // One retry sweep for the pages that failed, before giving up on them. A
  // transient refusal at hour two is common; losing those rows silently is not
  // acceptable, so whatever still fails is returned rather than swallowed.
  if (failedPages.length) {
    const retry = failedPages.splice(0, failedPages.length);
    for (let i = 0; i < retry.length; i += concurrency)
      await runWave(retry.slice(i, i + concurrency));
    onCheckpoint?.(rows, pagesFetched);
  }

  return {
    rows,
    pagesFetched,
    total: first.count,
    failedPages,
    countAtStart: first.count,
    countAtEnd: lastCount,
    indexShifted: lastCount !== first.count,
  };
};

export const rawPathFor = (keepId: number, dir = RAW_DIR): string =>
  path.join(dir, `${keepId}.json`);

export const hasCachedDetail = (keepId: number, dir = RAW_DIR): boolean =>
  fs.existsSync(rawPathFor(keepId, dir));

/** Read a cached detail, or null. Never fetches. */
export const readCachedDetail = <T = unknown>(
  keepId: number,
  dir = RAW_DIR,
): T | null => {
  const file = rawPathFor(keepId, dir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    // A truncated write from an interrupted crawl. Treat as absent rather than
    // aborting a multi-hour run: the fetch path will rewrite it.
    console.warn(`interreg: unreadable cache for ${keepId}, refetching`);
    return null;
  }
};

/** Every keep id currently in the raw cache. The `^(\d+)\.json$` anchor is what
 *  keeps a killed crawl's orphaned `.tmp` files out of the resume set. */
export const cachedKeepIds = (dir = RAW_DIR): number[] => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
    .filter((s): s is string => Boolean(s))
    .map(Number)
    .sort((a, b) => a - b);
};

/** Fetch one project detail and write it to the raw cache. */
export const fetchProjectDetail = async <T = unknown>(
  keepId: number,
  fetcher: Fetcher = realFetch,
  dir = RAW_DIR,
): Promise<T> => {
  const json = await fetchKeepJson<T>(projectDetailUrl(keepId), fetcher);
  // Atomic: a multi-hour crawl WILL be interrupted, and a half-written JSON in
  // the cache is worse than a missing one because the resume path would treat
  // it as held.
  atomicWriteFileSync(rawPathFor(keepId, dir), JSON.stringify(json));
  return json;
};

export interface DetailFetchOptions {
  concurrency?: number;
  /** Re-fetch even when the raw cache already holds the id (the monthly pass). */
  force?: boolean;
  fetcher?: Fetcher;
  dir?: string;
  onProgress?: (done: number, total: number, fetched: number) => void;
}

export interface DetailFetchResult {
  fetched: number;
  skipped: number;
  /** 404s: real answers about ids the detail endpoint no longer serves. */
  missing: number[];
  /** Everything else that failed. A re-run picks these up. */
  failed: { keepId: number; error: string }[];
}

/**
 * Fetch details for `keepIds`, skipping those already cached unless `force`.
 * The payloads land in the raw cache, which is the durable artifact every later
 * step reads.
 *
 * NOTHING here throws on a per-id failure. Each write is individually durable,
 * so a run that hits 12 bad ids out of 1,930 has still produced 1,918 usable
 * files — throwing would discard the run report while the other (uncancelled)
 * workers kept writing, leaving the operator with a cache they cannot
 * characterise. Failures are returned instead.
 */
export const fetchDetails = async (
  keepIds: number[],
  opts: DetailFetchOptions = {},
): Promise<DetailFetchResult> => {
  const {
    concurrency = MAX_CONCURRENCY,
    force = false,
    fetcher = realFetch,
    dir = RAW_DIR,
    onProgress,
  } = opts;
  validateConcurrency(concurrency, "fetchDetails");

  const todo = force
    ? [...keepIds]
    : keepIds.filter((id) => !hasCachedDetail(id, dir));
  const skipped = keepIds.length - todo.length;
  const missing: number[] = [];
  const failed: { keepId: number; error: string }[] = [];
  let fetched = 0;
  let done = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const id = todo[i];
      try {
        await fetchProjectDetail(id, fetcher, dir);
        fetched++;
      } catch (e) {
        if (e instanceof NotFoundError) missing.push(id);
        else failed.push({ keepId: id, error: String(e) });
      }
      done++;
      onProgress?.(done, todo.length, fetched);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, worker),
  );

  return { fetched, skipped, missing, failed };
};
