// Sofia choropleth. One tile, two metrics:
//   metric="mayor"   → the 24 administrative районы, each filled by its
//     elected район mayor's party. Polygons come from merging S23/S24/S25
//     parliamentary GeoJSON; the join key is `nuts4` (S2*** district code).
//   metric="council" → Sofia has a single city-wide council (Столичен
//     общински съвет), so — exactly like the national council map treats the
//     city — the районы are dropped and the single Столична-община polygon is
//     drawn instead, filled by the leading council party and showing the full
//     per-party seat breakdown on hover. Colouring 24 районы that share one
//     council would imply per-район councils that don't exist.

import { FC, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  MunicipalityJSONProps,
  RegionJSONProps,
} from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import {
  LocalPartyBreakdownXS,
  LocalBreakdownRow,
} from "@/screens/components/local/LocalPartyBreakdownXS";
import { useSofiaRayonsMap } from "@/data/local/useSofiaRayonsMap";
import { useSofiaObshtinaMap } from "@/data/regions/useSofiaObshtinaMap";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { SOFIA_RAYONS } from "@/data/budget/sofiaRayons";
import { StatCard } from "../StatCard";
import { LocalMapMetric } from "./LocalRegionsControlMapTile";
import { LocalDistrictMayorResult, LocalMayorResult } from "@/data/local/types";

const IND_COLOR = "#9CA3AF";

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
  const { t, i18n } = useTranslation();
  const { byId } = useCanonicalParties();
  const isEn = i18n.language === "en";
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const rayonsMap = useSofiaRayonsMap(); // mayor metric: the 24 районы
  const sofiaObshtina = useSofiaObshtinaMap(); // council metric: one SOF polygon
  const { municipality: sof } = useLocalMunicipality("SOF", cycle);
  const isMayor = metric === "mayor";

  // Mayor metric — район (nuts4) → elected mayor party + candidate.
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
        ? (byId.get(winner.primaryCanonicalId)?.color ?? IND_COLOR)
        : IND_COLOR;
      m.set(nuts4, {
        partyName: winner.localPartyName,
        color,
        candidateName: winner.candidateName,
      });
    }
    return m;
  }, [sof, byId]);

  // Council metric — the city-wide council seat breakdown, sorted desc, ready
  // for LocalPartyBreakdownXS (the same tooltip body the national council map
  // uses). Independents keep their local list name and a gray swatch.
  const council = useMemo(() => {
    const rows: LocalBreakdownRow[] = (sof?.council ?? [])
      .filter((p) => p.mandatesWon > 0)
      .map((p) => {
        const party = p.primaryCanonicalId
          ? byId.get(p.primaryCanonicalId)
          : undefined;
        const name = party
          ? ((isEn ? party.displayNameEn : party.displayName) ??
            party.displayName ??
            p.localPartyName)
          : p.localPartyName;
        return {
          id: p.primaryCanonicalId ?? `ind:${p.localPartyNum}`,
          name,
          color: party?.color ?? IND_COLOR,
          value: p.mandatesWon,
        };
      })
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    return { rows, total, topColor: rows[0]?.color };
  }, [sof, byId, isEn]);

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
        {size && isMayor && (
          <LocalChoropleth<MunicipalityJSONProps>
            size={size}
            mapGeo={rayonsMap}
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
        {size && !isMayor && (
          <LocalChoropleth<RegionJSONProps>
            size={size}
            mapGeo={sofiaObshtina}
            colorOf={() => council.topColor}
            tooltipOf={() => (
              <div className="text-left">
                <div className="text-sm font-semibold text-center pb-1">
                  {t("local_sofia_council_title")}
                </div>
                {council.rows.length ? (
                  <LocalPartyBreakdownXS
                    header={t("local_region_seats_count", {
                      count: council.total,
                    })}
                    rows={council.rows}
                    total={council.total}
                  />
                ) : (
                  <div className="text-xs opacity-70">
                    {t("local_election_no_data")}
                  </div>
                )}
              </div>
            )}
            onClickPath={() => ({ pathname: `/local/${cycle}/SOF` })}
          />
        )}
      </div>
    </StatCard>
  );
};
