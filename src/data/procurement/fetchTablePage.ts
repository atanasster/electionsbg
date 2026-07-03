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
    columns: Array<{
      id: string;
      value?: unknown;
      min?: string | number;
      max?: string | number;
    }>;
  };
}

export const fetchTablePage = async <T>(
  request: TablePageRequest,
): Promise<T[]> => {
  const r = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(request))}`,
  );
  if (!r.ok) throw new Error(`table fetch failed: ${r.status}`);
  const j = (await r.json()) as { rows?: T[] };
  return j.rows ?? [];
};
