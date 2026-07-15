// Shared fetch helper for the judiciary DB-backed hooks (useCourtLoad,
// useMagistrateHoldings): fetch JSON and throw on a non-OK response.
export const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
};
