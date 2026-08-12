// Can the site say, as a fact, that it holds no roll-call vote for an MP's terms?
//
// Its own module rather than a corner of nsFolders.ts: the answer does NOT come from the
// МИР/NS crosswalk there, and pairing the file with its test is the repo convention.

/** The earliest parliament the roll-call corpus reaches. Its first sitting on file is
 *  {@link ROLLCALL_FIRST_SITTING}, but the 44th CONVENED in 2017 — only its last five
 *  months are held — so this is the first NS with ANY coverage, not with full coverage.
 *  That distinction is the whole reason `nsFolders` cannot answer the question below. */
export const ROLLCALL_FIRST_NS = 44;

/** First sitting in the corpus. Beside the NS so a backfill moves both together — every
 *  user-facing sentence about the boundary interpolates from here rather than spelling it. */
export const ROLLCALL_FIRST_SITTING = "2020-10-28";

/** Can this MP have a roll-call record at all?
 *
 *  `true`  — they are in the corpus, or we cannot rule it out.
 *  `false` — PROVEN absent: the corpus has no seat for them under any id or spelling, and
 *            every parliament they sat in predates it. The page may state this.
 *  `null`  — unknown. Say nothing.
 *
 *  ── WHY `hasRollcall` IS REQUIRED AND `nsFolders` IS NOT ENOUGH ──────────────────────
 *
 *  `nsFolders` is the ROSTER's view of a career, and `mp_profile` / `mp_seat` are partly
 *  disjoint id spaces — 527 seat ids have no profile row, and the same human is routinely
 *  one id in each. Measured against the live corpus: 293 profiles have max(nsFolders) < 44,
 *  and **70 of them (24%) are in `mp_seat` anyway**, nearly all at NS 44 — the parliament
 *  that straddles the boundary. Жельо Иванов Бойчев is profile 2671 with `{42,43}` and seat
 *  779 at NS 44.
 *
 *  Reasoning from `nsFolders` alone therefore told those 70 that no roll-call exists for
 *  their terms while the site held their votes — publishing OUR identity-linking gap as the
 *  National Assembly's failure to publish, which is the precise inversion this helper's
 *  asymmetry exists to prevent. `hasRollcall` (mp_entry, 105) is the authoritative answer.
 *
 *  ── THE ASYMMETRY ───────────────────────────────────────────────────────────────────
 *
 *  Both conditions must agree before `false` is returned, and each can independently force
 *  silence. That is deliberate: `false` is the only value a caller may state as fact, so
 *  every uncertain path — a route that predates the field, a loading entry, an absent
 *  parliament list (1,263 of 2,122 MPs on file) — collapses to `null`. The failure
 *  direction is silence, never a claim.
 */
export const rollcallCoverage = (
  nsFolders?: readonly string[] | null,
  /** From `mp_entry().hasRollcall`. `undefined` on a serving DB whose 105 predates the
   *  field — treated as "unknown", never as "absent". */
  hasRollcall?: boolean | null,
): boolean | null => {
  // In the corpus: nothing to explain, and no arithmetic may overrule it.
  if (hasRollcall === true) return true;
  // The route cannot answer yet. Silence, not inference — this is the guard that keeps a
  // stale deploy from reviving the 70-MP falsehood.
  if (hasRollcall == null) return null;

  const ns = (nsFolders ?? [])
    .map((f) => Number.parseInt(f, 10))
    .filter((n) => Number.isFinite(n));
  if (ns.length === 0) return null;
  return ns.some((n) => n >= ROLLCALL_FIRST_NS);
};
