// Fetch helpers for the PG-served ДФ „Земеделие" subsidy payloads.
//
// Every /subsidies page reads Cloud SQL via /api/db (mirrors funds). Precomputed
// page payloads live verbatim in agri_payloads(kind, key): 'overview' (key '')
// for the national dashboard, 'recipient' (key = eik) for a per-legal-entity
// rollup. A route returns the payload jsonb or `null` (HTTP 200, never 404) —
// `null` means the entity has no subsidies, so hooks render an empty state.

const getJson = async <T>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`agri fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T | null;
};

/** A precomputed subsidies payload by (kind, key). Omit `key` for the overview
 *  singleton. */
export const fetchAgriPayload = <T>(
  kind: string,
  key?: string | null,
): Promise<T | null> => {
  const qs = key ? `&key=${encodeURIComponent(key)}` : "";
  return getJson<T>(`/api/db/agri-payload?kind=${kind}${qs}`);
};
