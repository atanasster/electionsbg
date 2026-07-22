// One page of rows from the generic /api/db/table engine — the same request
// shape DbDataTable emits, for tiles that need a small fixed slice (latest
// contracts / latest tenders) without the full table chrome.

export interface TablePageRequest {
  resource: string;
  page: number;
  pageSize: number;
  sort: Array<{ id: string; desc: boolean }>;
  filters: {
    global?: string;
    /** Restrict the free-text `global` search to this subset of the resource's
     *  searchable columns (logical ids). Omit to search all `search:true`
     *  columns. The project-file seed passes `["title"]`/`["subject"]` so a
     *  landmark term matches the contract title / tender subject only, not
     *  entity-name columns. */
    globalCols?: string[];
    /** Drop the trigram `%>` word-similarity fallback from the free-text
     *  `global` match, leaving only the prefix-AND FTS arm. The default
     *  (false/omitted) keeps FTS+trigram — the typo-tolerant behaviour the
     *  interactive contracts/tenders browser relies on. The project-file seed
     *  sets this: its membership is decided by the Cyrillic-substring confidence
     *  gate, so the fuzzy arm never ADMITS a member — it only pulls unrelated
     *  high-value near-spellings (e.g. `планиране`/`проектиране` fuzzy-match a
     *  `-иране` term like `саниране`) into the `amount_eur DESC` seed window,
     *  inflating the "~N" banner count and starving the fixed seed budget so
     *  genuine low-value members are never fetched. FTS-only makes the banner
     *  honest and the seed budget spend on real matches. */
    globalFtsOnly?: boolean;
    columns: Array<{
      id: string;
      value?: unknown;
      min?: string | number;
      max?: string | number;
    }>;
  };
}

export interface TablePageResult<T> {
  rows: T[];
  /** Total rows matching the filters (before paging). Exact when the set is
   *  scoped/filtered/aggregated (the project-file seed always is); otherwise a
   *  reltuples estimate — read `totalExact` to tell which. `null` if absent. */
  total: number | null;
  totalExact: boolean;
  /** `sum(amount_eur)` over ALL rows matching the filters (before paging), from
   *  the engine's `sum` aggregate — the WHOLE-corpus contracted total for the
   *  filter, not just the returned page. `null` when the resource has no such
   *  aggregate. The program-total dossier mode reads this. */
  sumEur: number | null;
}

/** Fetch one page AND its total match count (the engine returns both). Used where
 *  the caller needs to know how many rows exist beyond the page it fetched — e.g.
 *  the project-file "показани N от ~M" truncation notice. */
export const fetchTablePageWithTotal = async <T>(
  request: TablePageRequest,
): Promise<TablePageResult<T>> => {
  const r = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(request))}`,
  );
  if (!r.ok) throw new Error(`table fetch failed: ${r.status}`);
  const j = (await r.json()) as {
    rows?: T[];
    total?: number;
    totalExact?: boolean;
    aggregates?: { sumAmountEur?: number };
  };
  return {
    rows: j.rows ?? [],
    total: typeof j.total === "number" ? j.total : null,
    totalExact: j.totalExact ?? false,
    sumEur:
      typeof j.aggregates?.sumAmountEur === "number"
        ? j.aggregates.sumAmountEur
        : null,
  };
};

export const fetchTablePage = async <T>(
  request: TablePageRequest,
): Promise<T[]> => (await fetchTablePageWithTotal<T>(request)).rows;
