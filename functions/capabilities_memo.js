// Per-instance memo for the three *-capabilities routes.
//
// The chat page fetches all three on open, and each one is a chain of readiness probes over
// whole corpora: measured on Cloud SQL 2026-11-26, funding-capabilities ran ~15 queries in
// sequence for 5–8.6 s on every request. With no-store at the edge (db_cache_policy.js) every
// visitor paid that in full and held one of the pool's connections for the whole time, so the
// chat's own ~25-request fan-out queued behind it.
//
// The answer only moves when a loader publishes, so a short in-process TTL keeps it within a
// few minutes of the database while the edge stays no-store. Concurrent misses share ONE
// in-flight probe. The rollback switches are part of the key, so flipping one takes effect on
// the next request rather than after the TTL. Failures are never kept.
const TTL_MS = 5 * 60 * 1000;
const FLAGS = [
  "FUNDING_QUERY_DISABLED",
  "PROCUREMENT_QUERY_DISABLED",
  "ROLLCALL_QUERY_DISABLED",
];
const memo = new Map();

const memoCapabilities = (name, fn) => async (dbRows, q) => {
  const key = `${name}|${FLAGS.map((f) => process.env[f] || "").join("|")}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = fn(dbRows, q);
  const entry = { value, expiresAt: now + TTL_MS };
  memo.set(key, entry);
  const evict = () => {
    if (memo.get(key) === entry) memo.delete(key);
  };
  value.then((r) => {
    if (r?.status && r.status >= 400) evict();
  }, evict);
  return value;
};

const __resetCapabilitiesMemo = () => memo.clear();

module.exports = { memoCapabilities, __resetCapabilitiesMemo, CAPABILITIES_TTL_MS: TTL_MS };
