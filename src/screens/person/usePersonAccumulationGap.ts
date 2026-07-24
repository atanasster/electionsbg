// The accumulation gap for one person (092 person_accumulation_gap), served via
// /api/db/person-accumulation-gap.
//
// The COHORT GATE lives server-side: the function returns null for anyone outside
// accountability_senior (091) and for a person with fewer than two asset-bearing filings.
// So `null` here means "must not be shown", and the component renders nothing — there is
// deliberately no client-side cohort check that could drift from the SQL one.
//
// Every figure is rounded server-side; the client computes nothing.

import { useEffect, useState } from "react";

export type AccumulationGap = {
  slug: string;
  fromYear: number;
  toYear: number;
  years: number;
  fromNetEur: number;
  toNetEur: number;
  deltaNetEur: number;
  declaredIncomeEur: number;
  gapEur: number;
  /** Real-estate rows the declarant left unvalued across the span. Each counts as €0 in
   *  net worth, so a non-zero count means the gap is not a precise figure — the
   *  methodology requires it to be shown alongside. */
  unvaluedRealEstate: number;
} | null;

export const usePersonAccumulationGap = (
  slug: string,
): AccumulationGap | undefined => {
  const [gap, setGap] = useState<AccumulationGap | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setGap(undefined);
    if (!slug) {
      setGap(null);
      return;
    }
    fetch(`/api/db/person-accumulation-gap?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: AccumulationGap) => {
        if (live) setGap(j && typeof j === "object" && j.slug ? j : null);
      })
      .catch(() => live && setGap(null));
    return () => {
      live = false;
    };
  }, [slug]);
  return gap;
};
