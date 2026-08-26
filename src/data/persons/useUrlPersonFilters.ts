// URL-backed filter plumbing for the /persons browser (PersonsBrowserScreen).
//
// Same contract as useUrlProcurementFilters: the filters live in the query string so a
// filtered view is shareable (the app's URL-contract convention), and EVERY value is
// validated on read — an unknown one is dropped rather than passed into a DbColumnFilter,
// because the engine rejects an unwhitelisted value with a 500 rather than an empty page.
//
//   ?facet    — a person GROUP (mp | exec | muni | magistrate | candidate | ngo | company
//               | donor). These are the membership FLAGS, not `primary_facet` — see
//               personGroups.ts for why filtering the representative facet would make
//               10,703 company-linked people unreachable.
//   ?pfacet   — the PRIMARY facet (the mix bar's selection). A different question from
//               ?facet: "what is this person primarily" vs "is this person also a …".
//               Single-valued and total, which is what makes the bar a real partition.
//               ?position is a retired ALIAS of it — see readPrimaryFacet.
//   ?role     — a role code (mp, councillor, magistrate, manager, …)
//   ?party    — a party canonicalId; means "EVER affiliated", not "currently"
//   ?oblast   — a 3-letter oblast code; likewise "holds any role there"
//   ?obshtina — an obshtina code; the representative seat only, since obshtina has no
//               code-SET column (unlike oblast). The /governance/:id cross-link.
//               CANONICALISED ON READ — see readObshtina.
//   ?court    — an INSTITUTION NAME (a court, a ministry). A name rather than a code
//               because the picker facets and filters the same `institution` column, which
//               keeps its counts exact and needs no code→name dictionary in the client.
//   ?decl     — "1" = only people with a declaration on record
//   ?held     — "1" = only people who have actually held office (excludes the
//               candidate-only long tail, which is 52% of the corpus)
//   ?switch   — "1" = only people affiliated with more than one party (parties_n >= 2)
//   ?q        — the free-text term. OWNED HERE since the browser became search-first: the
//               table no longer holds it, the head's field does, and it must survive a
//               refresh like every other filter.
//   ?browse   — "1" = show the table even with nothing searched or filtered. The one
//               escape hatch out of the landing; a VIEW MODE, not a narrowing (see below).
//
// The vocabularies for facet/role/party/oblast/court are DATA, not constants, so they are
// validated by shape (a conservative code pattern) rather than against a hardcoded list
// that would silently drop a newly-added source. The engine's whitelist is the real
// authority on column ids; this guards the VALUES.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { canonicalObshtina } from "@/lib/obshtinaPlace";
import {
  SEARCH_MIN_CHARS,
  termLength,
  QUERY_MAX,
  readQueryParam,
} from "@/ux/data_table/searchTerm";

/** Absent-filter sentinel, shared with the select controls (Radix needs a non-empty
 *  value for its "all" item). */
export const PERSON_FILTER_ALL = "__all__";

/** Codes in this corpus are ASCII word characters plus `-` (`p_16`, `official_exec`,
 *  `PDV-00`, `SOFIA_CITY`). Anything else is junk or an injection attempt and is dropped.
 *  Length-capped so a pathological query string cannot become a giant bind parameter. */
const CODE = /^[A-Za-z0-9_-]{1,64}$/;

const readCode = (v: string | null): string =>
  v && CODE.test(v) ? v : PERSON_FILTER_ALL;

/** A human institution name — Cyrillic/Latin letters, digits, and the punctuation these
 *  names actually contain. The character class and the length cap are both MEASURED against
 *  the live vocabulary, not guessed: a too-narrow class silently rejects a value the picker
 *  itself just offered, and the control snaps back to "all" with no explanation. `+` and the
 *  closing curly quote `”` were exactly that bug; the cap is 200 because the longest real
 *  name is comfortably under it. */
