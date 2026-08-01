// The two portfolio cuts for a resolved person (slug), served via /api/db/person-breakdowns
// (person_procurement_by_company_slug / _by_settlement_slug, migration 125). Kept off
// person_by_slug's hot path — a lazy fetch like usePersonStakeProcurement, mounted only when
// the person actually has procurement. The EIK set is the 082 basis (person_role, high
// confidence), so these reconcile with person_by_slug's procuredEur.

import { useEffect, useState } from "react";

export type PersonCompanyCut = {
  eik: string;
  name: string | null;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};
export type PersonSettlementCut = {
  ekatte: string | null;
  settlement: string | null;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};
export type PersonBreakdowns = {
  byCompany: PersonCompanyCut[];
  bySettlement: PersonSettlementCut[];
};

export const usePersonBreakdowns = (
  slug: string,
): PersonBreakdowns | undefined => {
  const [data, setData] = useState<PersonBreakdowns | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setData(undefined);
    if (!slug) {
      setData({ byCompany: [], bySettlement: [] });
      return;
    }
    fetch(`/api/db/person-breakdowns?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: PersonBreakdowns) => {
        if (live)
          setData({
            byCompany: Array.isArray(j?.byCompany) ? j.byCompany : [],
            bySettlement: Array.isArray(j?.bySettlement) ? j.bySettlement : [],
          });
      })
      .catch(() => live && setData({ byCompany: [], bySettlement: [] }));
    return () => {
      live = false;
    };
  }, [slug]);
  return data;
};
