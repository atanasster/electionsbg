// Builds the /education "По области" rows. Kept pure so the fallback path has a
// test: the deployed payload predates byOblastYear, so until the loader is
// re-run and shipped the table has to render from the latest-year-only
// byOblast, minus the trend columns, rather than showing an empty section.

import type { OblastRow } from "./OblastTrendTable";

interface ByOblast {
  oblast: string;
  avg: number;
  examinees: number;
  schools: number;
}

interface ByOblastYear {
  oblast: string;
  years: { year: number; avg: number; examinees: number; schools: number }[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

export const buildOblastRows = (
  byOblast: ByOblast[],
  byOblastYear: ByOblastYear[] | undefined,
  latestYear: number | null,
  name: (oblast: string) => string,
): OblastRow[] => {
  const series = new Map((byOblastYear ?? []).map((o) => [o.oblast, o.years]));

  return byOblast.map((o) => {
    // A one-year series carries no change; treat it like the no-trend fallback
    // rather than drawing a zero-length dumbbell.
    const years = series.get(o.oblast) ?? [];
    const first = years.length >= 2 ? years[0] : null;
    const last = years.length >= 2 ? years[years.length - 1] : null;
    return {
      oblast: o.oblast,
      name: name(o.oblast),
      firstYear: first?.year ?? latestYear ?? 0,
      firstAvg: first?.avg ?? null,
      latestYear: last?.year ?? latestYear ?? 0,
      // byOblast is the authority for the latest figure — the headline column
      // must not drift from the rest of the page if the two aggregation rules
      // ever diverge (they are asserted equal in schools_pg.data.test.ts). The
      // change is measured against that same number so the columns always add
      // up on screen: latest − first = delta, whatever the payload says.
      latestAvg: o.avg,
      delta: first != null && last != null ? r2(o.avg - first.avg) : null,
      examinees: o.examinees,
      schools: o.schools,
    };
  });
};
