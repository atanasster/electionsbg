// Shared matcher for the НЗОК gross drug-reimbursement ("Брутни разходи за
// лекарствени продукти по INN") XLS files on nhif.bg's medicine_food/
// quarter-payments/{year} listing pages — used by the writer and the watcher so
// a naming change on nhif.bg is a one-file edit (mirrors lib/bmp_links.ts).
//
// The include is "Брутни разходи". The exclusion mirrors the БМП path: drop a
// "МИ" (медицински изделия) / "изделия" sibling so a "Брутни разходи по МИ"-style
// file listed above the INN roll-up can't fingerprint as the drug file. The
// `(?<!\p{L})МИ(?!\p{L})` boundaries are Unicode-aware (JS `\b` is ASCII-only)
// and keep word-final "ми" (суми, програми) from matching under the `i` flag.

export interface DrugLink {
  /** Raw href as it appears in the HTML (still percent-encoded). */
  href: string;
  /** Decoded filename/path for human-readable matching + display. */
  name: string;
}

/** True for a decoded "Брутни разходи…" drug-reimbursement filename, excluding
 *  the МИ / изделия medical-devices siblings. */
export const isDrugReimbursementName = (name: string): boolean =>
  /Брутни\s+разходи/i.test(name) &&
  !/(?<!\p{L})МИ(?!\p{L})|изделия/iu.test(name);

/** All gross drug-reimbursement XLS links on a quarter-payments/{year} page, in
 *  document order (the page lists newest-first, so `[0]` is the latest file). */
export const drugReimbursementLinks = (html: string): DrugLink[] =>
  [...html.matchAll(/href="(\/upload\/[^"]+\.(?:xlsx|xls))"/gi)]
    .map((m) => ({ href: m[1], name: decodeURIComponent(m[1]) }))
    .filter((l) => isDrugReimbursementName(l.name));
