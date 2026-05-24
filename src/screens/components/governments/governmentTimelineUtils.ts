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
  // Snug right edge — use latestEnd exactly. Earlier versions padded out to
  // ceil(latestEnd) + 0.1 to leave breathing room past the rightmost tick,
  // but that pushed the CabinetStrip's last pill in by ~0.7 years' worth of
  // width, which read as wasted whitespace at the right of every page that
  // hosts the strip.
  return [Math.floor(earliest), latestEnd];
};
