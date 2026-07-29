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
//
// The vocabularies for facet/role/party/oblast/court are DATA, not constants, so they are
// validated by shape (a conservative code pattern) rather than against a hardcoded list
// that would silently drop a newly-added source. The engine's whitelist is the real
// authority on column ids; this guards the VALUES.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

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

export interface UrlPersonFilters {
  facet: string;
  primaryFacet: string;
  role: string;
  party: string;
  oblast: string;
  obshtina: string;
  court: string;
  declaredOnly: boolean;
  heldOfficeOnly: boolean;
  setFacet: (v: string) => void;
  setPrimaryFacet: (v: string | null) => void;
  setRole: (v: string) => void;
  setParty: (v: string) => void;
  setOblast: (v: string) => void;
  setObshtina: (v: string) => void;
  setCourt: (v: string) => void;
  setDeclaredOnly: (v: boolean) => void;
  setHeldOfficeOnly: (v: boolean) => void;
  /** True when any managed filter is active (drives the "clear" button). */
  hasActiveFilters: boolean;
  /** Clear every managed param, preserving all others (?q and anything else). */
  clearFilters: () => void;
}

const PARAMS = [
  "facet",
  "pfacet",
  "role",
  "party",
  "oblast",
  "obshtina",
  "court",
  "decl",
  "held",
] as const;

export const useUrlPersonFilters = (): UrlPersonFilters => {
  const [params, setParams] = useSearchParams();

  const facet = readCode(params.get("facet"));
  const primaryFacet = readCode(params.get("pfacet"));
  const role = readCode(params.get("role"));
  const party = readCode(params.get("party"));
  const oblast = readCode(params.get("oblast"));
  const obshtina = readCode(params.get("obshtina"));
  const court = readName(params.get("court"));
  const declaredOnly = params.get("decl") === "1";
  const heldOfficeOnly = params.get("held") === "1";

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
      setDeclaredOnly: (v: boolean) => write("decl", v ? "1" : null),
      setHeldOfficeOnly: (v: boolean) => write("held", v ? "1" : null),
    }),
    [write],
  );

  const hasActiveFilters =
    facet !== PERSON_FILTER_ALL ||
    primaryFacet !== PERSON_FILTER_ALL ||
    role !== PERSON_FILTER_ALL ||
    party !== PERSON_FILTER_ALL ||
    oblast !== PERSON_FILTER_ALL ||
    obshtina !== PERSON_FILTER_ALL ||
    court !== PERSON_FILTER_ALL ||
    declaredOnly ||
    heldOfficeOnly;

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
    facet,
    primaryFacet,
    role,
    party,
    oblast,
    obshtina,
    court,
    declaredOnly,
    heldOfficeOnly,
    ...setters,
    hasActiveFilters,
    clearFilters,
  };
};
