// Declared-wealth trajectory (090 person_wealth_series), served via /api/db/person-wealth.
// Lazily fetched by PersonWealthTrajectory so the wealth join stays off the profile's hot
// path. Kept out of the screen file so it exports only the hook (react-refresh).
//
// Every figure is already rounded server-side (090); the client never recomputes a number,
// only charts what the payload carries.

import { useEffect, useState } from "react";

export type WealthPoint = {
  year: number;
  assetsEur: number;
  debtsEur: number;
  netEur: number;
  incomeEur: number;
  filings: number;
  tier: string;
  byCategory: Record<string, number>;
};
export type WealthMarker = {
  year: number;
  type: string; // Entry | Vacate
  filedAt: string | null;
  institution: string | null;
  positionTitle: string | null;
};
export type PersonWealth = {
  slug: string;
  series: WealthPoint[];
  markers: WealthMarker[];
} | null;

export const usePersonWealth = (slug: string): PersonWealth | undefined => {
  const [wealth, setWealth] = useState<PersonWealth | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setWealth(undefined);
    if (!slug) {
      setWealth(null);
      return;
    }
    fetch(`/api/db/person-wealth?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: PersonWealth) => {
        if (live) setWealth(j && Array.isArray(j.series) ? j : null);
      })
      .catch(() => live && setWealth(null));
    return () => {
      live = false;
    };
  }, [slug]);
  return wealth;
};
