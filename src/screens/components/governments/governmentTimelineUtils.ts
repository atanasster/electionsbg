import { Government } from "@/data/governments/useGovernments";

// Year fraction so that we can place dates on a numeric X axis. Jan 1 = .00,
// Dec 31 ≈ .997. Good enough for visual placement at year-resolution.
export const toFractionalYear = (iso: string): number => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
};

export const xDomainFor = (governments: Government[]): [number, number] => {
  const earliest = governments.length
    ? Math.min(...governments.map((g) => toFractionalYear(g.startDate)))
    : 2005;
  const latestEnd = governments.length
    ? Math.max(
        ...governments.map((g) =>
          toFractionalYear(g.endDate ?? new Date().toISOString()),
        ),
      )
    : new Date().getFullYear();
  return [Math.floor(earliest), Math.ceil(latestEnd) + 0.1];
};
