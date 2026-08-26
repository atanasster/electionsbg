// URL-backed filter plumbing for the /companies browser (CompaniesBrowseDbScreen).
//
// Same contract as useUrlPersonFilters / useUrlProcurementFilters: the filters live in the
// query string so a filtered view is shareable, and EVERY value is validated on read — an
// unknown one is dropped rather than passed into a DbColumnFilter, because the engine
// rejects an unwhitelisted value with a 500 rather than an empty page.
//
// ⚠️ THIS IS ALL NEW CONSTRUCTION, NOT A MIGRATION OF EXISTING STATE. Before it, three of
// the page's four controls were pure `useState` — the entity-class picker, the „Покажи
// всички" floor toggle and the search box (which read `?q` once on mount and never wrote
// it) — so a reader who filtered to сдружения in Варна and searched „екология" had a URL
// that said `/companies` and nothing else. Only `?political` was in the URL at all, and it
// was read once on mount, so Back changed the URL and not the checkbox.
//
//   ?q         — the free-text term. OWNED HERE because the browser is search-first: on the
//                landing there is no table for a search input to live in, so the head's
//                field holds it and it must survive a refresh like every other filter.
//   ?scope     — `all` (default) | `signal`. WHICH POPULATION, not a question about it.
//   ?browse    — "1" = show the table with nothing searched or filtered. A VIEW MODE.
//   ?political — "1" = is_official_linked. The redirect target /governance/companies and
//                /mp/company/** retired to, and the OG capture's route.
//   ?class     — one of the 7 entity_class codes.
//   ?status    — one of the 6 tr status codes.
//   ?oblast    — an oblast NAME (not a code — see readOblastName).
//   ?obshtina  — an obshtina code. Chip only, no picker.
//   ?money     — "1" = public_money_eur > 0.
//   ?contracts — "1" = contract_count > 0.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  SEARCH_MIN_CHARS,
  termLength,
  QUERY_MAX,
  readQueryParam,
} from "@/ux/data_table/searchTerm";

/** Absent-filter sentinel, shared with the select controls (Radix needs a non-empty value
 *  for its "all" item). */
export const COMPANY_FILTER_ALL = "__all__";

/** The `entity_class` vocabulary, and it is CLOSED in a way `status` is not.
 *
 *  `tr_entity_class(legal_form)` in 000_search_fns.sql is a total CASE ending in
 *  `ELSE 'company'`, so these seven are exhaustive by construction and cannot grow without
 *  someone editing that function. Measured 2026-08-26 over all 1,022,592 rows, all seven
 *  occur and none is NULL: company 988,644 · ngo_assoc 21,815 · ngo_found 5,085 ·
 *  chitalishte 3,439 · coop 2,708 · foreign_branch 878 · state_enterprise 23.
 *
 *  That is what makes hardcoding it safe here, where hardcoding `status` would not be. */
export const COMPANY_CLASSES = [
  "company",
  "ngo_assoc",
  "ngo_found",
  "chitalishte",
  "coop",
  "foreign_branch",
  "state_enterprise",
] as const;

/** The `status` vocabulary — SIX values, of which the corpus currently holds FOUR.
 *
 *  ⚠️ VALIDATE AGAINST THE PRODUCER, NOT AGAINST THE DATA. Measured 2026-08-26 the column
 *  holds only active 977,216 · ceased 39,293 · in_liquidation 5,812 · bankrupt 271 — but
 *  the writer's own union (`TrCompany["status"]` in scripts/declarations/tr/types.ts) is
 *  these six, and `state_replay.ts` can emit `in_liquidation` from a filing on any run. A
 *  list built from today's four would silently refuse `?status=erased` the day a TR refresh
 *  first produces one, and the symptom is a control that snaps back to „всички" with no
 *  explanation — the /persons `?court` regression, one column over.
 *
 *  The PICKER is unaffected either way: it is built from the facet, so it offers only the
 *  values that have rows. This list governs what an inbound URL may carry, which is a
 *  strictly wider question. */
