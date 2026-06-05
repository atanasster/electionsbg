// Origin seam for per-election / cross-cutting JSON that is NOT bundled and must
// be fetched from the data bucket (mirrors src/data/dataUrl.ts, but without
// importing it so this module is safe to run under node/tsx where
// `import.meta.env` is undefined).
//
// The fetcher is pluggable: the browser default hits the CDN-fronted bucket; the
// node correctness harness swaps in a fetcher that reads the local `data/` tree.

type Fetcher = (path: string) => Promise<unknown>;

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
const cache = new Map<string, Promise<unknown>>();

export const fetchData = <T>(path: string): Promise<T> => {
  let p = cache.get(path);
  if (!p) {
    p = fetcher(path);
    cache.set(path, p);
  }
  return p as Promise<T>;
};

export const clearDataCache = (): void => cache.clear();

// Convenience helpers for the well-known per-election artifacts.
export const fetchNationalSummary = <T = unknown>(
  election: string,
): Promise<T> => fetchData<T>(`/${election}/national_summary.json`);

export const fetchRegionVotes = <T = unknown>(election: string): Promise<T> =>
  fetchData<T>(`/${election}/region_votes.json`);

export const fetchCanonicalParties = <T = unknown>(): Promise<T> =>
  fetchData<T>(`/canonical_parties.json`);
