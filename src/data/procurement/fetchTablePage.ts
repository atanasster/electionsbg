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
  };
  return {
    rows: j.rows ?? [],
    total: typeof j.total === "number" ? j.total : null,
    totalExact: j.totalExact ?? false,
  };
};

export const fetchTablePage = async <T>(
  request: TablePageRequest,
): Promise<T[]> => (await fetchTablePageWithTotal<T>(request)).rows;