export const COMPANY_STATUSES = [
  "active",
  "in_liquidation",
  "bankrupt",
  "ceased",
  "erased",
  "unknown",
] as const;

/** The `?scope` values. `all` is the DEFAULT and is written as an ABSENT param.
 *
 *  ⚠️ THE DEFAULT IS `all`, AND THAT IS THE WHOLE POINT OF THIS PARAM. Before it, the
 *  `has_signal` floor was an unconditional client-side `extraFilters` push, ANDed with the
 *  global search term by DbDataTable — so it applied to SEARCHES exactly as it applied to
 *  browsing, and 923,855 companies (90.34%) could not be found by name or by EIK. Measured:
 *  `uic = '205074978'` (ЕЛСЛАК ЕООД, €1.59bn declared capital) returned ZERO rows, as did
 *  „елслак" and „бета фонд", while both locale corpora and both prerendered bodies promised
 *  „търсенето обхваща целия регистър" / "the search box reaches the whole registry".
 *
 *  Defaulting to `all` makes that sentence true by construction. The floor does not go
 *  away — it becomes `?scope=signal`, applied by the landing's primary browse button, with
 *  its size on the label („Разгледай 98 737 фирми с публична следа"). */
export const COMPANY_SCOPES = ["all", "signal"] as const;
export type CompanyScope = (typeof COMPANY_SCOPES)[number];

/** The two CLOSED vocabularies, as types.
 *
 *  ⚠️ `?class` and `?status` are typed while `?oblast` and `?obshtina` are not, and that is
 *  the same distinction the comments above draw rather than an inconsistency. These two have
 *  vocabularies fixed in code (a total CASE in 000, a union in the TR writer), so a typo is
 *  knowable at compile time; the other two are DATA validated by shape, which is why
 *  `useUrlPersonFilters` types every one of its dimensions as a bare `string`.
 *
 *  Without these, `setEntityClass("compnay")` typechecks, is written to the URL, is refused
 *  on the next read, and the Select snaps back to „всички" with no explanation — the exact
 *  regression `COMPANY_STATUSES` warns about, reintroduced from the WRITE side. */
export type CompanyClass = (typeof COMPANY_CLASSES)[number];
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
/** A closed vocabulary plus the „no filter" sentinel — what a validated read returns. */
export type OrAll<T extends string> = T | typeof COMPANY_FILTER_ALL;

const readOneOf = <T extends string>(
  allowed: readonly T[],
  v: string | null,
): T | typeof COMPANY_FILTER_ALL =>
  v && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : COMPANY_FILTER_ALL;

/** Exported for its test: an absent or invalid `?scope` must default to `all` — the WHOLE
 *  registry. A regression here silently re-imposes the 90.34% floor on every search, which
 *  is the defect this param exists to remove and which no row count would report. */
export const readScope = (v: string | null): CompanyScope =>
  (COMPANY_SCOPES as readonly string[]).includes(v ?? "")
    ? (v as CompanyScope)
    : "all";

/** An obshtina code: three uppercase Latin letters and two digits.
 *
 *  ⚠️ SHAPE-VALIDATED AND DELIBERATELY **NOT** ROUTED THROUGH `canonicalObshtina()`, which
 *  is the opposite of what /persons does with the same-named param. `company_browse_table`
 *  spells Столична община **`SOF46`** — a FOURTH synonym beside the three
 *  `src/lib/obshtinaPlace.ts` already knows (`SFO_CITY` on person_browse_table, `SOF` in
 *  the local-election shards, `SOF00` in the governance routes). Measured 2026-08-26:
 *  `SOF46` is 116,306 rows — 35.6% of every placed row on the page — and `SOF00`, `SOF`,
 *  `SFO_CITY` and all 24 `S2***` district codes are **0 each**. `canonicalObshtina('SOF00')`
 *  returns `SFO_CITY`, which matches nothing here, so folding would filter the largest
 *  municipality in the corpus to an empty table under a confident Bulgarian chip.
 *
 *  `SOF46` is also the only one of the 264 non-empty codes absent from
 *  data/municipalities.json (which spells the София *oblast* `SFO06`…`SFO59` — one
 *  transposition away), so there is no dictionary to fold through even if one were wanted.
 *  Until a producer and a `SOF46` fold exist, this param arrives only from a hand-built URL
 *  and gets a chip rather than a picker.
 *
 *  The shape admits `SOF46` and rejects the 13 rows carrying the EMPTY STRING, which the
 *  facet's own `<> ''` guard means no picker could ever offer. */
