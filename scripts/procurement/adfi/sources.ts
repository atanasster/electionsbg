// АДФИ inspection reports (plan P7). Two listings, split by a statutory date —
// the agency reorganised its publication duty on 9.2.2024 and the pages have
// different shapes, which is why they are declared rather than discovered.

export const ADFI_BASE = "https://adfi.minfin.bg";

export type AdfiPage = {
  readonly id: string;
  readonly url: string;
  readonly label: string;
  /** `table` = the post-9.2.2024 listing, a real HTML table of 1,965 reports.
   *  `links` = the pre-9.2.2024 archive, which is a bare list of PDF links with
   *  no subject column — parseable for existence but NOT for „who". */
  readonly shape: "table" | "links";
};

export const ADFI_PAGES: readonly AdfiPage[] = [
  {
    id: "after_2024",
    url: `${ADFI_BASE}/bg/34`,
    label: "Доклади от финансови инспекции, възложени след 9.2.2024",
    shape: "table",
  },
] as const;

/** ⚠️ THE PRE-2024 ARCHIVE IS DELIBERATELY NOT INGESTED. `/bg/18`
 *  („Информация за финансови инспекции, възложени до 9.2.2024") carries 61 PDF
 *  links and NO subject column — the inspected body is inside each PDF. Ingesting
 *  it would produce rows that say an inspection happened without saying to whom,
 *  which on this dataset is worse than absence: a reader would take the count as
 *  the number of inspections we can attribute. Coverage is declared instead. */
export const ADFI_COVERAGE = {
  from: "2024-02-09",
  note: "инспекции, възложени след 9.2.2024",
  archiveUrl: `${ADFI_BASE}/bg/18`,
  archiveNote:
    "по-ранните инспекции са публикувани само като PDF без колона за обекта",
} as const;

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";
