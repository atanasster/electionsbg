// The newest quarter a МФ release's FILENAME mentions, as "YYYY-QN".
//
// Shared by the ingest (to find the newest workbook before parsing) and the
// pipeline's done-check (to tell whether the due quarter's workbook has been
// dropped). МФ names its releases inconsistently — „…Q22025-Q42025-Q22026-
// website.xlsx", „quarterly reports Q32021-Q42021-Q32022.xlsx", a „1. "
// prefix, `-site`, `za saita` — so the only stable signal is the quarter
// tokens themselves, and the release covers up to the HIGHEST one.

export const newestQuarterOf = (f: string): string => {
  const found = [...f.matchAll(/Q([1-4])[- ]?(\d{4})/gi)].map(
    (m) => `${m[2]}-Q${m[1]}`,
  );
  return found.sort().slice(-1)[0] ?? "";
};