const OBSHTINA = /^[A-Z]{3}\d{2}$/;

const readObshtina = (v: string | null): string =>
  v && OBSHTINA.test(v) ? v : COMPANY_FILTER_ALL;

/** An oblast NAME — 28 of them, and a name rather than a code because 188's column is
 *  `p.oblast` and tr_company_place (133) has no oblast CODE at all.
 *
 *  Validated by SHAPE, not against a hardcoded list of the 28, for the reason
 *  `isInstitutionName` on /persons spells out: the picker facets this same column, so its
 *  vocabulary IS the render-time authority, and a list frozen in the client silently
 *  refuses a value the picker itself just offered. The class covers Bulgarian and Latin
 *  letters plus the punctuation these names actually contain. Measured 2026-08-26 over the
 *  28 values, the ONLY punctuation in the whole column is the parenthesis pair in
 *  „София (столица)", and the only other non-letter is the space in the four two-word names
 *  („Велико Търново", „Стара Загора"). The longest value is 15 characters, so the 120 cap is
 *  amply clear.
 *
 *  ⚠️ Coverage is 32.0% (327,161 of 1,022,592), and the same either side of the floor
 *  (33.6% of signal rows, 31.8% of hidden ones) — so it is a property of `tr_company_place`
 *  and not of the population. `oblast_name IS NOT NULL` must NEVER be read as „this company
 *  has no registered seat"; it means the free-text seat did not resolve. This param may
 *  narrow a view and must never define one, and there is deliberately no „без област"
 *  option for anyone to add. */
