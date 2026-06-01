// National oblast choropleth for local elections. One tile, two metrics:
//   metric="mayor"   → fill by the party holding the most mayoralties (who governs)
//   metric="council" → fill by the top council party by seats (party support)
// Council votes track party preference better than winner-take-all mayoral
// races, so both maps are shown together. Reuses the parliamentary regions
// GeoJSON; colour comes from the local regions_summary.
//
// Sofia is special-cased per metric:
//   • mayor   → each of the three parliamentary МИР polygons (S23/S24/S25) is
//     coloured by ITS OWN plurality among the районни кметове that fall inside
//     it (район→МИР via the район's nuts4 digit). The three polygons can show
//     three different leaders, and their sub-tallies sum to the 24-район city
//     tally.
//   • council → the three МИР polygons are replaced by the single Столична
//     община boundary (useSofiaObshtinaMap, keyed nuts3 "SOF") so the council
//     map reads the city as one entity, matching how local government treats it.

import {
  FC,
  ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon, LayoutGrid } from "lucide-react";
import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useNavigateParams } from "@/ux/useNavigateParams";
import {
  OBLAST_TILE_GRID,
  OBLAST_TILE_COLS,
  tileTextColor,
} from "@/data/local/oblastTileGrid";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { useSofiaObshtinaMap } from "@/data/regions/useSofiaObshtinaMap";
import { useRegions } from "@/data/regions/useRegions";
import {
  RegionGeoJSON,
  RegionJSONProps,
} from "@/screens/components/maps/mapTypes";
import { LocalChoropleth } from "@/screens/components/local/LocalChoropleth";
import {
  LocalPartyBreakdownXS,
  LocalBreakdownRow,
} from "@/screens/components/local/LocalPartyBreakdownXS";
import { useLocalRegionsSummary } from "@/data/local/useLocalRegionsSummary";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  LocalDistrictMayorResult,
  LocalMayorResult,
  LocalRegionsSummaryRow,
} from "@/data/local/types";
import { SOFIA_RAYONS } from "@/data/budget/sofiaRayons";
import { StatCard } from "../StatCard";
import { LocalSofiaCityLink } from "./LocalSofiaCityLink";

export type LocalMapMetric = "mayor" | "council";

// Parliamentary splits Sofia city into three constituencies (S23/S24/S25);
// local government treats it as one entity keyed SOF.
const isSofiaMir = (nuts3: string): boolean => /^S2[345]$/.test(nuts3);
const nuts3ToOblast = (nuts3: string): string =>
  isSofiaMir(nuts3) ? "SOF" : nuts3;

// district display name → S2*** nuts4 code (the SOF bundle's districts carry
// districtName like "Красно село" but an empty districtCode, so resolve via
// the canonical Sofia районы catalogue used by the budget tiles).
const NAME_TO_NUTS4: Map<string, string> = new Map(
  SOFIA_RAYONS.map((r) => [r.labelBg.toLocaleLowerCase("bg"), r.obshtinaCode]),
);

const normalize = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .normalize("NFC")
    .replace(/^район\s+/i, "")
    .trim();

// CIK flags both runoff finalists as elected in round 1, so prefer the
// runoff-resolved winner (same resolution as LocalSofiaRayonMapTile).
const resolveDistrictMayor = (
  d: LocalDistrictMayorResult,
): LocalMayorResult | undefined =>
  d.elected ?? d.candidates.find((c) => c.isElected) ?? d.candidates[0];

const IND_COLOR = "#9CA3AF";

// Each Sofia район belongs to one of the three parliamentary МИР; the район's
// nuts4 third character is the МИР digit (S2401→S24, S2309→S23, S2511→S25).
const mirOfNuts4 = (nuts4: string): string => "S2" + nuts4.charAt(2);

type MirBreakdown = {
  rows: LocalBreakdownRow[];
  total: number;
  topColor: string | undefined;
};

