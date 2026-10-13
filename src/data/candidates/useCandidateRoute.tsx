import { useMps, type MpIndexEntry } from "@/data/parliament/useMps";
import { useCandidateName } from "./useCandidateName";
import {
  useResolvedCandidateWithFallback,
  type CandidateRouteResolution,
} from "./useCandidateElectionFallback";

export type CandidateRoute = CandidateRouteResolution & {
  /** The BG name sub-components key their data on; null when the URL names
   * nobody we can render (see `isResolving` / `isError` for why). */
  lookupName: string | null;
  /** The heading in the active locale. */
  displayName: string;
  /** Parliament roster entry for an `mp-<id>` that no election holds a
   * candidacy shard for — the main candidate page renders such an MP from the
   * roster and links its sub-routes, so they must resolve the same way. */
  rosterMp: MpIndexEntry | undefined;
};

/** The one resolution every /candidate/:id sub-route screen renders from:
 * the election-scoped candidate (with the cross-election fallback), then the
 * roster for an MP no election holds, then the bare name for a legacy URL. */
export const useCandidateRoute = (
  idParam: string | undefined | null,
): CandidateRoute => {
  const resolution = useResolvedCandidateWithFallback(idParam);
  const { canonical, parsed, notFound } = resolution;
  const { isEn, nameForBg, mpName } = useCandidateName();

  const mpIdParam = parsed?.kind === "mp" ? parsed.mpId : null;
  const needRoster = mpIdParam != null && notFound;
  const { findMpById, isLoading: rosterLoading } = useMps(needRoster);
  const rosterMp = needRoster ? findMpById(mpIdParam) : undefined;

  const lookupName =
    canonical?.name ??
    rosterMp?.name ??
    (parsed?.kind === "name" ? parsed.name : null);
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : rosterMp
      ? mpName(rosterMp)
      : nameForBg(lookupName);

  return {
    ...resolution,
    isResolving:
      resolution.isResolving || (needRoster && !rosterMp && rosterLoading),
    notFound: notFound && !rosterMp,
    lookupName,
    displayName,
    rosterMp,
  };
};
