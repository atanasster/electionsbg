// The URL-mirror interval for a registry hero search field, and the argument for it.
//
// ⚠️ THE REASONING IS SHARED; THE NUMBER IS NOT REQUIRED TO BE. It was written for /persons,
// copied byte-identically into /companies, and it is not a page-specific argument at all — it
// is a statement about the search path `RegistrySearchField` now owns. Two verbatim copies
// meant a correction to the reasoning would land on one page and not the other, far enough
// apart that a reviewer sees only one. A page that genuinely wants a different interval against
// a different corpus size should re-export this with a one-line note saying why, rather than
// restating the paragraph.

/** How long a registry hero field's value waits before it is written to `?q`.
 *
 *  Named rather than inlined so a test can advance timers by the value the screen actually
 *  uses. One of THREE intervals in the search path, all with different jobs: none in the field
 *  itself (the box must never lag the keyboard), this one to the URL (bounding router churn),
 *  and 250 ms inside `DbDataTable` to the engine (where the SEARCH_MIN_CHARS contract lives).
 *  Merging any two couples an SEO/navigation concern to a query-cost one. */
export const REGISTRY_URL_MIRROR_MS = 350;
