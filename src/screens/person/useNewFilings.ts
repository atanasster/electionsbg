// New-filing feed (audit T3.10), served via /api/db/new-filings.
//
// The request is IDENTICAL for every reader — the watchlist is applied here, in the browser,
// and never transmitted. Sending it would put the reader's political interests into the
// access log and into a shared CDN cache key, which is exactly what "we keep no record of
// who follows whom" is supposed to mean. See src/lib/watchlist.ts and migration 098.
//
// The bounded consequence: a followed person whose filing has dropped out of the recent
// window will not appear. That is the honest cost of not transmitting the list.

import { useEffect, useState } from "react";

export type NewFilingRow = {
  slug: string;
  name: string;
  year: number;
  fiscalYear: number | null;
  declarationType: string;
  institution: string | null;
  positionTitle: string | null;
  /** When the filing entered OUR data — NOT when it was filed or published. */
  firstSeen: string;
  filedAt: string | null;
  sourceUrl: string;
};

export const useNewFilings = (slugs: string[]): NewFilingRow[] | undefined => {
  const [rows, setRows] = useState<NewFilingRow[] | undefined>(undefined);
  const key = slugs.join(",");
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!key) {
      setRows([]);
      return;
    }
    fetch(`/api/db/new-filings?slugs=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j: NewFilingRow[]) => live && setRows(Array.isArray(j) ? j : []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [key]);
  return rows;
};
