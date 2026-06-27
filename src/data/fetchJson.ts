// Shared "soft-miss" JSON fetch for the data hooks. A real 404 (prod / GCS) and
// a Vite dev-server SPA-HTML fallback (200 serving index.html for a path that
// doesn't exist) both resolve to a MISS (null) instead of throwing — so a fresh
// clone (before `bucket:sync`) degrades gracefully instead of erroring. Used by
// the procurement + tender + my-area hooks. Co-locates the SubtleCrypto sha256
// the prefix-sharded stores hash their keys with.

export const fetchJsonSoft = async <T>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) return null; // genuine 404
  try {
    return (await r.json()) as T;
  } catch {
    return null; // dev SPA HTML / non-JSON ⇒ treat as a miss
  }
};

// Fetch a `{ [key]: T }` prefix-shard map and pick one entry (null on miss).
export const fetchJsonMap = async <T>(
  url: string,
  key: string,
): Promise<T | null> => {
  const map = await fetchJsonSoft<Record<string, T>>(url);
  return map?.[key] ?? null;
};

// Hex SHA-256 via Web Crypto — the prefix-sharded contract/tender stores key
// their shards on the first hex chars of this hash.
export const sha256hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
