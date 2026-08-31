// URL-backed filter plumbing for the /consumption/products browser (ProductsBrowserScreen).
//
// Same contract as useUrlCompanyFilters / useUrlPersonFilters: the filters live in the query
// string so a narrowed view is shareable, and EVERY value is validated on read — an unknown one
// is dropped rather than passed into a DbColumnFilter, because the engine rejects an
// unwhitelisted value with a 500 rather than an empty page.
//
// ⚠️ THIS IS ALL NEW CONSTRUCTION. Before it the page had NO url state at all: the term lived
// in `DbDataTable`'s own uncontrolled toolbar input and the group picker was a bare `useState`,
// so a reader who filtered to „Мляко и млечни продукти" and searched „верея" had a URL that
// said `/consumption/products` and nothing else — unshareable, unbookmarkable, and reset by
// Back and by a refresh alike.
//
//   ?q      — the free-text term over `title` (trigram). COMMITTED on submit, never per
//             keystroke — see useRegistryDraft.
//   ?group  — a КЗП product-group id (`pid`). 101 of them.
//   ?unit   — the canonical net unit: g | ml | pc.
//   ?trend  — `up` | `down`: the price against euro-day. A RANGE over pct_since_euro, bounded
//             on BOTH sides — see PRODUCT_TREND_RANGE.
//   ?multi  — "1" = stocked in 2+ chains, i.e. the rows whose „най-ниска цена" is a
//             cross-chain COMPARISON rather than the only price anybody observed.
//   ?loose  — "1" = `unit_priced`, the loose produce priced per kg/l.
//
// ⚠️ THERE IS NO `?browse` AND NO `?scope`, unlike the two sibling registries, because this
// page has no landing and no population floor. The reasoning is in
// docs/plans/products-browse-registry-v1.md §1; the short form is that `chain_count desc` over
// 48k rows is „the most widely stocked products in the basket", which is an answer, where
// /companies' default was €2.43bn СОФАРМА ТРЕЙДИНГ on every arrival forever.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { EURO_PCT_ARTIFACT, EURO_PCT_FLAT_BAND } from "@/data/prices/usePrices";
import {
  SEARCH_MIN_CHARS,
  termLength,
  QUERY_MAX,
  readQueryParam,
} from "@/ux/data_table/searchTerm";

/** Absent-filter sentinel, shared with the select controls (Radix needs a non-empty value for
 *  its „all" item). Spelled the same as the two sibling registries' and deliberately its own
 *  constant: a shared control must not import one page's URL module. */
export const PRODUCT_FILTER_ALL = "__all__";

/** The `net_unit` vocabulary — CLOSED, and validated against the PRODUCER rather than the data.
 *
 *  `Canon["netUnit"]` in scripts/prices/lib/canon.ts is `"g" | "ml" | "pc" | null`, so these
 *  three are exhaustive by construction. Measured 2026-08-31 over the 46,682 browsable rows:
 *  g 19,686 · ml 12,784 · pc 3,107, plus 11,105 carrying the EMPTY STRING (canon's `null`).
 *
 *  ⚠️ THE EMPTY STRING IS NOT A FOURTH MEMBER, and the picker must not offer it. Radix refuses
 *  an empty `SelectItem` value outright, and „no unit" here means „the net quantity did not
 *  parse from the title", not a category a reader would pick — the same reason /companies has
 *  no „без област" option over its 68% of unresolved seats. */
