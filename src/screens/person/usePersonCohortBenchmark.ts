// Declared wealth relative to peers in the same office (audit T3.9), served via
// /api/db/person-cohort-benchmark (097 person_cohort_benchmark).
//
// A percentile is a description of a DECLARED number against other declared numbers — not a
// claim about where anything came from. `percentile` is null when the peer group for that
// year is smaller than 20, because on a handful of people the figure is one person's filing.

import { useEffect, useState } from "react";

export type CohortBenchmark = {
  cohort: string;
  year: number;
  netEur: number;
  peers: number;
  /** Withheld (null) below the 20-peer floor, together with `percentile`. */
  medianEur: number | null;
  /** Share of peers declaring strictly less. Null below 20 peers. */
  percentile: number | null;
} | null;

export const usePersonCohortBenchmark = (
  slug: string,
): CohortBenchmark | undefined => {
  const [data, setData] = useState<CohortBenchmark | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setData(undefined);
    if (!slug) {
      setData(null);
      return;
    }
    fetch(`/api/db/person-cohort-benchmark?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: CohortBenchmark) => {
        if (live)
          setData(j && typeof j === "object" && !Array.isArray(j) ? j : null);
      })
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [slug]);
  return data;
};
