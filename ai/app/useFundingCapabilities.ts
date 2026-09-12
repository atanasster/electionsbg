import { useEffect, useState } from "react";
import { fetchDb } from "../tools/dataClient";
import {
  FUNDING_VERSION,
  validateFundingQuery,
} from "../../src/lib/fundingQuery";
import { FUNDING_TEMPLATES } from "../../src/lib/questions/contracts/funding";
import type { QuestionCatalog } from "../../src/lib/questions/types";
export type FundingCapabilities = {
  version: string;
  corpora: Record<
    string,
    {
      ready: boolean;
      dates: string[];
      amounts: string[];
      predicates: string[];
      financialYears?: string[];
    }
  >;
};
export function fundingTemplateReady(
  id: string,
  cap: FundingCapabilities | null,
) {
  const t = FUNDING_TEMPLATES.find((t) => "funding-query-" + t.id === id);
  if (!t) return true;
  if (t.id === "S13")
    return (
      cap?.version === FUNDING_VERSION && !!cap.corpora.agriPayments?.ready
    );
  if (!t.query) return false;
  const parsed = validateFundingQuery(t.query);
  if (!parsed.ok) return false;
  const q = parsed.query,
    c = cap?.corpora[q.corpus];
  return (
    cap?.version === FUNDING_VERSION &&
    !!c?.ready &&
    c.dates.includes(q.dateBasis) &&
    c.amounts.includes(q.amountBasis) &&
    [
      ...((q.basePredicates as string[] | undefined) || []),
      ...((q.numeratorPredicates as string[] | undefined) || []),
    ].every((p) => c.predicates.includes(p.replace(/^!/, ""))) &&
    [
      ...((q.financialYears as string[] | undefined) || []),
      ...((q.compareFinancialYears as string[] | undefined) || []),
    ].every((y) => c.financialYears?.includes(y))
  );
}
export function useFundingCapabilities(
  catalog: QuestionCatalog,
): QuestionCatalog {
  const [cap, setCap] = useState<FundingCapabilities | null>(null);
  useEffect(() => {
    let active = true;
    void fetchDb<FundingCapabilities>("funding-capabilities")
      .then((c) => {
        if (active) setCap(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return {
    ...catalog,
    questions: catalog.questions.filter((q) => fundingTemplateReady(q.id, cap)),
  };
}
