// The budget document corpus behind /budget/law.
//
// Plan: docs/plans/budget-hub-v1.md §7.4.
//
// TWO SCOPES IN ONE PAYLOAD, and conflating them is the page's main hazard:
// `rows` is the requested YEAR, while `obsCategoriesPresent` is site-WIDE. They
// genuinely have to differ — the only in-year-report record (the КФП feed)
// carries no fiscal year at all, so it appears in no year's rows while being
// legitimately present in the frame.

import { useQuery } from "@tanstack/react-query";

export interface BudgetDocumentRow {
  documentId: string;
  fiscalYear: number | null;
  kind: string;
  titleBg: string | null;
  publishedOn: string | null;
  url: string | null;
  /** One of the eight OBS slots, or null for a kind that maps to none. */
  obsCategory: string | null;
  /** The roll-call item that adopted it. NULL on every row in the corpus
   *  today — the link is unresolved ingest work, not a rendering choice — so
   *  no consumer may present its absence as „adopted without a vote". */
  adoptedByItemId: string | null;
}

/** The requested year's КФП reporting coverage — the journey's middle stage.
 *  NULL for a year the feed does not reach: `budget_fiscal_year` starts at 2021
 *  while the document corpus starts at 2018, so „no coverage" means the
 *  execution feed has no such year, NOT that nothing was executed. */
export interface BudgetDocumentCoverage {
  monthsAvailable: number;
  /** Whether the year has CLOSED. The one absence the page may assert — „the
   *  year is still running" is a fact about the calendar, where „the report is
   *  missing" would be a claim about МФ. */
  complete: boolean;
  firstPeriod: string | null;
  lastPeriod: string | null;
  asOf: string | null;
}

export interface BudgetDocuments {
  fiscalYear?: number | null;
  rows: BudgetDocumentRow[];
  /** Distinct non-null `obs_category` across EVERY year, not the requested
   *  one. Absent on the route's degraded sentinel. */
  obsCategoriesPresent?: string[] | null;
  /** Absent on the degraded sentinel, and null for a pre-2021 year. */
  coverage?: BudgetDocumentCoverage | null;
}

/** The route is `budget-law`, NOT `budget-documents` — it is named for the page
 *  rather than for the SQL function `budget_documents()` behind it. Getting it
 *  wrong is not an error a consumer sees: `/api/db/<anything>` answers
 *  `{"error": "unknown /api/db endpoint"}` at a **200**, so the hook returns a
 *  well-formed object with no rows and the page renders its empty state. */
const fetchDocuments = async (
  fy: number | null,
): Promise<BudgetDocuments | null> => {
  const qs = fy == null ? "" : `?fy=${fy}`;
  try {
    const res = await fetch(`/api/db/budget-law${qs}`);
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetDocuments & { error?: string };
    // A 200 carrying `error` is the unknown-endpoint answer, not data.
    if (body?.error || !Array.isArray(body?.rows)) return null;
    return body;
  } catch {
    return null;
  }
};

/** ⚠️ NOT `useBudgetDocuments` — that name is already taken by the shard-backed
 *  hook in `useBudget.tsx` that `/budget` itself uses. Two hooks with one name
 *  in one directory is an import waiting to pick the wrong one. Named for the
 *  route it calls, `/api/db/budget-law`. */
export const useBudgetLawDocuments = (fy: number | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-documents", fy] as const,
    queryFn: () => fetchDocuments(fy),
    // `enabled`, like every sibling hook. Without it a null `fy` calls the
    // route UNFILTERED, and `budget_documents(NULL)` returns all 33 rows across
    // ten fiscal years — rendered under „Публикувано за  г." (i18next
    // interpolates the null as an empty string). Transient on every cold load,
    // since `fy` is null until hub-stats answers, and PERMANENT whenever
    // hub-stats fails, because it degrades to null.
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { documents: data ?? null, isLoading };
};
