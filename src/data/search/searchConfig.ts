// Pure (no React / no hooks) search config — the SINGLE source of truth shared
// by the header search (useSearchItems builds the Fuse index; SearchContext
// applies the per-type score filter) AND the regression harness
// (scripts/search/search.harness.ts). Keeping these here means a threshold tweak
// can't silently drift between the live search and its test.

import type { IFuseOptions } from "fuse.js";
import type { SearchIndexType } from "./useSearchItems";

type Searchable = { name: string; name_en?: string };

// Canonical ordering of search-result groups — the SINGLE source of truth for
// both the visual grouping (SearchItems renders groups in this order) and the
// arrow-nav/sort order (SearchContext derives its numeric `groupOrder` from
// this array). Keeping one array means the two can't silently diverge.
// "d" (Sofia район) sits right after "m" (município); the rest is
// settlement → município → район → region → section → candidate → official →
// ministry → vote.
export const TYPE_ORDER: SearchIndexType["type"][] = [
  "s",
  "m",
  "d",
  "r",
  "c",
  "o",
  "p",
  "b",
  "v",
];

// Fuse over the bilingual name fields. ignoreLocation so a match can sit anywhere
// in the string (e.g. "образование" inside "Министерството на образованието").
export const SEARCH_FUSE_OPTIONS: IFuseOptions<Searchable> = {
  includeScore: true,
  includeMatches: true,
  ignoreLocation: true,
  keys: ["name", "name_en"],
};

// Per-type fuzziness budget — fuse score is 0 (perfect) .. 1 (no match); a result
// is kept when its score <= the limit for its type.
//   b/v/o (ministry / vote title / municipal official): 0.4 — searched by partial
//     keyword ("отбран" → Defence, "Радев" → Radev).
//   s/m/r (settlement / municipality / region): 0.2 — a single-character typo or
//     transliteration drift ("Пловдв", "Veliko Turnovo") scores ~0.14–0.17, so
//     0.1 (exact) returned nothing; 0.2 catches it without over-reaching (foreign
//     names like "Лондон" still score well above 0.2).
//   c (section): 0.1 — the name is a numeric section id; a fuzzy edit there would
//     bind to an unrelated station.
//   p (person) is not Fuse-scored — it comes live from person_search, not this index.
export const searchLimitForType = (type: string): number =>
  type === "b" || type === "v" || type === "o" ? 0.4 : type === "c" ? 0.1 : 0.2;
