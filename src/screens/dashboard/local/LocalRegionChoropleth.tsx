// The município choropleth for ONE oblast — the body of `LocalRegionMapTile`, extracted so the
// election shell's `local/region/winner` adapter draws the SAME map rather than a second one.
//
// ⚠ EXTRACTED, NOT COPIED, AND THE REASON IS THE USUAL ONE. The tile still renders below the
// canvas on `/local/:cycle/region/:oblast`, so the page shows this map twice — once in the
// shell's map slot beside the ranked result and once in its own `StatCard`. Two independent
// implementations would be two answers to „who leads each município", diverging first on the
// cases nobody clicks: an unelected mayor, a município with no council row, Sofia.
//
// ⚠ IT READS THE ROLL-UP THE PAGE ALREADY HAS. `useLocalRegion(oblast, cycle)` is
// `data/<cycle>/region/<oblast>.json` — the file the region dashboard fetches for its tables —
// so the map costs one geo fetch and no data fetch at all. That is what makes this level cheap
// where the presidential one is not: the local tree is sharded per oblast and the presidential
// tree is one whole-country file per level.
//
// ⚠ `ariaLabelOf` IS NOT DECORATION. `FeatureMap` derives keyboard access as
// `!!ariaLabel && !!onClick`, so without it every município here is mouse-only — the fill, the
// tooltip and the drill-through all work and a keyboard reaches none of them.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMunicipalitiesMap } from "@/data/municipalities/useMunicipalitiesMap";
import type { MunicipalityJSONProps } from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import { useLocalRegion } from "@/data/local/useLocalRegion";
import type { LocalRegionMunicipalityRow } from "@/data/local/types";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";
import type { LocalMapMetric } from "./LocalRegionsControlMapTile";

export const LocalRegionChoropleth: FC<{
  size: MapCoordinates;
  cycle: string;
  oblast: string;
  metric: LocalMapMetric;
}> = ({ size, cycle, oblast, metric }) => {
  const { t } = useTranslation();
  const mapGeo = useMunicipalitiesMap(oblast);
  const { data: region } = useLocalRegion(oblast, cycle);
  const isMayor = metric === "mayor";

  const byMuni = useMemo(() => {
    const m = new Map<string, LocalRegionMunicipalityRow>();
    for (const r of region?.municipalities ?? []) m.set(r.obshtinaCode, r);
    return m;
  }, [region]);

  /** ⚠ THE MAYOR ARM NAMES THE PARTY, NOT THE PERSON. The tooltip prints both; a label read
   *  aloud is better served by the fill's own meaning, and „кмет от ГЕРБ-СДС" is what the
   *  colour says. The person's name is one click away and in the tooltip. */
  const labelOf = (p: MunicipalityJSONProps): string => {
    const row = byMuni.get(p.nuts4);
    const place = row?.name ?? p.nuts4;
    if (isMayor)
      return row?.electedMayor
        ? t("local_map_muni_mayor_label", {
            place,
            party: row.electedMayor.displayName,
          })
        : t("local_map_muni_mayor_label_empty", { place });
    return row?.topCouncil
      ? t("local_map_muni_council_label", {
          place,
          party: row.topCouncil.displayName,
        })
      : t("local_map_muni_council_label_empty", { place });
  };

  return (
    <LocalChoropleth<MunicipalityJSONProps>
      size={size}
      mapGeo={mapGeo}
      colorOf={(p) => {
        const row = byMuni.get(p.nuts4);
        return isMayor ? row?.electedMayor?.color : row?.topCouncil?.color;
      }}
      ariaLabelOf={labelOf}
      tooltipOf={(p) => {
        const row = byMuni.get(p.nuts4);
        const mayor = row?.electedMayor;
        const council = row?.topCouncil;
        return (
          <div className="text-left">
            <div className="text-sm font-semibold pb-1">
              {row?.name ?? p.nuts4}
            </div>
            {isMayor ? (
              mayor ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-sm shrink-0"
                    style={{ backgroundColor: mayor.color }}
                  />
                  <span className="font-medium">{mayor.candidateName}</span>
                  <span className="opacity-70">{mayor.displayName}</span>
                </div>
              ) : (
                <div className="text-xs opacity-70">
                  {t("local_election_no_winner")}
                </div>
              )
            ) : council ? (
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-sm shrink-0"
                  style={{ backgroundColor: council.color }}
                />
                <span className="font-medium">{council.displayName}</span>
                <span className="opacity-70 tabular-nums">
                  {t("local_region_seats_count", { count: council.seats })}
                </span>
              </div>
            ) : (
              <div className="text-xs opacity-70">
                {t("local_election_no_data")}
              </div>
            )}
          </div>
        );
      }}
      onClickPath={(p) => ({ pathname: `/local/${cycle}/${p.nuts4}` })}
    />
  );
};
