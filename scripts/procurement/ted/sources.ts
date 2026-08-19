// TED — Tenders Electronic Daily (plan P10), the EU's publication of record for
// above-threshold procurement.
//
// WHAT IT IS FOR: a completeness cross-check. Every Bulgarian procurement above
// the EU threshold must be published here as well as nationally, so a notice in
// TED with no counterpart in our corpus is either a gap in our ingest or a
// procedure that never reached the national register. Neither is visible from
// inside our own data.
//
// ⚠️ `buyer-identifier` IS THE ЕИК, and that is what makes this joinable at all.
// Verified: it returns e.g. ["000093645"], the same key as
// `contracts.awarder_eik`. Without it TED would only be comparable by buyer NAME,
// which for Bulgarian institutions is the matching problem the whole repo exists
// to avoid.
//
// The v3 API is open — no key, no registration — and answers a POST of a query
// DSL. `paginationMode: "ITERATION"` plus the returned `iterationNextToken` is
// the only way past the first page; a plain `page` parameter caps out.

export const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";

/** 250 is the API's documented ceiling per request. */
export const TED_PAGE_SIZE = 250;

/** ⚠️ TED RATE-LIMITS, and does not publish the figure. An earlier version of
 *  this comment said it did not — measured 2026-08-19, two concurrent
 *  paginating workers drew a 429 on the second page of the first year. One
 *  worker with a delay between pages runs clean. */
export const CONCURRENCY = 1;

/** Between pages within a year. ~120 pages/year, so ~1 min per year. */
export const PAGE_DELAY_MS = 500;

/** Bulgarian notices exist from well before this, but the national corpus this
 *  is a cross-check FOR starts in 2011 and ЦАИС in 2020. 2015 gives ample
 *  overlap without crawling decades that nothing can be compared against. */
export const TED_FIRST_YEAR = 2015;

/** Requested per notice. Every one is verified to return data for BG notices —
 *  an unsupported field name makes the whole request 400, and a supported-but-
 *  empty one (winner-name, notice-identifier) silently returns nothing, so the
 *  set is deliberately small and checked rather than optimistic. */
export const TED_FIELDS = [
  "publication-number",
  "publication-date",
  "buyer-identifier",
  "buyer-name",
  "buyer-country",
  "notice-type",
  "contract-nature",
  "procedure-type",
  "classification-cpv",
  "total-value",
] as const;

export const tedQuery = (year: number): string =>
  `buyer-country=BGR AND publication-date>=${year}0101 AND publication-date<=${year}1231`;
