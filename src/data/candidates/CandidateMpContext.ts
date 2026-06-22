import { createContext, useContext } from "react";
import { normalizeMpName } from "@/lib/utils";
import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";

/** The MP the candidate page has already resolved (from the URL slug +
 * per-candidate / per-MP shards). Provided so the page's many per-MP data
 * hooks can turn a `name` into an `id` — and read the roster entry — WITHOUT
 * each one independently downloading the ~950 KB parliament/index.json roster.
 *
 * Off the candidate page there's no provider, so the helpers below fall back to
 * the full roster exactly as before — every other screen is unaffected. */
type CandidateMp = {
  id: number;
  /** BG-form name the sub-components key their data by. */
  name: string;
  /** The resolved roster entry, when known (null only in degraded fallbacks). */
  entry: MpIndexEntry | null;
};

const CandidateMpContext = createContext<CandidateMp | null>(null);

export const CandidateMpProvider = CandidateMpContext.Provider;

export const useCandidateMp = (): CandidateMp | null =>
  useContext(CandidateMpContext);

const nameMatches = (ctx: CandidateMp | null, name?: string | null): boolean =>
  !!ctx && !!name && normalizeMpName(ctx.name) === normalizeMpName(name);

/** Resolve a name → MP id. On the candidate page the id is already known
 * (CandidateMpContext), so the ~950 KB roster fetch is skipped. Elsewhere this
 * falls back to a roster lookup, identical to the previous behaviour. */
export const useMpIdForName = (name?: string | null): number | null => {
  const ctx = useCandidateMp();
  const hit = nameMatches(ctx, name);
  const { findMpByName } = useMps(!hit); // roster only on a context miss
  return hit ? ctx!.id : (findMpByName(name)?.id ?? null);
};

/** Like {@link useMpIdForName} but also returns the full roster entry — for the
 * header + scorecard, which need `nsFolders` / party / region, not just the id.
 *
 * A CURRENT MP still needs the roster's `currentNs` label, so for those we let
 * the roster load; a former / off-ballot MP renders entirely from the context
 * entry, so the roster is never fetched. */
export const useMpEntryForName = (
  name?: string | null,
): {
  entry: MpIndexEntry | undefined;
  id: number | null;
  currentNs: string | undefined;
  isLoading: boolean;
} => {
  const ctx = useCandidateMp();
  const hit = nameMatches(ctx, name) && ctx!.entry != null;
  const needRoster = !hit || !!ctx!.entry!.isCurrent;
  const { findMpByName, currentNs, isLoading } = useMps(needRoster);
  const entry = hit ? ctx!.entry! : findMpByName(name);
  return {
    entry: entry ?? undefined,
    id: entry?.id ?? null,
    currentNs,
    isLoading: needRoster ? isLoading : false,
  };
};
