// Resolve a ROSTER member id to the per-NS CSV id parliament.bg uses in the roll call.
//
// ⚠️ THE TWO ARE NOT THE SAME NUMBER, and treating them as one serves another member's
// record. parliament.bg RECYCLES member ids across parliaments — 26 of them name two
// genuinely different people, which load_rollcall_pg reports on every run — so a roster id
// (the deduped, latest-per-person id) is only usable against the roll call when it happens
// to be this parliament's id for that person too.
//
// Every roll-call route is keyed (ns, mp_id) on the CSV id for exactly that reason. Passing
// a roster id straight through would, for those 26, return the OTHER person's votes under
// this person's name — with nothing to notice, since both are real members with real records.
//
// This rule used to live inside useMpShard, which json-retirement-v2 Tier 2 deleted along
// with the 2,330-file per-MP shard tree it read. It is extracted rather than inlined into the
// three call sites because it is the kind of rule that goes wrong once per copy.

import { useMemo } from "react";
import { useMpProfile } from "./useMpProfile";

/**
 * @param rosterMpId the id the candidate page holds (roster, deduped across parliaments)
 * @param name       the member's name, used when the roster id is not this NS's id
 * @param enabled    false skips the roster fetch entirely
 * @returns the per-NS CSV id, or null when neither the id nor the name resolves
 */
export const useCsvId = (
  rosterMpId?: number | null,
  name?: string | null,
  enabled = true,
): { csvId: number | null; isLoading: boolean } => {
  const { mpNames, isLoading } = useMpProfile(enabled);

  // ⚠️ WAIT FOR THE ROSTER. Resolving against an EMPTY mpNames map cannot find the name and
  // falls straight through to the roster id, so a caller keys its query on that, then re-keys
  // when the roster lands — two fetches, and for the 18 measured (roster, ns) pairs whose
  // roster id is NOT this parliament's id, the first of them is for the WRONG PERSON. The
  // retired useMpShard had this guard; it was dropped when the rule was extracted and review
  // caught it.
  const profileReady = Object.keys(mpNames).length > 0;

  const csvId = useMemo(() => {
    if (!profileReady) return null;
    // The roster id IS this NS's id when the roll call knows it — the common case.
    if (rosterMpId != null && mpNames[String(rosterMpId)]) return rosterMpId;
    if (!name) return rosterMpId ?? null;
    const target = name.toLocaleLowerCase("bg");
    for (const [idStr, mpName] of Object.entries(mpNames)) {
      if (mpName.toLocaleLowerCase("bg") === target) {
        const n = Number(idStr);
        if (Number.isFinite(n)) return n;
      }
    }
    // Fall back to the roster id rather than to null: for a member the roll call has never
    // heard of, both answers are empty, and returning the id keeps the caller's query key
    // stable instead of collapsing every unknown member onto one cache entry.
    return rosterMpId ?? null;
  }, [rosterMpId, name, mpNames, profileReady]);

  return { csvId, isLoading };
};
