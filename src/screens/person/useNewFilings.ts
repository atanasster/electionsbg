// The site-wide new-filing feed (audit T3.10), served via /api/db/new-filings.
//
// The request is IDENTICAL for every reader — the watchlist is applied in the browser and
// never transmitted. Sending it would put the reader's political interests into the access
// log and into a shared CDN cache key, which is exactly what "we keep no record of who
// follows whom" is supposed to mean. See src/lib/watchlist.ts and migration 098.
//
// One fetch of the whole recent feed; /following renders it twice — filtered to the reader's
// follows, and whole (the site-wide "recently added" list). All money/dates come rendered
// from the server (098); the client never recomputes a figure.

import { useEffect, useState } from "react";

export type NewFilingRow = {
  slug: string;
  name: string;
  year: number;
  fiscalYear: number | null;
  declarationType: string;
  institution: string | null;
  positionTitle: string | null;
  /** When the filing entered OUR data — NOT when it was filed or published (098 pins it to
   *  Europe/Sofia). A backfill stamps decade-old filings with one recent date. */
  firstSeen: string;
  filedAt: string | null;
  sourceUrl: string;
};

export const useAllNewFilings = (limit = 200): NewFilingRow[] | undefined => {
  const [rows, setRows] = useState<NewFilingRow[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRows(undefined);
    fetch(`/api/db/new-filings?limit=${limit}`)
      .then((r) => r.json())
      .then((j: NewFilingRow[]) => live && setRows(Array.isArray(j) ? j : []))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [limit]);
  return rows;
};
