// Pure (no React / no hooks) search config — the SINGLE source of truth shared
// by the header search (useSearchItems builds the Fuse index; SearchContext
// applies the per-type score filter) AND the regression harness
// (scripts/search/search.harness.ts). Keeping these here means a threshold tweak
// can't silently drift between the live search and its test.

import type { IFuseOptions } from "fuse.js";

type Searchable = { name: string; name_en?: string };

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
//   a/b/v/o (candidate-MP / ministry / vote title / municipal official): 0.4 —
//     searched by partial keyword ("отбран" → Defence, "Радев" → Radev).
//   s/m/r (settlement / municipality / region): 0.2 — a single-character typo or
//     transliteration drift ("Пловдв", "Veliko Turnovo") scores ~0.14–0.17, so
//     0.1 (exact) returned nothing; 0.2 catches it without over-reaching (foreign
//     names like "Лондон" still score well above 0.2).
//   c (section): 0.1 — the name is a numeric section id; a fuzzy edit there would
//     bind to an unrelated station.
export const searchLimitForType = (type: string): number =>
  type === "a" || type === "b" || type === "v" || type === "o"
    ? 0.4
    : type === "c"
      ? 0.1
      : 0.2;
