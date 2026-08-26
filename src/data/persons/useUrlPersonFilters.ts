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
//   ?role     — a role code (mp, councillor, magistrate, manager, …)
//   ?party    — a party canonicalId; means "EVER affiliated", not "currently"
//   ?oblast   — a 3-letter oblast code; likewise "holds any role there"
//   ?obshtina — an obshtina code; the representative seat only, since obshtina has no
//               code-SET column (unlike oblast). The /governance/:id cross-link.
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
import { SEARCH_MIN_CHARS, termLength } from "@/ux/data_table/searchTerm";

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

/** The longest free-text term `?q` will carry — 200 CODE UNITS, applied with the same
 *  `.slice()` idiom the engine uses (`raw.trim().slice(0, MAX_SEARCH_TERM)` in
 *  `functions/db_table.js`), so the two sides agree on where a pasted paragraph is cut.
 *
 *  ⚠️ Code units here, CHARACTERS at the floor (`termLength`). The cap and the floor count
 *  differently on purpose: the floor decides whether a term is a query at all, where a
 *  surrogate pair is one character to pg_trgm and two to `.length`; the cap only has to match
 *  the engine's own truncation point. */
export const QUERY_MAX = 200;

/** Read `?q`. Capped, and DELIBERATELY neither trimmed nor character-validated.
 *
 *  ⚠️ NOT TRIMMED, and this is the one thing in this file that must not be "tidied up". The
 *  value IS the controlled search field's value (Tier 3 binds `value={query}` — the shape
 *  `DbDataTable`'s controlled arm documents as correct), so trimming here deletes the space
 *  the reader has just typed and „Иван Иванов" becomes untypable: it arrives as „ИванИванов".
 *  Against `person_browse_table` that is not a cosmetic loss — its `name` column is
 *  `searchFoldTokens: true` precisely so a first + family name matches past the patronymic
 *  (docs/plans/person-search-token-match-v1.md), so one concatenated token matches NOTHING and
 *  the page reports „no such person", at a 200, about somebody who is in the corpus.
 *
 *  The de-duplication worry that motivated the trim is already handled one layer down:
 *  `DbDataTable` trims ONCE at the request boundary, and its header says it does so precisely
 *  because a URL-owned term makes stray whitespace likelier.
 *
 *  NOT character-validated because the engine escapes LIKE metacharacters itself (`likeEscape`
 *  in db_table.js), and a class narrow enough to feel safe would reject „Окръжен съд - Варна" —
 *  a term the picker beside it offers verbatim. */
const readQuery = (v: string | null): string => (v ?? "").slice(0, QUERY_MAX);

export interface UrlPersonFilters {
  sector: PersonSector;
  position: string;
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
  setPosition: (v: string) => void;
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
   *  dimension is a reader saying what they want, including the two params with no picker
   *  (`?position`, `?obshtina`), which are cross-link targets and MUST unlock the table or
   *  arriving from /governance/:id renders a blank page. */
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

const PARAMS = [
  "sector",
  "position",
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
  "q",
  "browse",
] as const;

export const useUrlPersonFilters = (): UrlPersonFilters => {
  const [params, setParams] = useSearchParams();

  const sector = readSector(params.get("sector"));
  const position = readCode(params.get("position"));
  const facet = readCode(params.get("facet"));
  const primaryFacet = readCode(params.get("pfacet"));
  const role = readCode(params.get("role"));
  const party = readCode(params.get("party"));
  const oblast = readCode(params.get("oblast"));
  const obshtina = readCode(params.get("obshtina"));
  const court = readName(params.get("court"));
  const declaredOnly = params.get("decl") === "1";
  const heldOfficeOnly = params.get("held") === "1";
  const switchersOnly = params.get("switch") === "1";
  const query = readQuery(params.get("q"));
  const browseAll = params.get("browse") === "1";
  const queryIsSendable = termLength(query.trim()) >= SEARCH_MIN_CHARS;

  // One writer for every param, so "write or delete" is decided in a single place. Reads
  // the CURRENT params at call time (not from a closure over a render-time copy), so two
  // filter changes in one tick cannot clobber each other.
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
      setPrimaryFacet: (v: string | null) => write("pfacet", v),
      setRole: (v: string) => write("role", v),
      setParty: (v: string) => write("party", v),
      setOblast: (v: string) => write("oblast", v),
      setObshtina: (v: string) => write("obshtina", v),
      setCourt: (v: string) => write("court", v),
      // `all` is the default, so it is stored as an ABSENT param — a clean `/persons` URL for
      // the whole layer. `public` is now the one that must be written explicitly; the
      // registry's own tier=P floor still covers a raw API hit that sends no tier at all.
      setSector: (v: PersonSector) => write("sector", v === "all" ? null : v),
      setPosition: (v: string) => write("position", v),
      setDeclaredOnly: (v: boolean) => write("decl", v ? "1" : null),
      setHeldOfficeOnly: (v: boolean) => write("held", v ? "1" : null),
      setSwitchersOnly: (v: boolean) => write("switch", v ? "1" : null),
      // Capped on write as well as on read, and NOT trimmed — see readQuery. Capping on both
      // sides is not redundant: the read cap protects against a hand-built URL, the write cap
      // against a paste into the field, and neither implies the other.
      setQuery: (v: string) => write("q", v.slice(0, QUERY_MAX) || null),
      setBrowseAll: (v: boolean) => write("browse", v ? "1" : null),
    }),
    [write],
  );

  // Every dimension EXCEPT `sector` — see `hasNarrowingFilters` in the interface for why the
  // scope is not one of these, and why `?position` / `?obshtina` (which have no picker) are.
  const hasNarrowingFilters =
    position !== PERSON_FILTER_ALL ||
    facet !== PERSON_FILTER_ALL ||
    primaryFacet !== PERSON_FILTER_ALL ||
    role !== PERSON_FILTER_ALL ||
    party !== PERSON_FILTER_ALL ||
    oblast !== PERSON_FILTER_ALL ||
    obshtina !== PERSON_FILTER_ALL ||
    court !== PERSON_FILTER_ALL ||
    declaredOnly ||
    heldOfficeOnly ||
    switchersOnly;

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
    position,
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
