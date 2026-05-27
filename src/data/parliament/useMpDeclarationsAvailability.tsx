import { useMemo } from "react";
import { useConnectionsRankings } from "./useConnectionsRankings";
import { useAssetsRankings } from "./useAssetsRankings";
import { useMpCars } from "./useMpCars";
import { useMps } from "./useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "./nsFolders";

// Returns whether the MP declarations dashboard section has any region-scoped
// content to show. Nationwide pages always get `true`; regional pages get
// `true` while data is loading, then `true`/`false` once the underlying
// rankings/cars are resolved. Lets parents hide the entire section header
// when none of MpConnectionsTile / CarMakesTile / MpAssetsTile would render.
//
// Mirrors what the tiles do — for regional scope they read the full rankings
// files (not the top-50 slim variants), since most oblasts don't crack the
// national top-50.
export const useRegionDeclarationsHasContent = (params: {
  regionCode?: string;
  regionCodes?: string[];
}): boolean => {
  const { regionCode, regionCodes } = params;
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();

  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const codes = useMemo(() => {
    if (regionCodes && regionCodes.length > 0) return regionCodes;
    if (regionCode) return [regionCode];
    return null;
  }, [regionCode, regionCodes]);

  const isRegional = codes != null;

  const regionMpIds = useMemo(() => {
    if (!codes || !selectedFolder) return null;
    const ids = new Set<number>();
    for (const code of codes) {
      const mir = oblastToMir(code);
      if (!mir) continue;
      for (const m of findMpsByRegion(mir, selectedFolder)) ids.add(m.id);
    }
    return ids;
  }, [codes, selectedFolder, findMpsByRegion]);

  const { rankings: connRankings } = useConnectionsRankings({
    enabled: isRegional,
  });
  const { rankings: assetRankings } = useAssetsRankings({
    enabled: isRegional,
  });
  const { mpCars } = useMpCars({ enabled: isRegional });

  return useMemo(() => {
    if (!isRegional) return true;
    if (!regionMpIds || regionMpIds.size === 0) return false;
    // Stay visible while any source is still loading so the header doesn't
    // pop in after the tiles. Once everything resolves, hide if none has a
    // row for this region's MPs.
    if (!connRankings || !assetRankings || !mpCars) return true;
    const hasConn = connRankings.topMps.some((m) => regionMpIds.has(m.mpId));
    const hasAssets = assetRankings.topMps.some((m) => regionMpIds.has(m.mpId));
    const hasCars = mpCars.cars.some((c) => c.make && regionMpIds.has(c.mpId));
    return hasConn || hasAssets || hasCars;
  }, [isRegional, regionMpIds, connRankings, assetRankings, mpCars]);
};
