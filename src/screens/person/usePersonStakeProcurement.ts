// Declared company stakes whose company holds public contracts (audit T3.8), served via
// /api/db/person-stake-procurement (096 person_stake_procurement).
//
// Every row already passed 096's three gates: the declared company name bears on a trading
// company in the Търговски регистър that the register independently records THE DECLARED
// HOLDER at, exactly one such company survives that check, and that holder's folded name
// identifies exactly one active person. The declaration form carries no EIK, so an
// unresolved, ambiguous or namesake-risky stake is simply absent from this payload — there
// is no low-confidence tier for the client to render or filter. Why each absent one is
// absent IS available, separately and never as a link: useDeclaredStakeStatus.
//
// THE PERSON'S OWN STAKES ONLY. 096 also resolves holdings a filing attributes to a spouse
// or a child; this payload is money attributed to the subject, so it carries none of them.
// They surface on the Companies section, attributed to their holder and with no money.
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
  /** WHAT was declared: a shareholding, a management/board role, or a sole-tradership.
   *  Not cosmetic — this tile renders an ownership claim, so a `role` row must say so
   *  or it asserts something the filing does not. See declaration_stake (089). */
  stakeKind: "share" | "role" | "sole_trader" | null;
  /** The register's own heading for the row, for display beside the chip. */
  itemType: string | null;
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
