// The unified declaration list for a person (090 person_declarations), served via
// /api/db/person-declarations. One payload spanning every tier the person filed in
// (MP / executive / municipal / magistrate) — this is what lets ONE block replace the
// three divergent per-tier renderers (audit T3.3, retiring D9). declaration_detail(id)
// backs the per-filing drill-down.
//
// All money is rounded server-side (090); the client never recomputes a figure. The list
// also arrives in byRecency order (the comparator person_wealth_year ranks by), so the
// consumer selects the representative filing rather than re-deriving the sort.

import { useEffect, useState } from "react";

export type DeclarationListItem = {
  id: number;
  tier: string;
  year: number;
  fiscalYear: number | null;
  type: string; // Annualy | Entry | Vacate | Other
  institution: string | null;
  positionTitle: string | null;
  filedAt: string | null;
  sourceUrl: string;
  assetsEur: number;
  debtsEur: number;
  /** assets − debts, computed server-side on the same basis as person_wealth_year so
   *  the block and the chart cannot publish different figures. */
  netEur: number;
  assetCount: number;
  stakeCount: number;
  eventCount: number;
};

export const usePersonDeclarations = (
  slug: string,
): DeclarationListItem[] | undefined => {
  const [rows, setRows] = useState<DeclarationListItem[] | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!slug) {
      setRows([]);
      return;
    }
    fetch(`/api/db/person-declarations?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: DeclarationListItem[]) => {
        if (live) setRows(Array.isArray(j) ? j : []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug]);
  return rows;
};

export type DeclarationDetail = {
  id: number;
  tier: string;
  declarantName: string;
  year: number;
  fiscalYear: number | null;
  type: string;
  institution: string | null;
  positionTitle: string | null;
  filedAt: string | null;
  sourceUrl: string;
  assets: {
    category: string;
    description: string | null;
    detail: string | null;
    location: string | null;
    municipality: string | null;
    areaSqm: number | null;
    acquiredYear: number | null;
    share: string | null;
    valueEur: number | null;
    holderName: string | null;
    isSpouse: boolean;
  }[];
  income: {
    category: string | null;
    eurDeclarant: number | null;
    eurSpouse: number | null;
  }[];
  stakes: {
    tableNum: string;
    companyName: string | null;
    companySlug: string | null;
    holderName: string | null;
    transfereeName: string | null;
    shareSize: string | null;
    valueEur: number | null;
    registeredOffice: string | null;
  }[];
  events: {
    kind: string;
    description: string | null;
    detail: string | null;
    location: string | null;
    municipality: string | null;
    valueEur: number | null;
    legalBasis: string | null;
  }[];
} | null;

// Fetched lazily only when a filing row is expanded — the detail join is heavier than
// the list, so it stays off the initial render.
export const useDeclarationDetail = (
  id: number | null,
): DeclarationDetail | undefined => {
  const [detail, setDetail] = useState<DeclarationDetail | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    if (id == null) return;
    fetch(`/api/db/declaration-detail?id=${id}`)
      .then((r) => r.json())
      .then((j: DeclarationDetail) => live && setDetail(j ?? null))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [id]);
  return detail;
};