const OBLAST_NAME = /^[\p{L}\p{N} .,\-'"„“”«»()/№–—]{1,120}$/u;

/** Exported for its test: the class is measured against the live vocabulary, and a
 *  regression is invisible — the picker offers a value the URL reader then discards. */
export const isOblastName = (v: string): boolean => OBLAST_NAME.test(v);

const readOblastName = (v: string | null): string =>
  v && isOblastName(v) ? v : COMPANY_FILTER_ALL;

/** ⚠️ THE CAP AND THE READER LIVE IN `searchTerm.ts`, beside the floor, and are re-exported
 *  here only so a consumer of this hook does not need two imports.
 *
 *  They were hand-copied into this file first, which made `MAX_SEARCH_TERM` in
 *  functions/db_table.js a server constant with TWO client mirrors and no gate on either.
 *  `searchTerm.test.ts` now reads the number back out of the engine source, so the three
 *  cannot drift. The reasoning for „capped, never trimmed, never character-validated" lives
 *  with the function; the consequence specific to THIS corpus is that `companies.name`
 *  carries `searchFold` but NOT `searchFoldTokens`, so the whole query must be one
 *  CONTIGUOUS substring of the transliterated fold — „бета фонд" trimmed to „бетафонд"
 *  matches nothing while Бета Фонд АД sits in the corpus. */
export { QUERY_MAX } from "@/ux/data_table/searchTerm";

export interface UrlCompanyFilters {
  /** Which population — NOT a narrowing. See `hasNarrowingFilters`. */
  scope: CompanyScope;
  political: boolean;
  entityClass: OrAll<CompanyClass>;
  status: OrAll<CompanyStatus>;
  oblast: string;
  obshtina: string;
  moneyOnly: boolean;
  contractsOnly: boolean;
  /** The free-text term, from `?q`. */
  query: string;
  /** `?browse=1` — render the table with nothing searched or filtered. */
  browseAll: boolean;
  /** True once the term is long enough for the ENGINE to accept it.
   *
   *  ⚠️ Derived from the shared `termLength` / `SEARCH_MIN_CHARS` rule, never hand-rolled.
   *  A `.length >= 3` here would be a third copy of the rule the engine documents as the one
   *  people get wrong — „👍👍" is 4 by that measure and ZERO trigrams to pg_trgm — and
   *  getting it wrong opens the table on a term the engine refuses with a 400, i.e. the
   *  destructive „Данните не можаха да се заредят." panel, on a page built so the table
   *  appears only when it can answer.
   *
   *  `companies` is one of the 23 resources with no unfloored arm to fall back on: its `uic`
   *  column is `searchEq` with `searchWhen: "[0-9]{8,14}"`, so a 1–2 character term routes
   *  that arm OUT and only `name` (floor 3) survives — which then refuses. */
  queryIsSendable: boolean;
  setScope: (v: CompanyScope) => void;
  /** Set the scope AND open the table, in ONE write — the landing's two browse buttons.
   *
   *  ⚠️ THIS EXISTS BECAUSE `setScope(...)` + `setBrowseAll(true)` SILENTLY DOES NOT WORK.
   *  Two setters in one handler do not compose (see `write`), so the second wins and the
   *  first param never lands. Ported verbatim from `PersonsLanding`, whose `browseAll` prop
   *  is an `onClick` callback rather than a `<Link>`, the floor button would read
   *  „Разгледай 98 737 фирми с публична следа" and open all 1,022,592 rows — silent, at a
   *  200, on the landing's primary call to action, with the count in the label making the
   *  wrong result look authoritative. Reversed, it drops `browse` instead and the button
   *  appears to do nothing. */
  browseScope: (v: CompanyScope) => void;
  setPolitical: (v: boolean) => void;
  setEntityClass: (v: OrAll<CompanyClass>) => void;
  setStatus: (v: OrAll<CompanyStatus>) => void;
  setOblast: (v: string) => void;
  setObshtina: (v: string) => void;
  setMoneyOnly: (v: boolean) => void;
  setContractsOnly: (v: boolean) => void;
  setQuery: (v: string) => void;
  setBrowseAll: (v: boolean) => void;
  /** True when any managed filter is active (drives the „Изчисти всички" button). Includes
   *  the free-text term; EXCLUDES `?scope` and `?browse`, which are not filters. */
  hasActiveFilters: boolean;
  /** True when a filter has actually NARROWED the set — every dimension except the scope,
   *  the view mode and the term.
   *
   *  ⚠️ THIS IS NOT `hasActiveFilters` MINUS TWO PARAMS; it answers a different question,
   *  and it is what decides whether the page shows a table at all.
   *
   *  ⚠️ `scope` IS DELIBERATELY NOT ONE, exactly as `?sector` is not one on /persons: it is
   *  which population you are looking at, not a question about it. Flipping it must not open
   *  a table — otherwise the landing's own scope choice would dismiss the landing.
   *
   *  ⚠️ `political` MUST BE ONE, and the OG capture depends on it. capture-screens.ts shoots
   *  `companies?political=1&elections=2026_04_19` and waits on
   *  `[data-og="official-companies-og"] tbody tr.group`; treated as a scope, the landing
   *  would render, the wait would time out, and the job would silently keep serving the old
   *  share card — the failure its own comment warns about. */
  hasNarrowingFilters: boolean;
  /** Clear every managed param — INCLUDING `?q`, `?scope` and `?browse` — preserving all
   *  others.
   *
   *  ⚠️ It clears `?scope` and `?browse` even though neither is a narrowing, and the
   *  „Изчисти всички" button is offered only for narrowings. The two are not in conflict:
   *  the button must never APPEAR for a view mode or a scope (nothing has been narrowed, so
   *  there is nothing to clear), while „clear everything", once it is on screen for some
   *  real filter, means everything. */
  clearFilters: () => void;
}

/** The params that NARROW the set — every one except the scope, the view mode and the term.
 *
 *  ⚠️ THIS IS THE CHIP CONTRACT, not documentation. Each of these must produce a removable
 *  chip on /companies — and for `?obshtina` the chip is the ONLY surface the dimension has,
 *  since it has no picker (see readObshtina). A narrowing with no chip is a table filtered
 *  by something the page names nowhere. The screen test iterates this list rather than a
 *  hand-written copy, so a dimension added here without a chip fails rather than shipping
 *  silent.
 *
 *  `scope` is absent because it is a POPULATION, `browse` because it is a view mode, and `q`
 *  because it narrows through the engine's global arm rather than a column.
 *
 *  ⚠️ `as const` IS LOAD-BEARING, NOT STYLE. Without it the type widens to `string[]`, so
 *  `Record<(typeof NARROWING_PARAMS)[number], boolean>` becomes `Record<string, boolean>` —
 *  an index signature that accepts a record MISSING a dimension. `narrowingByParam[k]` then
 *  returns `undefined` for it, that dimension silently stops unlocking the table, and a
 *  reader who deep-links into it gets a blank page. */
export const NARROWING_PARAMS = [
  "political",
  "class",
  "status",
  "oblast",
  "obshtina",
  "money",
  "contracts",
] as const;

/** Every param this hook OWNS — what `clearFilters` deletes.
 *
 *  ⚠️ EXPORTED so its test can drive BOTH the fixture URL and the assertions from it. Hand-
 *  writing either makes the clear test vacuous in the one case it exists for: a non-narrowing
 *  param added to the hook and MISSED here would be absent from a hand-written fixture too, so
 *  `get(k)` returns null before the clear as well as after and the assertion passes having
 *  tested nothing.
 *
 *  ⚠️ DERIVED FROM `NARROWING_PARAMS`, not repeated beside it. Two hand-written lists is the
 *  drift this shape exists to end: a narrowing added to the contract and missed here would
 *  get a chip, unlock the table, and then SURVIVE „Изчисти всички" — and neither gate would
 *  see it, because the chip gate only checks that a chip exists and the clear test pins its
 *  own query string by hand. */
export const COMPANY_URL_PARAMS = [
  ...NARROWING_PARAMS,
  "scope",
  "q",
  "browse",
] as const;

export const useUrlCompanyFilters = (): UrlCompanyFilters => {
  const [params, setParams] = useSearchParams();

  const scope = readScope(params.get("scope"));
  const political = params.get("political") === "1";
  const entityClass = readOneOf(COMPANY_CLASSES, params.get("class"));
  const status = readOneOf(COMPANY_STATUSES, params.get("status"));
  const oblast = readOblastName(params.get("oblast"));
  const obshtina = readObshtina(params.get("obshtina"));
  const moneyOnly = params.get("money") === "1";
  const contractsOnly = params.get("contracts") === "1";
  const query = readQueryParam(params.get("q"));
  const browseAll = params.get("browse") === "1";
  const queryIsSendable = termLength(query.trim()) >= SEARCH_MIN_CHARS;

  // One writer for every param, so "write or delete" is decided in a single place, and it
  // uses the FUNCTIONAL form of setParams so the write is computed from the router's own
  // value rather than from a closure over a render-time copy.
  //
  // ⚠️ THAT IS NOT THE SAME AS "two setters in one tick compose", and the sibling hook's
  // comment claims it is. Measured: react-router's `setSearchParams(fn)` hands `fn` the
  // params as of the CURRENT RENDER, so two calls in one tick both start from the same base
  // and the second silently drops the first's param. Every control here sets exactly one
  // filter per interaction and `clearFilters` is a single call, so no path in this screen
  // reaches it — but a future „clear X and set Y" handler must issue ONE setParams, not two
  // setters. The test pins the real behaviour so that stays discoverable.
  const write = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === COMPANY_FILTER_ALL) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // ⚠️ THE RAW WRITER, for `?q` ONLY. `write` above treats COMPANY_FILTER_ALL as „delete",
  // which is right for the six params that HAVE an „all" state and wrong for a free-text
  // field whose value comes from a human keyboard: `setQuery("__all__")` would route the
  // sentinel through the filter writer and erase the term instead of searching for it. Low
  // reachability, but it is a control sentinel leaking into a user-data channel through a
  // shared writer. (`useUrlPersonFilters` has the identical conflation; fixed on the newer
  // copy first.)
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

  // Several params in ONE setParams. The single-setter path cannot compose, so any handler
  // that changes more than one param must come through here — see `browseScope`.
  const writeMany = useCallback(
    (entries: Array<[string, string | null]>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of entries) {
            if (value == null || value === COMPANY_FILTER_ALL) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setters = useMemo(
    () => ({
      // `all` is the default, so it is stored as an ABSENT param — a clean `/companies` URL
      // for the whole registry. `signal` is the one that must be written explicitly.
      setScope: (v: CompanyScope) => write("scope", v === "all" ? null : v),
      // ONE write, for the reason `browseScope`'s doc comment gives.
      browseScope: (v: CompanyScope) =>
        writeMany([
          ["scope", v === "all" ? null : v],
          ["browse", "1"],
        ]),
      setPolitical: (v: boolean) => write("political", v ? "1" : null),
      setEntityClass: (v: string) => write("class", v),
      setStatus: (v: string) => write("status", v),
      setOblast: (v: string) => write("oblast", v),
      setObshtina: (v: string) => write("obshtina", v),
      setMoneyOnly: (v: boolean) => write("money", v ? "1" : null),
      setContractsOnly: (v: boolean) => write("contracts", v ? "1" : null),
      // Capped on write as well as on read, and NOT trimmed — see readQuery. Capping on both
      // sides is not redundant: the read cap protects against a hand-built URL, the write cap
      // against a paste into the field, and neither implies the other.
      setQuery: (v: string) => writeRaw("q", v.slice(0, QUERY_MAX) || null),
      setBrowseAll: (v: boolean) => write("browse", v ? "1" : null),
    }),
    [write, writeRaw, writeMany],
  );

  // Derived from the value each param READS rather than from the query string, so a param a
  // reader supplied but the validator refused (junk, an over-long value, `SFO_CITY`) correctly
  // does NOT count as a narrowing — the table is not filtered by it either.
  const narrowingByParam: Record<(typeof NARROWING_PARAMS)[number], boolean> = {
    political,
    class: entityClass !== COMPANY_FILTER_ALL,
    status: status !== COMPANY_FILTER_ALL,
    oblast: oblast !== COMPANY_FILTER_ALL,
    obshtina: obshtina !== COMPANY_FILTER_ALL,
    money: moneyOnly,
    contracts: contractsOnly,
  };
  const hasNarrowingFilters = NARROWING_PARAMS.some((k) => narrowingByParam[k]);

  // `scope` and `browse` are absent on purpose: neither narrows anything, so lighting
  // „Изчисти всички" for either would offer to clear a population or a view mode under the
  // name of a filter. The results body's own „назад към търсенето" affordance is what takes a
  // reader back out of `?browse`.
  //
  // ⚠️ DELIBERATELY UNLIKE `useUrlPersonFilters`, whose `hasActiveFilters` DOES count its
  // `?sector` — the structurally identical param (which population, default `all`, written
  // absent, not a narrowing, cleared by clearFilters). Same shape, opposite answer, and the
  // difference is where the control lives: there the scope sits in the filter bar, so
  // „изчисти" plainly covers it; here it belongs to the landing's browse buttons and the
  // head's pill, so lighting the button for it would offer to clear a population under the
  // name of a filter. Recorded here rather than left to be discovered, because two hooks
  // answering one question differently with neither mentioning the other is the drift both
  // headers exist to prevent.
  const hasActiveFilters = hasNarrowingFilters || query.trim().length > 0;

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const p of COMPANY_URL_PARAMS) next.delete(p);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return {
    scope,
    political,
    entityClass,
    status,
    oblast,
    obshtina,
    moneyOnly,
    contractsOnly,
    query,
    browseAll,
    queryIsSendable,
    ...setters,
    hasActiveFilters,
    hasNarrowingFilters,
    clearFilters,
  };
};
