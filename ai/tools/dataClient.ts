// Origin seam for per-election / cross-cutting JSON that is NOT bundled and must
// be fetched from the data bucket (mirrors src/data/dataUrl.ts, but without
// importing it so this module is safe to run under node/tsx where
// `import.meta.env` is undefined).
//
// The fetcher is pluggable: the browser default hits the CDN-fronted bucket; the
// node correctness harness swaps in a fetcher that reads the local `data/` tree.

type Fetcher = (path: string) => Promise<unknown>;

type CacheEntry = { value: Promise<unknown>; expiresAt: number };
const STATIC_TTL_MS = 5 * 60_000;
const LIVE_TTL_MS = 60_000;
const deadlineSensitive = (key: string): boolean => {
  const normalized = key.toLowerCase();
  if (/^(?:price(?:s)?-|open-calls(?:-|$)|poll(?:s)?(?:-|$))/.test(normalized))
    return true;
  return /^\/(?:opencalls|prices|polls)(?:\/|$)/.test(normalized);
};
const ttlFor = (key: string): number =>
  deadlineSensitive(key) ? LIVE_TTL_MS : STATIC_TTL_MS;

const browserFetcher: Fetcher = async (path: string) => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const base = env?.VITE_DATA_BASE_URL ?? "";
  const url = base
    ? `${base}${path.startsWith("/") ? path : `/${path}`}`
    : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
};

let fetcher: Fetcher = browserFetcher;

export const setFetcher = (f: Fetcher): void => {
  fetcher = f;
};

// Simple in-memory cache so repeated tool calls within a session don't re-fetch.
const cache = new Map<string, CacheEntry>();

export const fetchData = <T>(path: string): Promise<T> => {
  const now = Date.now();
  let entry = cache.get(path);
  if (!entry || entry.expiresAt <= now) {
    const p = fetcher(path);
    // Don't negatively-cache a failed fetch: evict on rejection so the next
    // call retries instead of re-returning the rejected promise.
    entry = { value: p, expiresAt: now + ttlFor(path) };
    cache.set(path, entry);
    p.catch(() => {
      if (cache.get(path)?.value === p) cache.delete(path);
    });
  }
  return entry.value as Promise<T>;
};

// DB-query seam — mirrors the JSON fetcher above, but targets the `/api/db/*`
// Postgres routes (functions/db_routes.js) instead of static bucket JSON. The
// browser default hits the same-origin function; the node correctness harness
// swaps in a fetcher that runs the SAME route handlers against local Postgres
// (so tool numbers are verified against the exact route code prod serves).
export type DbParams = Record<string, string | number | null | undefined>;
type DbFetcher = (route: string, params: DbParams) => Promise<unknown>;

const browserDbFetcher: DbFetcher = async (route, params) => {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  // The main app serves /api/db same-origin via a hosting rewrite, but the
  // standalone AI app (ai.electionsbg.com) is a separate Firebase project with
  // no such rewrite and no db function of its own — so it fetches the routes
  // cross-origin from the main deployment, exactly like it fetches JSON from
  // the data bucket. VITE_DB_API_ORIGIN carries that base in the AI prod build;
  // empty (same-origin) everywhere else, so the main app / AI dev keep hitting
  // the local /api/db plugin.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const base = env?.VITE_DB_API_ORIGIN ?? "";
  const url = `${base}/api/db/${route}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`db ${url} -> ${res.status}`);
  return res.json();
};

let dbFetcher: DbFetcher = browserDbFetcher;

export const setDbFetcher = (f: DbFetcher): void => {
  dbFetcher = f;
};

const dbCache = new Map<string, CacheEntry>();

/** Fetch one `/api/db/<route>` payload (the route's `body`). Cached per
 *  (route, params) for the session, like fetchData. */
export const fetchDb = <T>(
  route: string,
  params: DbParams = {},
): Promise<T> => {
  const key = `${route}?${JSON.stringify(params)}`;
  const now = Date.now();
  let entry = dbCache.get(key);
  if (!entry || entry.expiresAt <= now) {
    const p = dbFetcher(route, params);
    // Evict on rejection so a transient failure doesn't poison the session.
    entry = { value: p, expiresAt: now + ttlFor(route) };
    dbCache.set(key, entry);
    p.catch(() => {
      if (dbCache.get(key)?.value === p) dbCache.delete(key);
    });
  }
  return entry.value as Promise<T>;
};

export const clearDataCache = (): void => {
  cache.clear();
  dbCache.clear();
};

// Convenience helpers for the well-known per-election artifacts.
export const fetchNationalSummary = <T = unknown>(
  election: string,
): Promise<T> => fetchData<T>(`/${election}/national_summary.json`);

export const fetchRegionVotes = <T = unknown>(election: string): Promise<T> =>
  fetchData<T>(`/${election}/region_votes.json`);

export const fetchCanonicalParties = <T = unknown>(): Promise<T> =>
  fetchData<T>(`/canonical_parties.json`);