export const LocalRegionsControlMapTile: FC<{
  cycle: string;
  metric: LocalMapMetric;
}> = ({ cycle, metric }) => {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<MapCoordinates | undefined>();
  const [view, setView] = useState<"map" | "tiles">("map");
  const {
    tooltip: tileTooltip,
    onMouseEnter: tipEnter,
    onMouseMove: tipMove,
    onMouseLeave: tipLeave,
  } = useTooltip();
  const navigate = useNavigateParams();
  const regionsMap = useRegionsMap();
  // Council map only: the single Столична-община outline that replaces the 3 МИР.
  const sofiaObshtina = useSofiaObshtinaMap();
  const { data: summary } = useLocalRegionsSummary(cycle);
  const { findRegion } = useRegions();
  const { byId } = useCanonicalParties();
  const isEn = i18n.language === "en";
  const isMayor = metric === "mayor";
  // Per-МИР mayor breakdown needs the SOF bundle's 24 районни кметове; only
  // consumed on the mayor map.
  const { municipality: sof } = useLocalMunicipality("SOF", cycle);

  const byOblast = useMemo(() => {
    const m = new Map<string, LocalRegionsSummaryRow>();
    for (const r of summary?.regions ?? []) m.set(r.oblast, r);
    return m;
  }, [summary]);

  // Mayor map only: split the 24 районни кметове into three sub-tallies, one
  // per parliamentary МИР, so each Sofia polygon shows its own plurality.
  // Mirrors the whole-city districtMayors tally (independents grouped under
  // their local list name with a gray swatch) so the three МИР sub-tallies
  // sum to 24.
  const mirBreakdowns = useMemo(() => {
    const m = new Map<string, MirBreakdown>();
    if (!isMayor) return m;
    // mir → row key → row
    const buckets = new Map<string, Map<string, LocalBreakdownRow>>();
    for (const d of sof?.districts ?? []) {
      const nuts4 =
        d.districtCode || NAME_TO_NUTS4.get(normalize(d.districtName));
      if (!nuts4) continue;
      const winner = resolveDistrictMayor(d);
      if (!winner) continue;
      const mir = mirOfNuts4(nuts4);
      const isInd = !winner.primaryCanonicalId;
      const id = isInd
        ? `ind:${winner.localPartyName}`
        : winner.primaryCanonicalId!;
      const party = winner.primaryCanonicalId
        ? byId.get(winner.primaryCanonicalId)
        : undefined;
      const color = party?.color ?? IND_COLOR;
      const name = isInd
        ? winner.localPartyName
        : ((isEn ? party?.displayNameEn : party?.displayName) ??
          party?.displayName ??
          winner.localPartyName);
      let bucket = buckets.get(mir);
      if (!bucket) {
        bucket = new Map();
        buckets.set(mir, bucket);
      }
      const existing = bucket.get(id);
      if (existing) existing.value += 1;
      else bucket.set(id, { id, name, color, value: 1 });
    }
    for (const [mir, bucket] of buckets) {
      const rows = [...bucket.values()].sort((a, b) => b.value - a.value);
      const total = rows.reduce((acc, r) => acc + r.value, 0);
      m.set(mir, { rows, total, topColor: rows[0]?.color });
    }
    return m;
  }, [isMayor, sof, byId, isEn]);

  // Council map only: drop the three Sofia МИР polygons and append the single
  // Столична-община outline (keyed nuts3 "SOF") so the city reads as one
  // council entity. The mayor map keeps the original 3-МИР geometry so each
  // constituency can be coloured independently.
  const councilMapGeo = useMemo((): RegionGeoJSON | undefined => {
    if (!regionsMap) return undefined;
    const nonSofia = regionsMap.features.filter(
      (f) => !isSofiaMir(f.properties.nuts3),
    );
    if (!sofiaObshtina) return { ...regionsMap, features: nonSofia };
    return {
      ...regionsMap,
      features: [...nonSofia, ...sofiaObshtina.features],
    };
  }, [regionsMap, sofiaObshtina]);

  const mapGeo = isMayor ? regionsMap : councilMapGeo;

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

  const regionName = (code: string): string => {
    const info = findRegion(code);
    if (!info) return code === "SOF" ? t("local_region_sofia_city") : code;
    return (
      (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code
    );
  };

  // nuts3 "S23" → МИР 23 (use the digits after the leading "S", not the
  // single МИР digit). EN "Sofia – 23 MMC" / BG "София – 23. МИР".
  const mirLabel = (nuts3: string): string =>
    t("local_region_sofia_mir", { mir: nuts3.slice(1) });

  // Top-parties breakdown for one oblast — the richer tooltip body, mirroring
  // the parliamentary votes map. Falls back to the single topMayor/topCouncil
  // leader for older summaries that predate the full arrays.
  const breakdownOf = (
    row?: LocalRegionsSummaryRow,
  ): { rows: LocalBreakdownRow[]; total: number; header: string } => {
    const rows: LocalBreakdownRow[] = isMayor
      ? (row?.mayorsWon ?? (row?.topMayor ? [row.topMayor] : [])).map((p) => ({
          id: p.canonicalId,
          name: p.displayName,
          color: p.color,
          value: p.count,
        }))
      : (row?.councilSeats ?? (row?.topCouncil ? [row.topCouncil] : [])).map(
          (p) => ({
            id: p.canonicalId,
            name: p.displayName,
            color: p.color,
            value: p.seats,
          }),
        );
    const total = rows.reduce((a, r) => a + r.value, 0);
    const header = isMayor
      ? t("local_region_mayors_count", { count: total })
      : t("local_region_seats_count", { count: total });
    return { rows, total, header };
  };

  // === Tile-map (cartogram) view ===
  // One equal-size cell per oblast (Sofia is the single SOF cell — no МИР
  // split), coloured by the same leader as the choropleth. Tooltip + drill-down
  // mirror the map; a short Cyrillic abbreviation labels each cell.
  const oblastColor = (code: string): string | undefined => {
    const row = byOblast.get(code);
    return isMayor ? row?.topMayor?.color : row?.topCouncil?.color;
  };
  const oblastTooltip = (code: string): ReactNode => {
    const { rows, total, header } = breakdownOf(byOblast.get(code));
    return (
      <div className="text-left">
        <div className="pb-1 text-center text-sm font-semibold">
          {regionName(code)}
        </div>
        {rows.length ? (
          <LocalPartyBreakdownXS header={header} rows={rows} total={total} />
        ) : (
          <div className="text-xs opacity-70">
            {t("local_election_no_data")}
          </div>
        )}
      </div>
    );
  };
  const oblastPath = (code: string) =>
    code === "SOF"
      ? { pathname: `/local/${cycle}/SOF` }
      : { pathname: `/local/${cycle}/region/${code}` };
  const tileLabel = (code: string): string => {
    if (code === "SOF") return "СФ";
    if (code === "SFO") return "СО";
    // Strip an "обл." prefix some region names carry (e.g. "обл. Пловдив").
    const name = regionName(code).replace(/^обл\.?\s*/i, "");
    const words = name.split(/\s+/).filter(Boolean);
    return words.length >= 2
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 3)
          .toLocaleUpperCase("bg")
      : name.slice(0, 3);
  };

  const tileMap = (
    <div className="w-full py-2">
      <div
        className="mx-auto grid w-full max-w-[560px] gap-1"
        style={{
          gridTemplateColumns: `repeat(${OBLAST_TILE_COLS}, minmax(0, 1fr))`,
        }}
      >
        {OBLAST_TILE_GRID.map(({ code, x, y }) => {
          const color = oblastColor(code);
          return (
            <button
              key={code}
              type="button"
              style={{
                gridColumnStart: x + 1,
                gridRowStart: y + 1,
                ...(color
                  ? { backgroundColor: color, color: tileTextColor(color) }
                  : {}),
              }}
              className={`flex aspect-square items-center justify-center rounded-md text-[10px] font-semibold ring-1 ring-black/10 transition-transform hover:z-10 hover:scale-110 hover:ring-2 hover:ring-primary sm:text-xs ${
                color ? "" : "bg-muted text-muted-foreground"
              }`}
              onMouseEnter={(e) =>
                tipEnter(
                  { pageX: e.pageX, pageY: e.pageY },
                  oblastTooltip(code),
                )
              }
              onMouseMove={(e) => tipMove({ pageX: e.pageX, pageY: e.pageY })}
              onMouseLeave={tipLeave}
              onClick={() => navigate(oblastPath(code))}
              aria-label={regionName(code)}
            >
              {tileLabel(code)}
            </button>
          );
        })}
      </div>
      {tileTooltip}
    </div>
  );

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            <span>
              {isMayor
                ? t("local_national_mayors_map")
                : t("local_national_council_map")}
            </span>
          </div>
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setView("map")}
              aria-label={t("local_map_view_map")}
              title={t("local_map_view_map")}
              className={`rounded p-1 transition-colors ${
                view === "map"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("tiles")}
              aria-label={t("local_map_view_tiles")}
              title={t("local_map_view_tiles")}
              className={`rounded p-1 transition-colors ${
                view === "tiles"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      }
      hint={
        isMayor
          ? t("local_national_mayors_map_hint")
          : t("local_national_council_map_hint")
      }
    >
      {view === "tiles" ? (
        tileMap
      ) : (
        <div ref={ref} className="w-full h-[360px] md:h-[480px]">
          {size && (
            <LocalChoropleth<RegionJSONProps>
              size={size}
              mapGeo={mapGeo}
              colorOf={(p) => {
                // Mayor map: each Sofia МИР gets ITS OWN plurality colour.
                if (isMayor && isSofiaMir(p.nuts3))
                  return mirBreakdowns.get(p.nuts3)?.topColor;
                const row = byOblast.get(nuts3ToOblast(p.nuts3));
                return isMayor ? row?.topMayor?.color : row?.topCouncil?.color;
              }}
              tooltipOf={(p) => {
                // Mayor map + a Sofia МИР → that МИР's районни-кмет breakdown.
                if (isMayor && isSofiaMir(p.nuts3)) {
                  const mir = mirBreakdowns.get(p.nuts3);
                  const rows = mir?.rows ?? [];
                  const total = mir?.total ?? 0;
                  return (
                    <div className="text-left">
                      <div className="text-sm font-semibold text-center pb-1">
                        {mirLabel(p.nuts3)}
                      </div>
                      {rows.length ? (
                        <LocalPartyBreakdownXS
                          header={t("local_region_district_mayors_count", {
                            count: total,
                          })}
                          rows={rows}
                          total={total}
                        />
                      ) : (
                        <div className="text-xs opacity-70">
                          {t("local_election_no_data")}
                        </div>
                      )}
                    </div>
                  );
                }
                const oblast = nuts3ToOblast(p.nuts3);
                const row = byOblast.get(oblast);
                const { rows, total, header } = breakdownOf(row);
                const title = regionName(oblast);
                return (
                  <div className="text-left">
                    <div className="text-sm font-semibold text-center pb-1">
                      {title}
                    </div>
                    {rows.length ? (
                      <LocalPartyBreakdownXS
                        header={header}
                        rows={rows}
                        total={total}
                      />
                    ) : (
                      <div className="text-xs opacity-70">
                        {t("local_election_no_data")}
                      </div>
                    )}
                  </div>
                );
              }}
              onClickPath={(p) => {
                const oblast = nuts3ToOblast(p.nuts3);
                return oblast === "SOF"
                  ? { pathname: `/local/${cycle}/SOF` }
                  : { pathname: `/local/${cycle}/region/${oblast}` };
              }}
              overlay={
                <LocalSofiaCityLink
                  cycle={cycle}
                  size={size}
                  metric={metric}
                  row={byOblast.get("SOF")}
                />
              }
            />
          )}
        </div>
      )}
    </StatCard>
  );
};
