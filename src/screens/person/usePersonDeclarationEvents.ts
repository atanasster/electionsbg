// Disposals & third-party expenses for one person (093 person_declaration_events), served
// via /api/db/person-declaration-events. Register facts about a filing, so public-figure
// gated server-side but not cohort-gated. Money is rounded server-side.

import { useEffect, useState } from "react";

export type DeclarationEventRow = {
  kind: string; // disposal_property | disposal_vehicle | third_party_expense | guarantee
  year: number; // the year the filing was made
  /** The period the filing covers, VERBATIM from the register — null when it does not say.
   *  Deliberately not a computed "event year": declaration_year equals fiscal_year + 1 only
   *  for annual filings, so subtracting one mislabels every Entry/Vacate/Other. */
  fiscalYear: number | null;
  declarationType: string | null;
  institution: string | null;
  positionTitle: string | null;
  description: string | null;
  detail: string | null;
  location: string | null;
  municipality: string | null;
  areaSqm: number | null;
  valueEur: number | null;
  legalBasis: string | null;
  sourceUrl: string;
};

export const usePersonDeclarationEvents = (
  slug: string,
): DeclarationEventRow[] | undefined => {
  const [rows, setRows] = useState<DeclarationEventRow[] | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!slug) {
      setRows([]);
      return;
    }
    fetch(`/api/db/person-declaration-events?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: DeclarationEventRow[]) => {
        if (live) setRows(Array.isArray(j) ? j : []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug]);
  return rows;
};
