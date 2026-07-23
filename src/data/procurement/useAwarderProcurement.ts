// Per-EIK procurement rollup — the same `awarder_procurement` SQL function the
// /company/:eik dashboard runs, fetched on its own for pages that want the
// headline figures without the whole company payload (/school/:id).
//
// Unscoped on purpose. The company page passes from/to and therefore shows a
// WINDOW (on a school with contracts back to 2014 it was reading €228.6k — the
// 2026 slice — with nothing on screen saying so). A tile that quotes one number
// has to quote the whole corpus and print the years it covers.

import { useQuery } from "@tanstack/react-query";

export interface AwarderYear {
  year: string;
  totalEur: number;
  contractCount: number;
}

export interface AwarderProcurement {
  name?: string;
  totalEur: number;
  contractCount: number;
  contractorCount: number | null;
  amendmentCount: number;
  byYear: AwarderYear[] | null;
}

export const useAwarderProcurement = (eik?: string | null) =>
  useQuery({
    queryKey: ["awarder-procurement", eik ?? ""],
    queryFn: async (): Promise<AwarderProcurement | null> => {
      const r = await fetch(
        `/api/db/awarder-procurement?eik=${encodeURIComponent(eik!)}`,
      );
      if (!r.ok) throw new Error("awarder-procurement fetch failed");
      return r.json(); // null when the EIK has no contracts
    },
    enabled: !!eik,
    staleTime: Infinity,
  });

/** First and last year the corpus holds for this buyer — the tile's footnote,
 *  so the total is never read as "this year" or "since forever". */
export const awarderYearSpan = (
  rows: AwarderYear[] | null | undefined,
): { from: number; to: number } | null => {
  // Number("") is 0, not NaN, so a blank year would pass a Number.isFinite
  // guard and print a span starting at year 0. Require four digits.
  const years = (rows ?? [])
    .filter((r) => /^\d{4}$/.test(String(r.year)))
    .map((r) => Number(r.year))
    .sort((a, b) => a - b);
  if (!years.length) return null;
  return { from: years[0], to: years[years.length - 1] };
};

/** The most recent year present, for the "latest year" line under the total. */
export const latestAwarderYear = (
  rows: AwarderYear[] | null | undefined,
): AwarderYear | null => {
  const sorted = [...(rows ?? [])].sort(
    (a, b) => Number(a.year) - Number(b.year),
  );
  return sorted[sorted.length - 1] ?? null;
};
