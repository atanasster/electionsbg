// Parliamentary GROUP short name → canonical party id.
//
// mp-party-affiliation-v1 §1. `person_role.party` speaks exactly one
// vocabulary — `canonical_parties.json` ids — because /persons renders it with
// `displayNameForId` and colours the row with `colorFor`, both keyed on that id
// (§0e). parliament.bg speaks a different one: a парламентарна група's short
// label, per-NS and unnormalised. This module is the bridge, and it is the
// whole precondition the resolver's own comment names when it refuses to
// persist the MP corroborant ("a parliamentary-GROUP short name, not a party
// id, and mixing the two in one column would make them look comparable").
//
// Resolution order, first hit wins:
//   1. `byNickName` exact                  — ГЕРБ, БСП, ВЪЗРАЖДАНЕ …
//   2. `byNickName` after normalisation    — ГЕРБ - СДС ≡ ГЕРБ-СДС
//   3. PARLIAMENT_GROUP_ALIASES → nickname — ПБ → ПрБ → p_20
//   4. sentinels → `independent`           — НЕЗ, НЕЧЛ В ПГ, НЕЧЛ ПГ
//   5. THROW
//
// Step 5 is the design. An unmapped group short that returned null would write
// NULL into the column, which is indistinguishable from "this parliament
// predates the roll-call corpus" (§1c: 1,559 MP roles are legitimately blank).
// A new parliament introducing a group nobody mapped would then be silent for a
// whole NS, in the one year nobody re-reads the plan. Failing the build is the
// only signal that survives that.
//
// Steps 1-3 return an id DERIVED from canonical_parties.json rather than a
// hard-coded one, so a regenerated table cannot leave a stale id behind. The
// only literal id here is the `independent` sentinel, which is a sentinel
// precisely because no lineage generates it.
//
// Pure: the caller supplies the index. `partyGroups.test.ts` runs it against
// the real one, and `loadCanonicalIndex()` is the convenience for callers that
// just want the file.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  INDEPENDENT_CANONICAL_ID,
  isGroupSentinel,
  resolveNicknameToId,
} from "@/data/parties/parliamentGroupAliases";

export { ambiguousNormalizedNicknames } from "@/data/parties/parliamentGroupAliases";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const loadCanonicalIndex = (): CanonicalPartiesIndex =>
  JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "data/canonical_parties.json"),
      "utf-8",
    ),
  ) as CanonicalPartiesIndex;

export class UnmappedGroupShortError extends Error {
  readonly short: string;
  constructor(short: string) {
    super(
      `unmapped parliamentary group short "${short}" — add it to ` +
        `PARLIAMENT_GROUP_ALIASES (src/data/parties/parliamentGroupAliases.ts) ` +
        `pointing at a nickname canonical_parties.json already carries, or to ` +
        `PARLIAMENT_GROUP_SENTINELS if it means "no group". Returning NULL is ` +
        `not an option: it is indistinguishable from a parliament the roll-call ` +
        `corpus does not cover.`,
    );
    this.name = "UnmappedGroupShortError";
    this.short = short;
  }
}

/**
 * Resolve a parliamentary group short name to a canonical party id.
 * Throws `UnmappedGroupShortError` when it cannot — never returns null.
 */
export const groupShortToCanonical = (
  short: string,
  index: CanonicalPartiesIndex,
): string => {
  const raw = short?.trim() ?? "";
  if (!raw) throw new UnmappedGroupShortError(short);

  // Sentinels FIRST. „НЕЗ" must never reach a party lookup — the point is that
  // it is the absence of affiliation, not a party that happens to be unmapped.
  if (isGroupSentinel(raw)) return INDEPENDENT_CANONICAL_ID;

  // The SHARED chain — the same call the browser makes. This module adds only
  // the two things the browser has no use for: the sentinel branch above, and
  // the throw below.
  const id = resolveNicknameToId(raw, index.byNickName);
  if (id) return id;

  throw new UnmappedGroupShortError(raw);
};
