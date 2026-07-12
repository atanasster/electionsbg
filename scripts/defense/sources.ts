// Single source of truth for the defense ingest URLs, shared by the watchers
// (scripts/watch/sources/*.ts) and the update-defense skill's parsers, so the
// watcher and the parser can never drift onto different pages. See
// docs/plans/defense-pack-v1.md §Part-5.

/** NATO annual "Defence Expenditure of NATO Countries" news/press listing. The
 *  PDF filename carries the year range (def-exp-YYYY-en.pdf) and changes yearly,
 *  so the watcher fingerprints the latest PDF link on this page. */
export const NATO_DEFEXP_PAGE =
  "https://www.nato.int/en/what-we-do/introduction-to-nato/defence-expenditures-and-natos-5-commitment";

/** МО budget/report documents page (доклад за състоянието на отбраната +
 *  programme-budget execution). */
export const MOD_DOCS_PAGE = "https://www.mod.bg/doc8";

/** Ministry of Economy — annual report on the control of the export of defence-
 *  related products (mirrored via SIPRI national reports when МИ is WAF-blocked). */
export const MOE_EXPORT_PAGE =
  "https://www.sipri.org/databases/national-reports/Bulgaria";