const NAME = /^[\p{L}\p{N} .,\-+'"„“”«»()/№–—]{1,200}$/u;

/** Exported for its test: the character class and the cap are MEASURED against the live
 *  vocabulary, and a regression here is invisible (the picker offers a value that the URL
 *  reader then silently discards). */
export const isInstitutionName = (v: string): boolean => NAME.test(v);

const readName = (v: string | null): string =>
  v && NAME.test(v) ? v : PERSON_FILTER_ALL;

/** `?position`'s vocabulary → `?pfacet`'s. ONE value differs; the other five are identical.
 *
 *  ⚠️ `?position` IS A PURE ALIAS AND IS RETIRED, not a filter with its own meaning. Measured
 *  2026-08-26 over all 137,461 rows of `person_browse_table`, the `position_type` × `primary_facet`
 *  cross-tab is perfectly diagonal:
 *
 *    private_sector ⟷ company  73,645   ·  politician 46,139  ·  executive 8,234
 *    public_sector   5,882     ·  magistrate 3,535            ·  regulator 26
 *
 *  So `?position=politician` and `?pfacet=politician` returned the identical rows, and
 *  `?position=private_sector` was a THIRD spelling of a set `?pfacet=company` and `?sector=private`
 *  already had two names for. Keeping it would have meant a second control for one partition.
 *
 *  It folds on READ rather than being deleted: a hand-built link or an AI tool already emitting
 *  it keeps working, where a deletion would silently render an UNFILTERED page. The URL is not
 *  rewritten — an inbound link that quietly becomes a different one is a different promise.
 *
 *  ⚠️ THE INVERSE IS A CHOICE, NOT A RENAME, even though the data reads like one. Migration 120
 *  builds the column as `CASE WHEN tr.facet IN ('company','concession') THEN 'private_sector'
 *  ELSE tr.facet END` — MANY-to-one, so `private_sector` has two pre-images and this map picks
 *  `company` because `concession` occurs nowhere in `person_source.facet` today. Should it ever
 *  appear, `?position=private_sector` would silently answer for only one of the two, and the
 *  data gate in `person_browse.data.test.ts` is what fails first. */
const POSITION_TO_FACET: Record<string, string> = { private_sector: "company" };

/** Read `?pfacet`, accepting the retired `?position` as an alias.
 *
 *  An explicit `?pfacet` WINS: a URL carrying both is a caller that knows the live param, and
 *  the alias must never override it. */
const readPrimaryFacet = (
  pfacet: string | null,
  position: string | null,
): string => {
  const live = readCode(pfacet);
  if (live !== PERSON_FILTER_ALL) return live;
  const legacy = readCode(position);
  if (legacy === PERSON_FILTER_ALL) return legacy;
  return POSITION_TO_FACET[legacy] ?? legacy;
};

/** Read `?obshtina`, folded onto the ONE code the corpus speaks.
 *
 *  ⚠️ THE FOLD BELONGS HERE, NOT AT EACH CONSUMER. Sofia has three synonyms — `SFO_CITY` in
 *  `person_browse_table`, `SOF` in the local-election shards, and `SOF00` in the place-view id
 *  the governance dashboards ROUTE on — and only the first matches a row: measured 2026-08-26,
 *  `SFO_CITY` is 1,315 rows and `SOF00`/`SOF` are **0** each. So a reader arriving from
 *  `/governance/SOF00`, which is every Sofia governance URL, filters the largest municipality
 *  in the corpus to nothing.
 *
 *  Folding at ONE consumer is worse than not folding at all: a chip that resolves the label but
 *  a filter that sends the raw code renders „Община: Столична община" over an empty table —
 *  a confident sentence in Bulgarian saying the capital contains nobody, where the unfolded
 *  code at least read as a failure. Doing it on READ means the filter, the chip, the facets and
 *  anything added later all see the same value and cannot disagree.
 *
 *  Read-side only: the URL is left as the reader wrote it, so an inbound link is not silently
 *  rewritten into a different one. */
const readObshtina = (v: string | null): string => {
  const code = readCode(v);
  return code === PERSON_FILTER_ALL
    ? code
    : (canonicalObshtina(code) ?? PERSON_FILTER_ALL);
};

/** The public⇄private toggle. `all` (the DEFAULT since the search-first rework) shows the whole
 *  137,461-person layer; `public` shows only people in power; `private` shows the name-fold
 *  частен-сектор owners. Maps to the matview `tier` column in the screen
 *  (public→omit so the registry's tier=P floor applies · private→['V'] · all→['P','V']).
 *
 *  ⚠️ THE DEFAULT MOVED, and what it costs is worth knowing before anyone moves it back.
 *  Measured 2026-08-26: tier P is 63,816 rows and tier V is 73,645, so under `all` **53.6% of
 *  the default view carries a name-based identity** (V is `verified`/`name_fold`/`shared_name`,
 *  never `resolved`) and therefore the amber „по име" / „няколко лица" badge — 4,388 of them the
 *  stronger warning. That is honest per row; the page owes the reader the same statement ONCE,
 *  at the top, which is why the scope control carries counts.
 *
 *  What it does NOT cost: every existing deep link. Measured per tier, `has_declaration`,
 *  `role_codes ~ mp`, `place_kind='judicial'`, `is_ngo` and `parties_n>1` are all ZERO in tier V,
 *  so `?decl=1`, `?role=mp`, `?court=…`, `?facet=ngo` and `?switch=1` return exactly what they
 *  did. Only `?facet=company` (11,415 → 85,060) and free-text search widen. */
export const PERSON_SECTORS = ["public", "private", "all"] as const;
export type PersonSector = (typeof PERSON_SECTORS)[number];
/** Exported for its test: an absent/invalid ?sector must default to `all` (the whole layer),
 *  and only the three known values pass — a regression here silently NARROWS the page to the
 *  public arm while every count on it still reconciles. */
export const readSector = (v: string | null): PersonSector =>
  (PERSON_SECTORS as readonly string[]).includes(v ?? "")
    ? (v as PersonSector)
    : "all";

/** Escape LIKE metacharacters before a value goes into a `% code %` containment match.
 *
 *  `_` is a LIKE single-character wildcard and these codes are FULL of it (`p_16`,
 *  `SOFIA_CITY`, `chief_architect`). Unescaped, `' p_16 '` also matches `' pX16 '` — no
 *  collision exists in today's corpus, but the query reads as exact and is not, and the
 *  next code vocabulary added may not be so lucky. Backslash first, or the escapes
 *  introduced for `_` get escaped in turn. */
export const escapeLike = (v: string): string =>
  v.replace(/\\/g, "\\\\").replace(/[_%]/g, (m) => `\\${m}`);

/** The padded-containment value the engine's `text` filter (ILIKE '%…%') should receive
 *  for a code-set column. The matview stores ' a b c ', so wrapping the code in spaces
 *  makes the match exact at both boundaries — `' ngo '` can no longer hit `ngo_board`. */
export const codeSetMatch = (code: string): string => ` ${escapeLike(code)} `;

/** ⚠️ THE CAP AND THE READER MOVED TO `searchTerm.ts`, beside the floor, and are re-exported
 *  here so existing importers (and this file's test) keep working.
 *
 *  They were hand-written here and then hand-copied into `useUrlCompanyFilters`, which made
 *  `MAX_SEARCH_TERM` in functions/db_table.js a server constant with TWO client mirrors and no
 *  gate on either — the same shape `searchTerm.ts` was extracted to end for the FLOOR.
 *  `searchTerm.test.ts` now reads the number back out of the engine source, so the three
 *  cannot drift. The reasoning („capped, never trimmed, never character-validated", and why
 *  the cap counts code units while the floor counts characters) lives with the function. */
export { QUERY_MAX } from "@/ux/data_table/searchTerm";

/** The /persons-specific consequence of `readQueryParam` NOT trimming, kept here because it
 *  is the sharpest example of the rule: `person_browse_table.name` is `searchFoldTokens: true`
 *  precisely so a first + family name matches past the patronymic
 *  (docs/plans/person-search-token-match-v1.md), so a term trimmed as it is typed —
 *  „Иван Иванов" arriving as „ИванИванов" — is one concatenated token that matches NOTHING,
 *  and the page reports „no such person" at a 200 about somebody who is in the corpus. */
const readQuery = readQueryParam;

export interface UrlPersonFilters {
  sector: PersonSector;
  facet: string;
  primaryFacet: string;
  role: string;
  party: string;
  oblast: string;
  obshtina: string;
  court: string;
  declaredOnly: boolean;
  heldOfficeOnly: boolean;
  switchersOnly: boolean;
  /** The free-text term, from `?q`. */
  query: string;
  /** `?browse=1` — render the table with nothing searched or filtered. */
  browseAll: boolean;
  /** True once the term is long enough for the ENGINE to accept it.
   *
   *  ⚠️ Derived from the shared `termLength` / `SEARCH_MIN_CHARS` rule, never hand-rolled.
   *  A `.length >= 3` written here would be a third copy of a rule the engine documents as the
   *  one people get wrong — „👍👍" is 4 by that measure and ZERO trigrams to pg_trgm — and
   *  getting it wrong opens the table on a term the engine refuses with a 400, i.e. the
   *  destructive error panel, on a page designed so the table appears only when it can answer. */
  queryIsSendable: boolean;
  setFacet: (v: string) => void;
  setPrimaryFacet: (v: string | null) => void;
  setRole: (v: string) => void;
  setParty: (v: string) => void;
  setOblast: (v: string) => void;
  setObshtina: (v: string) => void;
  setCourt: (v: string) => void;
  setSector: (v: PersonSector) => void;
  setDeclaredOnly: (v: boolean) => void;
  setHeldOfficeOnly: (v: boolean) => void;
  setSwitchersOnly: (v: boolean) => void;
  setQuery: (v: string) => void;
  setBrowseAll: (v: boolean) => void;
  /** True when any managed filter is active (drives the "clear" button). Includes the
   *  free-text term and the sector; EXCLUDES `?browse`, which is a view mode. */
  hasActiveFilters: boolean;
  /** True when a filter has actually NARROWED the set — every dimension except `sector`.
   *
   *  ⚠️ THIS IS NOT `hasActiveFilters` MINUS ONE PARAM; it answers a different question, and
   *  it is what decides whether the browser shows a table at all. `sector` is a SCOPE, not a
   *  query: switching „Всички" → „Във властта" and getting 63,816 prominence-sorted rows is
   *  precisely the default-table behaviour the search-first rework removes. Every other
   *  dimension is a reader saying what they want, including `?obshtina` — which has no picker
   *  of its own and MUST unlock the table, or a reader following the governance dashboard's
   *  „хора, свързани с …" link gets a blank page. */
  hasNarrowingFilters: boolean;
  /** Clear every managed param — INCLUDING `?q` and `?browse` — preserving all others.
   *
   *  ⚠️ This used to preserve `?q` deliberately. It no longer can: since the search field is
   *  the page's primary control, an „Изчисти всички" that leaves a term sitting in it (and the
   *  table still filtered by it) is the more surprising of the two behaviours.
   *
   *  ⚠️ It DOES clear `?browse` and `?sector`, neither of which is a narrowing — and the
   *  „Изчисти филтрите" button is offered only for narrowings. The two are not in conflict:
   *  the button must never APPEAR for a view mode or a scope (nothing has been narrowed, so
   *  there is nothing to clear), while „clear everything", once it is on screen for some real
   *  filter, means everything. A reader who has narrowed to „Магистрати, Варна, само с
   *  декларация" under „Частен сектор" and clicks a button labelled „изчисти" is asking to
   *  start over, not to keep one of the five things they set. */
  clearFilters: () => void;
}

/** The params that NARROW the set — every one except the scope, the view mode and the term.
 *
 *  ⚠️ THIS IS THE CHIP CONTRACT, not documentation. Each of these must produce a removable chip
 *  on /persons — and for `?obshtina` the chip is the ONLY surface the dimension has, since it
 *  arrives from the governance dashboard's „хора, свързани с …" link and has no picker. (The
 *  others do have controls: `?pfacet` is the mix bar, the rest are the filter bar's pickers and
 *  toggles.) A narrowing with no chip is a table filtered by something the page names nowhere.
 *  `PersonsBrowserScreen.test.tsx` iterates this list rather than a hand-written copy of it, so
 *  a dimension added here without a chip fails rather than shipping silent.
 *
 *  `sector` is absent because it is a SCOPE, `browse` because it is a view mode, and `q` because
 *  it narrows through the engine's global arm rather than a column. `position` is absent because
 *  it is a retired ALIAS that folds into `pfacet` — it still narrows, through that.
 *
 *  ⚠️ `as const` IS LOAD-BEARING, NOT STYLE. Without it the type widens to `string[]`, so
 *  `Record<(typeof NARROWING_PARAMS)[number], boolean>` becomes `Record<string, boolean>` — an
 *  index signature that accepts a record MISSING a dimension. `narrowingByParam[k]` then returns
 *  `undefined` for it, that dimension silently stops unlocking the table, and a reader who
 *  deep-links into it gets a blank page. The `satisfies` in the screen test widens with it and
 *  stops failing too, which is why the test also asserts the key sets match at RUNTIME. */
export const NARROWING_PARAMS = [
  "facet",
  "pfacet",
  "role",
  "party",
  "oblast",
  "obshtina",
  "court",
  "decl",
  "held",
  "switch",
] as const;

/** Every param this hook OWNS — what `clearFilters` deletes.
 *
 *  ⚠️ DERIVED FROM `NARROWING_PARAMS`, not repeated beside it. Two hand-written lists is the
 *  drift this tier exists to end, one level up: a narrowing added to the contract and missed
 *  here would get a chip, unlock the table, and then SURVIVE „Изчисти филтрите" — and neither
 *  gate would see it, because the chip gate only checks that a chip exists and the clear test
 *  pins its own query string by hand.
 *
 *  The four extras are the params that are NOT narrowings: the scope, the retired `?position`
 *  alias (which must still be cleared, or the fold re-applies after a clear), the free-text
 *  term and the view mode. */
const PARAMS = [
  ...NARROWING_PARAMS,
  "sector",
  "position",
  "q",
  "browse",
] as const;

export const useUrlPersonFilters = (): UrlPersonFilters => {
  const [params, setParams] = useSearchParams();

  const sector = readSector(params.get("sector"));
  const facet = readCode(params.get("facet"));
  const primaryFacet = readPrimaryFacet(
    params.get("pfacet"),
    params.get("position"),
  );
  const role = readCode(params.get("role"));
  const party = readCode(params.get("party"));
  const oblast = readCode(params.get("oblast"));
  const obshtina = readObshtina(params.get("obshtina"));
  const court = readName(params.get("court"));
  const declaredOnly = params.get("decl") === "1";
  const heldOfficeOnly = params.get("held") === "1";
  const switchersOnly = params.get("switch") === "1";
  const query = readQuery(params.get("q"));
  const browseAll = params.get("browse") === "1";
  const queryIsSendable = termLength(query.trim()) >= SEARCH_MIN_CHARS;

  // One writer for every param, so "write or delete" is decided in a single place, using the
  // FUNCTIONAL form of setParams so the write merges into the live query string rather than
  // replacing it from a render-time copy.
  //
  // ⚠️ THAT IS NOT "two filter changes in one tick cannot clobber each other", which this
  // comment claimed until 2026-08-26 and which is FALSE. Measured: react-router hands
  // `setSearchParams(fn)` the params as of the current RENDER, so two setter calls in one
  // handler both start from the same base and the second silently drops the first's param.
  // Every control here sets one filter per interaction, so no path reaches it today — but a
  // „clear X and set Y" handler must issue ONE setParams rather than two setters.
  // `useUrlCompanyFilters` carries a `writeMany` for exactly that case, after the /companies
  // landing's floor button turned out to need `?scope` and `?browse` in a single write.
  const write = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === PERSON_FILTER_ALL) next.delete(key);
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
      setFacet: (v: string) => write("facet", v),
      // ⚠️ CLEARS BOTH PARAMS, and the retired one is the reason. `?position` folds into
      // `?pfacet` on READ, so under an inbound `?position=` link a setter that touched only
      // `pfacet` deleted a param the URL does not carry — the fold then re-applied on the next
      // render and the chip's × did nothing. The mix bar's deselect is the same call, so no
      // click sequence could reach "no primary facet"; only „Изчисти филтрите" escaped.
      //
      // This is NOT the read-side rewrite the alias deliberately avoids: that would rewrite a
      // reader's URL behind their back on arrival. This fires only on an explicit action whose
      // whole meaning is „remove this filter", and removing it means removing both spellings of
      // it.
      setPrimaryFacet: (v: string | null) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("position");
            if (v == null || v === PERSON_FILTER_ALL) next.delete("pfacet");
            else next.set("pfacet", v);
            return next;
          },
          { replace: true },
        ),
      setRole: (v: string) => write("role", v),
      setParty: (v: string) => write("party", v),
      setOblast: (v: string) => write("oblast", v),
      setObshtina: (v: string) => write("obshtina", v),
      setCourt: (v: string) => write("court", v),
      // `all` is the default, so it is stored as an ABSENT param — a clean `/persons` URL for
      // the whole layer. `public` is now the one that must be written explicitly; the
      // registry's own tier=P floor still covers a raw API hit that sends no tier at all.
      setSector: (v: PersonSector) => write("sector", v === "all" ? null : v),
      setDeclaredOnly: (v: boolean) => write("decl", v ? "1" : null),
      setHeldOfficeOnly: (v: boolean) => write("held", v ? "1" : null),
      setSwitchersOnly: (v: boolean) => write("switch", v ? "1" : null),
      // Capped on write as well as on read, and NOT trimmed — see readQuery. Capping on both
      // sides is not redundant: the read cap protects against a hand-built URL, the write cap
      // against a paste into the field, and neither implies the other.
      setQuery: (v: string) => write("q", v.slice(0, QUERY_MAX) || null),
      setBrowseAll: (v: boolean) => write("browse", v ? "1" : null),
    }),
    [write, setParams],
  );

  // Every dimension EXCEPT `sector` — see `hasNarrowingFilters` in the interface for why the
  // scope is not one of these, and why `?position` / `?obshtina` (which have no picker) are.
  // Derived from the value each param READS rather than from the query string, so a param the
  // reader supplied but the validator refused (junk, an over-long value) correctly does NOT
  // count as a narrowing — the table is not filtered by it either.
  const narrowingByParam: Record<(typeof NARROWING_PARAMS)[number], boolean> = {
    facet: facet !== PERSON_FILTER_ALL,
    pfacet: primaryFacet !== PERSON_FILTER_ALL,
    role: role !== PERSON_FILTER_ALL,
    party: party !== PERSON_FILTER_ALL,
    oblast: oblast !== PERSON_FILTER_ALL,
    obshtina: obshtina !== PERSON_FILTER_ALL,
    court: court !== PERSON_FILTER_ALL,
    decl: declaredOnly,
    held: heldOfficeOnly,
    switch: switchersOnly,
  };
  const hasNarrowingFilters = NARROWING_PARAMS.some((k) => narrowingByParam[k]);

  // `browse` is absent on purpose: it narrows nothing, so lighting „Изчисти филтрите" for it
  // would offer to clear a view mode under the name of a filter. The landing's own „назад"
  // affordance is what takes a reader back out of it.
  const hasActiveFilters =
    hasNarrowingFilters || sector !== "all" || query.trim().length > 0;

  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const p of PARAMS) next.delete(p);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return {
    sector,
    facet,
    primaryFacet,
    role,
    party,
    oblast,
    obshtina,
    court,
    declaredOnly,
    heldOfficeOnly,
    switchersOnly,
    query,
    browseAll,
    queryIsSendable,
    ...setters,
    hasActiveFilters,
    hasNarrowingFilters,
    clearFilters,
  };
};
