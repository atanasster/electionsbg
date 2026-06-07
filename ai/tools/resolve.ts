// Shared fuzzy fallback for entity resolution (parties, candidates, places,
// MPs, polling agencies, ministries).
//
// Every resolver in this tree does a fast, *confident* match first — exact
// normalized equality, then substring / all-tokens — and those tiers are left
// untouched. This module adds ONE more tier that fires only when they all miss:
// a typo-tolerant fuzzy match so "Възраждене", "Plovdv" and "Asen Vasilv" still
// resolve. Being a strict last resort, it never overrides a confident match,
// which keeps the false-positive surface small (the AI auto-commits to a match
// and returns hard numbers, so a wrong entity is worse than "not found").
//
// All comparison happens in the romanized key space (translitKey), so Cyrillic
// vs Latin and non-standard transliteration ("Tarnovo" vs the official
// "Turnovo") fold together for free. Built on fuse.js — already a site
// dependency; the main-site header search uses the same engine with
// ignoreLocation:true (see src/data/search/useSearchItems.tsx).
//
// PERFORMANCE: the Fuse index is memoized per `cacheKey` (see FuzzyOptions), so
// the big lists (≈6k candidates) are tokenized once per session, not on every
// miss. Pass `entries` as a thunk and the row build is skipped entirely on a
// cache hit. We deliberately keep this client-side rather than behind a Firebase
// function: resolution needs the same per-election JSON the tool already fetched,
// so a backend round-trip would add latency without removing any data transfer.

import Fuse from "fuse.js";
import { translitKey } from "./translit";

export type FuzzyEntry<T> = {
  item: T;
  // one or more alias strings to compare the query against (a party's nickName +
  // full name, a place's BG + EN name, …). The best-scoring alias wins.
  keys: string[];
};

export type FuzzyOptions = {
  // fuse score is 0 (perfect) .. 1 (no match); keep only matches at/under this.
  // Tighter for short tokens (party abbreviations, where one edit flips meaning),
  // looser is fine for long distinctive names. Default 0.3.
  threshold?: number;
  // skip fuzzy entirely for romanized queries shorter than this — a 1–3 char
  // query is too ambiguous to typo-correct safely. Default 4.
  minLen?: number;
  // sort the query/key tokens before comparing, so a reordered multi-word name
  // ("Борисов Бойко" vs "Бойко Борисов") still matches. Use for person names.
  tokenSort?: boolean;
  // when set, the built Fuse index is cached under this key and reused on later
  // calls. The key MUST uniquely identify the entity set — include the election /
  // НС when the list varies (e.g. `candidate:2026_04_19`). Pass `entries` as a
  // thunk so the (possibly large) row build is also skipped on a cache hit.
  cacheKey?: string;
};

type Row<T> = { key: string; item: T };

// module-level so it survives across tool calls within a browser session / test
// run; cleared via clearFuzzyCache when the data source is swapped.
const fuseCache = new Map<string, unknown>();

const keyOf = (s: string, tokenSort: boolean): string => {
  const k = translitKey(s);
  if (!tokenSort) return k;
  return k.split(" ").filter(Boolean).sort().join(" ");
};

const buildFuse = <T>(
  entries: FuzzyEntry<T>[],
  threshold: number,
  tokenSort: boolean,
): Fuse<Row<T>> => {
  // one searchable row per (item, alias), each keeping a back-ref to its item.
  const rows: Row<T>[] = [];
  for (const e of entries) {
    for (const raw of e.keys) {
      const key = keyOf(raw, tokenSort);
      if (key) rows.push({ key, item: e.item });
    }
  }
  return new Fuse(rows, {
    includeScore: true,
    ignoreLocation: true, // match anywhere, not anchored to position 0
    threshold,
    keys: ["key"],
  });
};

// Best fuzzy match for `query` among `entries`, or undefined if nothing clears
// the threshold. Returns the matched item plus its fuse score (lower = closer).
export const fuzzyBestMatch = <T>(
  query: string,
  entries: FuzzyEntry<T>[] | (() => FuzzyEntry<T>[]),
  opts: FuzzyOptions = {},
): { item: T; score: number } | undefined => {
  const threshold = opts.threshold ?? 0.3;
  const minLen = opts.minLen ?? 4;
  const tokenSort = opts.tokenSort ?? false;

  const q = keyOf(query, tokenSort);
  if (q.length < minLen) return undefined; // before any (lazy) row build

  let fuse: Fuse<Row<T>> | undefined;
  if (opts.cacheKey) {
    // fold threshold/tokenSort into the key — they change the built index.
    const ck = `${opts.cacheKey}|${threshold}|${tokenSort ? 1 : 0}`;
    fuse = fuseCache.get(ck) as Fuse<Row<T>> | undefined;
    if (!fuse) {
      fuse = buildFuse(
        typeof entries === "function" ? entries() : entries,
        threshold,
        tokenSort,
      );
      fuseCache.set(ck, fuse);
    }
  } else {
    fuse = buildFuse(
      typeof entries === "function" ? entries() : entries,
      threshold,
      tokenSort,
    );
  }

  const hit = fuse.search(q)[0];
  if (!hit || (hit.score ?? 1) > threshold) return undefined;
  return { item: hit.item.item, score: hit.score ?? 1 };
};

// Drop all memoized indexes (e.g. a harness that swaps the data fetcher between
// runs, or the app switching data origins).
export const clearFuzzyCache = (): void => fuseCache.clear();
