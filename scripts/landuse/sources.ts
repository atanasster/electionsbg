// Catalog of NSI LANDUSE press-release PDFs (English annex), one per
// reference year. The English annex is preferred because the parser
// keys on the 3-letter oblast codes (BLG, BGS, ...) printed at the
// left of every row — those codes are identical in the BG and EN
// versions, but the EN file's column headers are easier to recognise
// for cross-checking.
//
// Each release publishes once a year, typically early-to-mid June for
// the prior calendar-year reference date (31.12.YYYY). NSI does NOT
// host the PDFs at a stable URL — the filename carries an opaque
// 6-character token (`LANDUSE_<YYYY>_EN_<token>.pdf`). When a new
// release lands, the operator must:
//
//   1. Open https://www.nsi.bg/en/statistical-data/45 ("Land use
//      distribution of the Republic of Bulgaria")
//   2. Click into the latest press release listed under
//      `/en/press-release/land-use-distribution-...`
//   3. Right-click the linked PDF → copy URL
//   4. Add an entry below with the new year + URL
//
// The watcher (`scripts/watch/sources/nsi_landuse.ts`) flags when the
// upcoming-releases section on the statistical-data page changes
// (the row "8.06.YYYY → LANDUSE_<YYYY-1>" shifts out after publication).

export interface LandUseReport {
  year: number;
  publishedAt: string; // YYYY-MM, used for sort/display
  pdfUrl: string;
}

export const LANDUSE_REPORTS: LandUseReport[] = [
  {
    year: 2023,
    publishedAt: "2024-06",
    pdfUrl:
      "https://www.nsi.bg/sites/default/files/files/pressreleases/LANDUSE_2023_EN_CVO7F4B.pdf",
  },
];

/** Land-use category keys in the order NSI prints them in Tables 1 & 2.
 * The first column of each row is the total area, then the 8 categories.
 * Order matters — the parser pulls 9 trailing numeric tokens off each row.
 */
export const CATEGORY_KEYS = [
  "urbanized",
  "transport",
  "agricultural",
  "forest",
  "water",
  "protected",
  "disturbed",
  "unclassified",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORIES: {
  key: CategoryKey;
  bg: string;
  en: string;
}[] = [
  { key: "urbanized", bg: "Урбанизирани територии", en: "Urbanized areas" },
  { key: "transport", bg: "Транспорт", en: "Transport areas" },
  { key: "agricultural", bg: "Земеделски територии", en: "Agricultural areas" },
  { key: "forest", bg: "Горски територии", en: "Forest areas" },
  { key: "water", bg: "Водни обекти", en: "Waters and water bodies" },
  { key: "protected", bg: "Защитени територии", en: "Protected areas" },
  { key: "disturbed", bg: "Нарушени територии", en: "Disturbed areas" },
  { key: "unclassified", bg: "Некласифицирани", en: "Not classified" },
];
