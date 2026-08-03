/**
 * Derive the ИСУН procedure code from a contract number.
 *
 * Lives in src/ rather than scripts/ because BOTH sides need the identical
 * rule: the ingest groups the corpus by it (scripts/funds/procedures.ts) and
 * the contract page links up to the procedure with it. Two copies would drift,
 * and the failure would be a link to a page that does not exist.
 *
 * `BG16RFOP002-2.089-3686-C01` → `BG16RFOP002-2.089`
 * `BG-RRP-1.015-0042`          → `BG-RRP-1.015`
 * `BG16RFOP002-2.073-19464`    → `BG16RFOP002-2.073`
 *
 * The ordinal is `\d{4,}`, not `\d{4}`: the mass COVID schemes ran past 9,999
 * projects, so 2.073 alone numbers up to five digits. Requiring exactly four
 * silently dropped 14,510 rows — 17.7% of the corpus, concentrated in the
 * single most-searched procedure on the site.
 *
 * `programCode` is optional and strips a trailing co-financing programme suffix
 * (`BG05M9OP001-2.018-0024-2014BG05M2OP001`), which 67 ESF rows carry.
 *
 * Returns null when the number carries no project ordinal at all — those rows
 * are left out of the grain rather than being given an invented procedure.
 */
export const procedureCodeOf = (
  contractNumber: string,
  programCode?: string,
): string | null => {
  let n = contractNumber.trim();
  if (programCode && n.endsWith(`-${programCode}`)) {
    n = n.slice(0, -(programCode.length + 1));
  }
  // The `-` before the ordinal is what makes the lazy prefix safe: it can only
  // cut at a real segment boundary, so a procedure code that itself ends in
  // digits (`…-2.073`) is never split mid-token.
  const m = /^(.+?)-(\d{4,})(?:-C\d+)?$/.exec(n);
  if (!m) return null;
  // Whitespace inside an ИСУН code is always an export typo, never meaningful:
  // 17 rows are published as `BGJUSTICE -1.001-0001` for programme `BGJUSTICE`.
  // Removing it recovers them; dropping them on the charset check below would
  // lose real contracts to a stray space.
  const code = m[1].replace(/\s+/g, "");
  // The code becomes a filename and a URL path segment. ИСУН numbers are
  // [-.0-9A-Z] by construction (verified at ingest for the by-contract shards),
  // but a malformed row must never escape into a path. `.` and `..` pass the
  // charset gate and would resolve to the shard directory itself, so they are
  // excluded explicitly rather than relying on the character class.
  if (code === "." || code === "..") return null;
  return /^[A-Za-z0-9.-]+$/.test(code) ? code : null;
};
