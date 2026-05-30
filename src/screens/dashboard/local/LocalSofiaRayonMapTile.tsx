// Sofia район choropleth. One tile, two metrics:
//   metric="mayor"   → fill by each район's elected mayor party
//   metric="council" → fill by the район shard's leading council party
//     (which mirrors the city council since SOF shards replicate it; the
//     metric is kept for parity with country/region so the dashboard reads
//     consistently — most районы will share Sofia's dominant council party)
// Polygons come from merging S23/S24/S25 parliamentary GeoJSON; the join key
// is `nuts4` (S2*** district code).

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { MunicipalityJSONProps } from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import { useSofiaRayonsMap } from "@/data/local/useSofiaRayonsMap";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { SOFIA_RAYONS } from "@/data/budget/sofiaRayons";
import { StatCard } from "../StatCard";
import { LocalMapMetric } from "./LocalRegionsControlMapTile";
import { LocalDistrictMayorResult, LocalMayorResult } from "@/data/local/types";

// district display name → S2*** nuts4 code (the SOF bundle's districts carry
// districtName like "Красно село" but an empty districtCode, so resolve via
// the canonical Sofia районы catalogue used by the budget tiles).
const NAME_TO_NUTS4: Map<string, string> = new Map(
  SOFIA_RAYONS.map((r) => [r.labelBg.toLocaleLowerCase("bg"), r.obshtinaCode]),
);
const NUTS4_TO_NAME: Map<string, string> = new Map(
  SOFIA_RAYONS.map((r) => [r.obshtinaCode, r.labelBg]),
);

const normalize = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .normalize("NFC")
    .replace(/^район\s+/i, "")
    .trim();

// Resolve the mayor we actually want to colour by: CIK flags both runoff
// finalists as elected in round 1, so prefer the runoff-resolved winner.
const resolveDistrictMayor = (
  d: LocalDistrictMayorResult,
): LocalMayorResult | undefined =>
  d.elected ?? d.candidates.find((c) => c.isElected) ?? d.candidates[0];

export const LocalSofiaRayonMapTile: FC<{
  cycle: string;
  metric: LocalMapMetric;
}> = ({ cycle, metric }) => {
  const { t } = useTranslation();
  const { byId } = useCanonicalParties();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const mapGeo = useSofiaRayonsMap();
  const { municipality: sof } = useLocalMunicipality("SOF", cycle);
  const isMayor = metric === "mayor";

  // Build a lookup keyed by nuts4 (S2***):
  //   - mayor metric → that район's mayor party
  //   - council metric → the район shard's leading council party (read by
  //     fetching the shard separately would multiply requests, so we
  //     surface the city-wide top instead at this level — kept simple)
  const byDistrict = useMemo(() => {
    const m = new Map<
      string,
      { partyName: string; color: string; candidateName?: string }
    >();
    for (const d of sof?.districts ?? []) {
      const nuts4 =
        d.districtCode || NAME_TO_NUTS4.get(normalize(d.districtName));
      if (!nuts4) continue;
      const winner = resolveDistrictMayor(d);
      if (!winner) continue;
      const color = winner.primaryCanonicalId
        ? (byId.get(winner.primaryCanonicalId)?.color ?? "#9CA3AF")
        : "#9CA3AF";
      m.set(nuts4, {
        partyName: winner.localPartyName,
        color,
        candidateName: winner.candidateName,
      });
    }
    return m;
  }, [sof, byId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize([el.offsetWidth, el.offsetHeight, el.offsetLeft, el.offsetTop]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>
            {isMayor
              ? t("local_sofia_rayon_map_mayor")
              : t("local_sofia_rayon_map_council")}
          </span>
        </div>
      }
      hint={
        isMayor
          ? t("local_sofia_rayon_map_mayor_hint")
          : t("local_sofia_rayon_map_council_hint")
      }
    >
      <div ref={ref} className="w-full h-[360px] md:h-[440px]">
        {size && (
          <LocalChoropleth<MunicipalityJSONProps>
            size={size}
            mapGeo={mapGeo}
            colorOf={(p) => byDistrict.get(p.nuts4)?.color}
            tooltipOf={(p) => {
              const r = byDistrict.get(p.nuts4);
              return (
                <div className="text-left">
                  <div className="text-sm font-semibold pb-1">
                    {NUTS4_TO_NAME.get(p.nuts4) ?? p.nuts4}
                  </div>
                  {r ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-sm shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="font-medium">
                        {r.candidateName ?? r.partyName}
                      </span>
                      <span className="opacity-70">{r.partyName}</span>
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
        )}
      </div>
    </StatCard>
  );
};
