// Shared fetch helpers for the PG-served ИСУН EU-funds payloads.
//
// Every /funds page now reads Cloud SQL via /api/db instead of the static JSON
// tree on the GCS bucket (the funds PG migration — mirrors procurement). The
// precomputed page payloads live verbatim in the `fund_payloads(kind, key)`
// table; per-beneficiary rollups and per-contract detail are served from
// `fund_beneficiaries` / `fund_projects`. A route returns the payload jsonb or
// `null` (HTTP 200, never 404) — `null` means the place / programme / entity has
// no funds activity, so the hooks render a nothing-friendly empty state exactly
// as they did on the old "404 → null" path.

const getJson = async <T>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`funds fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T | null;
};

/** A precomputed funds page payload by (kind, key). Omit `key` for singletons
 * (the corpus index, taxonomy, sankey, manifests, …). */
export const fetchFundPayload = <T>(
  kind: string,
  key?: string | null,
): Promise<T | null> => {
  const qs = key ? `&key=${encodeURIComponent(key)}` : "";
  return getJson<T>(`/api/db/fund-payload?kind=${kind}${qs}`);
};

/** Per-beneficiary rollup (FundsBeneficiary) for one EIK. */
export const fetchFundBeneficiary = <T>(eik: string): Promise<T | null> =>
  getJson<T>(`/api/db/fund-beneficiary?eik=${encodeURIComponent(eik)}`);

/** Per-contract detail (FundsProjectsContractFile) for one contract number. */
export const fetchFundContract = <T>(number: string): Promise<T | null> =>
  getJson<T>(`/api/db/fund-contract?key=${encodeURIComponent(number)}`);
