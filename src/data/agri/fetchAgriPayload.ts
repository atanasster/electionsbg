// Fetch helpers for the PG-served ДФ „Земеделие" subsidy payloads.
//
// Every /subsidies page reads Cloud SQL via /api/db (mirrors funds). Precomputed
// page payloads live verbatim in agri_payloads(kind, key): 'overview' (key '' |
// 'all' | '<financial year>') for the national dashboard, 'recipient' (key =
// eik) for a per-legal-entity rollup.
//
// Two shapes of "nothing here", both surfaced to the hooks as `null` so they
// render an empty state rather than an error: a 200 carrying null (an entity
// with no subsidies) and a 404 (an overview scope that was never precomputed —
// see the agri-payload route for why that one is not a 200). Any other non-2xx
// still throws.

const getJson = async <T>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
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