export const PRODUCT_UNITS = ["g", "ml", "pc"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** The `?trend` vocabulary. */
export const PRODUCT_TRENDS = ["up", "down"] as const;
export type ProductTrend = (typeof PRODUCT_TRENDS)[number];

/** A closed vocabulary plus the „no filter" sentinel — what a validated read returns. */
export type ProductOrAll<T extends string> = T | typeof PRODUCT_FILTER_ALL;

const readOneOf = <T extends string>(
  allowed: readonly T[],
  v: string | null,
): ProductOrAll<T> =>
  v && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : PRODUCT_FILTER_ALL;

/** A КЗП product-group id — validated by SHAPE, not against a hardcoded list of the 101.
 *
 *  The vocabulary lives in `usePriceDict()`, which is an async fetch: a list frozen here would
 *  refuse a group the picker beside it had just offered, the moment a new group enters the
 *  basket. Same reasoning as `isOblastName` on /companies and `isInstitutionName` on /persons —
 *  the facet IS the render-time authority and this only governs what an inbound URL may carry.
 *
 *  Digits only, and capped: the value goes into an `in` filter on an `int` column, so a
 *  non-numeric one is a 500 rather than an empty table. */
const GROUP_ID = /^\d{1,6}$/;

/** Exported for its test: a regression here is invisible from the outside — the picker offers a
 *  group the URL reader then silently discards, and the control snaps back to „Всички групи". */
export const isProductGroupId = (v: string): boolean => GROUP_ID.test(v);

const readGroup = (v: string | null): string =>
  v && isProductGroupId(v) ? v : PRODUCT_FILTER_ALL;

/** The bounds each `?trend` value puts on `pct_since_euro` — a PERCENT column, not a fraction.
 *
 *  ⚠️ BOTH BOUNDS, ALWAYS, AND NEITHER IS DECORATION. Both are IMPORTED rather than written
 *  here, so the filter cannot drift away from what the table renders.
 *
 *  The OUTER bound is `EURO_PCT_ARTIFACT`. A grocery item cannot credibly move more than ~100%
 *  since euro-day, so `euroPctSafe` renders anything past it as „—" — a thin euro-day baseline,
 *  a per-piece↔per-kg unit change, or product-identity drift under one canon_key. A one-sided
 *  `min` would therefore return rows under a „поскъпнали" chip whose own cell says nothing at
 *  all. (Measured 2026-08-31: zero such rows in the corpus today, so this bound keeps a future
 *  ingest honest rather than changing a number now.)
 *
 *  The INNER bound is `EURO_PCT_FLAT_BAND`, the same edge `productColumns.tsx` paints the cell
 *  red above and green below. 22,784 of the 46,682 browsable rows sit inside it and are
 *  correctly in NEITHER bucket.
 *
 *  Exported so both halves are testable without a mounted screen, and so the one place that
 *  knows the rule is not a `useMemo` inside a component. */
export const PRODUCT_TREND_RANGE: Record<
  ProductTrend,
  { min: number; max: number }
> = {
  up: { min: EURO_PCT_FLAT_BAND, max: EURO_PCT_ARTIFACT },
  down: { min: -EURO_PCT_ARTIFACT, max: -EURO_PCT_FLAT_BAND },
};

/** ⚠️ THE CAP AND THE READER LIVE IN `searchTerm.ts`, beside the floor, and are re-exported
 *  here only so a consumer of this hook does not need two imports — the /companies precedent,
 *  which exists because they were hand-copied first and the engine constant ended up with two
 *  unguarded client mirrors. */
export { QUERY_MAX } from "@/ux/data_table/searchTerm";

export interface UrlProductFilters {
  /** The free-text term, from `?q`. */
  query: string;
  /** A `pid`, as the string a Radix item carries, or the sentinel. */
  group: string;
  unit: ProductOrAll<ProductUnit>;
  trend: ProductOrAll<ProductTrend>;
  multiChain: boolean;
  looseOnly: boolean;
  /** True once the term is long enough for the ENGINE to accept it.
   *
   *  ⚠️ Derived from the shared `termLength` / `SEARCH_MIN_CHARS` rule, never hand-rolled — a
   *  `.length >= 3` here would be a third copy of the rule the engine documents as the one
   *  people get wrong („👍👍" is 4 by that measure and ZERO trigrams to pg_trgm).
   *
   *  Unlike the two sibling registries this does NOT gate a table: the page always renders one.
   *  It is what the hero field's own guidance line and the head count read, so a sub-floor term
   *  is EXPLAINED rather than silently ignored — `DbDataTable` suppresses it on the way to the
   *  engine either way. */
  queryIsSendable: boolean;
  setQuery: (v: string) => void;
  setGroup: (v: string) => void;
  setUnit: (v: string) => void;
  setTrend: (v: string) => void;
  setMultiChain: (v: boolean) => void;
  setLooseOnly: (v: boolean) => void;
  /** True when any managed param is active — drives „Изчисти филтрите". Includes `?q`. */
  hasActiveFilters: boolean;
  /** True when a COLUMN filter has narrowed the set — every dimension except the term.
   *
   *  Distinct from `hasActiveFilters` because the term narrows through the engine's global arm
   *  rather than through a column, so the two answer different questions even though this page
   *  never renders a landing off either. */
  hasNarrowingFilters: boolean;
  /** Clear every managed param — INCLUDING `?q` — preserving all others (`?area`, `?elections`,
   *  and anything else `usePreserveParams` is carrying). */
  clearFilters: () => void;
}

/** The params that NARROW the set — every one except the term.
 *
 *  ⚠️ THIS IS THE CHIP CONTRACT, not documentation. Each of these must produce a removable chip
 *  on the page; a narrowing with no chip is a table filtered by something the page names
 *  nowhere. `ProductsBrowserScreen.test.tsx` iterates this list rather than a hand-written copy,
 *  so a dimension added here without a chip fails rather than shipping silent.
 *
 *  ⚠️ `as const` IS LOAD-BEARING, NOT STYLE. Without it the type widens to `string[]`, so
 *  `Record<(typeof NARROWING_PARAMS)[number], boolean>` becomes an index signature that accepts
 *  a record MISSING a dimension — which then silently reads `undefined` and stops counting. */
export const PRODUCT_NARROWING_PARAMS = [
  "group",
  "unit",
  "trend",
  "multi",
  "loose",
] as const;

/** Every param this hook OWNS — what `clearFilters` deletes.
 *
 *  ⚠️ DERIVED FROM `PRODUCT_NARROWING_PARAMS`, not repeated beside it, and EXPORTED so its test
 *  can drive both the fixture URL and the assertions from one list. Hand-writing either makes
 *  the clear test vacuous in the one case it exists for: a param added to the hook and missed
 *  here would be absent from a hand-written fixture too, so `get(k)` returns null before the
 *  clear as well as after and the assertion passes having tested nothing. */
export const PRODUCT_URL_PARAMS = [...PRODUCT_NARROWING_PARAMS, "q"] as const;

export const useUrlProductFilters = (): UrlProductFilters => {
  const [params, setParams] = useSearchParams();

  const query = readQueryParam(params.get("q"));
  const group = readGroup(params.get("group"));
  const unit = readOneOf(PRODUCT_UNITS, params.get("unit"));
  const trend = readOneOf(PRODUCT_TRENDS, params.get("trend"));
  const multiChain = params.get("multi") === "1";
  const looseOnly = params.get("loose") === "1";
  const queryIsSendable = termLength(query.trim()) >= SEARCH_MIN_CHARS;

  // One writer for every filter param, so „write or delete" is decided in a single place. The
  // FUNCTIONAL form of setParams, so the write is computed from the router's own value rather
  // than from a closure over a render-time copy — which is what preserves `?area` (the global
  // place anchor this page carries onto every product link) and `?elections`.
  //
  // ⚠️ THAT IS NOT „two setters in one tick compose". react-router hands `setSearchParams(fn)`
  // the params as of the CURRENT RENDER, so two calls in one tick both start from the same base
  // and the second silently drops the first's param. Every control here sets exactly one param
  // per interaction and `clearFilters` is a single call, so no path in this screen reaches it —
  // a future „clear X and set Y" handler must issue ONE setParams.
  const write = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === PRODUCT_FILTER_ALL) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // ⚠️ THE RAW WRITER, FOR `?q` ONLY. `write` above treats PRODUCT_FILTER_ALL as „delete",
  // which is right for the params that HAVE an „all" state and wrong for a free-text field whose
  // value comes from a human keyboard: `setQuery("__all__")` would route the control sentinel
  // through the filter writer and ERASE the term instead of searching for it. Low reachability,
  // but it is a sentinel leaking into a user-data channel through a shared writer — the defect
  // /companies fixed on the newer copy first.
  const writeRaw = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setters = useMemo(
    () => ({
      // Capped on write as well as on read, and NOT trimmed — see `readQueryParam`. Capping on
      // both sides is not redundant: the read cap protects against a hand-built URL, the write
      // cap against a paste into the field, and neither implies the other.
      setQuery: (v: string) => writeRaw("q", v.slice(0, QUERY_MAX) || null),
      setGroup: (v: string) => write("group", v),
      setUnit: (v: string) => write("unit", v),
      setTrend: (v: string) => write("trend", v),
      setMultiChain: (v: boolean) => write("multi", v ? "1" : null),
      setLooseOnly: (v: boolean) => write("loose", v ? "1" : null),
    }),
    [write, writeRaw],
  );

  // Derived from the value each param READS rather than from the query string, so a param a
  // reader supplied but the validator refused (junk, a non-numeric group, `?unit=kg`) correctly
  // does NOT count as a narrowing — the table is not filtered by it either, so a chip offering
  // to remove it would name a filter that is not applied.
  const narrowingByParam: Record<
    (typeof PRODUCT_NARROWING_PARAMS)[number],
    boolean
  > = {
    group: group !== PRODUCT_FILTER_ALL,
    unit: unit !== PRODUCT_FILTER_ALL,
    trend: trend !== PRODUCT_FILTER_ALL,
    multi: multiChain,
    loose: looseOnly,
  };
  const hasNarrowingFilters = PRODUCT_NARROWING_PARAMS.some(
    (k) => narrowingByParam[k],
  );

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of PRODUCT_URL_PARAMS) next.delete(k);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return {
    query,
    group,
    unit,
    trend,
    multiChain,
    looseOnly,
    queryIsSendable,
    ...setters,
    hasActiveFilters: hasNarrowingFilters || query.trim().length > 0,
    hasNarrowingFilters,
    clearFilters,
  };
};
