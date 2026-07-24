// Declared company stakes whose company holds public contracts (audit T3.8), served via
// /api/db/person-stake-procurement (096 person_stake_procurement).
//
// Every row already passed 096's three gates: the declared company name resolves to exactly
// one TRADING company in the Търговски регистър, the registry independently records this
// person at that EIK, and the person's folded name is not shared by another active person
// (so that registry match identifies one individual). The declaration form carries no EIK,
// so an unresolved, ambiguous or namesake-risky stake is simply absent from this payload —
// there is no low-confidence tier for the client to render or filter.
//
// All money is rounded server-side; the client never recomputes a figure.

import { useEffect, useState } from "react";

export type StakeProcurementRow = {
  eik: string;
  /** The REGISTRY's canonical name — the headline, because the EIK is inferred and the
   *  reader needs to see what the match resolved to. */
  companyName: string | null;
  /** The declarant's own spelling, shown alongside so the two can be compared. */
  declaredName: string | null;
  shareSize: string | null;
  /** First / last period the person declared holding this stake. The aligned figures below
   *  cover this span contiguously, so the rendered range and the arithmetic agree. */
  firstYear: number | null;
  lastYear: number | null;
  contractCount: number;
  totalEur: number;
  /** Contracts recorded while the person declared holding the stake — the time-aligned
   *  subset. A company sold years before a contract lands in totalEur only. */
  whileDeclaredCount: number;
  whileDeclaredEur: number;
};

export const usePersonStakeProcurement = (
  slug: string,
): StakeProcurementRow[] | undefined => {
  const [rows, setRows] = useState<StakeProcurementRow[] | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!slug) {
      setRows([]);
      return;
    }
    fetch(`/api/db/person-stake-procurement?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: StakeProcurementRow[]) => {
        if (live) setRows(Array.isArray(j) ? j : []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug]);
  return rows;
};
