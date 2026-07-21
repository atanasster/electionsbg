// Regional projection map for the machine-only article. Colours each of the 31
// МИР by the party that gains the most vote share under the model (shade =
// size of that gain), recomputed live from the embedded per-region components
// as the threshold / drop-off change. Reuses the app's d3-geo choropleth
// primitives (FeatureMap + getDataProjection) and the shared regions_map.json.

import { FC, ReactNode, useMemo } from "react";
import { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useTooltip } from "@/ux/useTooltip";
import { useRegionsMap } from "@/data/regions/useRegionsMap";
import { LeafletMap } from "@/screens/components/maps/LeafletMap";
import { SVGMapContainer } from "@/screens/components/maps/SVGMapContainer";
import { FeatureMap } from "@/screens/components/maps/FeatureMap";
import { getDataProjection } from "@/screens/components/maps/d3_utils";
import type { MapCoordinates } from "@/layout/dataview/MapLayout";

export type PartyMeta = {
  partyNum: number;
  nickName: string;
  name: string;
  color: string;
};
type RegionRow = {
  partyNum: number;
  base: number;
  reassignable: number;
  actualPaper: number;
};
export type RegionSlice = { name: string; rows: RegionRow[] };

type Mover = { partyNum: number; aPct: number; mPct: number; delta: number };
type RegionResult = {
  code: string;
  name: string;
  winnerActual: number;
  winnerModel: number;
  flip: boolean;
  winnerMargin: number; // model winner's lead over the runner-up, in pp
  movers: Mover[];
};

const computeRegion = (
  code: string,
  slice: RegionSlice,
  d: number,
): RegionResult | null => {
  let aTot = 0;
  let mTot = 0;
  const raw = slice.rows.map((r) => {
    const a = r.base + r.actualPaper;
    const m = r.base + (1 - d) * r.reassignable;
    aTot += a;
    mTot += m;
    return { partyNum: r.partyNum, a, m };
  });
  if (aTot <= 0 || mTot <= 0) return null;
  const movers: Mover[] = raw.map((r) => {
    const aPct = (100 * r.a) / aTot;
    const mPct = (100 * r.m) / mTot;
    return { partyNum: r.partyNum, aPct, mPct, delta: mPct - aPct };
  });
  const winnerActual = [...raw].sort((x, y) => y.a - x.a)[0].partyNum;
  const byModel = [...movers].sort((x, y) => y.mPct - x.mPct);
  const winnerModel = byModel[0].partyNum;
  const winnerMargin = byModel[0].mPct - (byModel[1]?.mPct ?? 0);
  return {
    code,
    name: slice.name.replace(/^\d+\.\s*/, ""),
    winnerActual,
    winnerModel,
    flip: winnerActual !== winnerModel,
    winnerMargin,
    movers: [...movers]
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 4),
  };
};

const RegionTooltip: FC<{
  r: RegionResult;
  nameOf: (pn: number) => string;
  colorOf: (pn: number) => string;
  t: TFunction;
}> = ({ r, nameOf, colorOf, t }) => (
  <div className="text-left min-w-[190px]">
    <div className="flex items-center justify-between gap-3 pb-1">
      <span className="text-base font-semibold">{r.name}</span>
      {r.flip ? (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          {t("machine_only_map_flip")}
        </span>
      ) : null}
    </div>
    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{t("machine_only_map_winner")}:</span>
      <span
        className="inline-block size-2 rounded-full ring-1 ring-border"
        style={{ backgroundColor: colorOf(r.winnerModel) }}
      />
      <span className="font-medium text-foreground">
        {nameOf(r.winnerModel)}
      </span>
    </div>
    <table className="w-full text-xs tabular-nums">
      <tbody>
        {r.movers.map((m) => (
          <tr key={m.partyNum}>
            <td className="py-0.5 pr-2">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: colorOf(m.partyNum) }}
                />
                {nameOf(m.partyNum)}
              </span>
            </td>
            <td className="py-0.5 pr-1 text-right text-muted-foreground">
              {m.aPct.toFixed(1)}→{m.mPct.toFixed(1)}%
            </td>
            <td
              className={`py-0.5 text-right font-semibold ${
                m.delta > 0.05
                  ? "text-emerald-600 dark:text-emerald-400"
                  : m.delta < -0.05
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
              }`}
            >
              {m.delta >= 0 ? "+" : ""}
              {m.delta.toFixed(1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const MachineOnlyRegionMap: FC<{
  size: MapCoordinates;
  regions: Record<string, RegionSlice>;
  dropoff: number; // 0..1
  parties: Map<number, PartyMeta>;
}> = ({ size, regions, dropoff, parties }) => {
  const { t } = useTranslation();
  const { tooltip, ...tt } = useTooltip();
  const mapGeo = useRegionsMap();

  const { byCode, maxMargin, winnerLegend, flipCount } = useMemo(() => {
    const byCode = new Map<string, RegionResult>();
    let maxMargin = 0;
    let flipCount = 0;
    const winnerCounts = new Map<number, number>();
    for (const [code, slice] of Object.entries(regions)) {
      const r = computeRegion(code, slice, dropoff);
      if (!r) continue;
      byCode.set(code, r);
      if (r.winnerMargin > maxMargin) maxMargin = r.winnerMargin;
      if (r.flip) flipCount += 1;
      winnerCounts.set(
        r.winnerModel,
        (winnerCounts.get(r.winnerModel) ?? 0) + 1,
      );
    }
    const winnerLegend = [...winnerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([partyNum, count]) => ({ partyNum, count }));
    return { byCode, maxMargin: maxMargin || 1, winnerLegend, flipCount };
  }, [regions, dropoff]);

  const proj = useMemo(
    () =>
      mapGeo
        ? getDataProjection(
            mapGeo as Parameters<typeof getDataProjection>[0],
            size,
          )
        : null,
    [mapGeo, size],
  );
  if (!mapGeo || !proj) return null;

  const nameOf = (pn: number) => parties.get(pn)?.nickName ?? String(pn);
  const colorOf = (pn: number) => parties.get(pn)?.color ?? "#888888";

  return (
    <div className="flex w-full">
      <div
        className="relative isolate"
        style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
      >
        <LeafletMap size={size} bounds={proj.bounds} scale={proj.scale} />
        <SVGMapContainer
          size={size}
          supportsShiftArrows={false}
          supportsNames={false}
        >
          {mapGeo.features.map((feature, idx) => {
            const code = feature.properties.nuts3 as string;
            const r = byCode.get(code);
            const fill = r ? colorOf(r.winnerModel) : "hsl(0, 0%, 88%)";
            const opacity = r
              ? 0.32 + 0.6 * Math.min(1, r.winnerMargin / maxMargin)
              : 0.3;
            let content: ReactNode = null;
            if (r)
              content = (
                <RegionTooltip r={r} nameOf={nameOf} colorOf={colorOf} t={t} />
              );
            return (
              <FeatureMap
                key={`mo-region-${idx}`}
                geoPath={proj.path}
                feature={feature}
                fillColor={fill}
                opacity={opacity}
                onMouseEnter={(e) =>
                  content &&
                  tt.onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, content)
                }
                onMouseMove={(e) =>
                  tt.onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={tt.onMouseLeave}
              />
            );
          })}
        </SVGMapContainer>

        <div className="absolute bottom-3 left-3 z-[1000] max-w-[220px] rounded-md border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm">
          <div className="mb-1 text-[11px] font-medium text-foreground">
            {t("machine_only_map_legend")}
          </div>
          <ul className="space-y-0.5">
            {winnerLegend.map(({ partyNum, count }) => (
              <li
                key={partyNum}
                className="flex items-center gap-1.5 text-[11px]"
              >
                <span
                  className="inline-block size-2.5 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: colorOf(partyNum) }}
                />
                <span className="text-foreground">{nameOf(partyNum)}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {count}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-border/60 pt-1 text-[10px] leading-tight text-muted-foreground">
            {t("machine_only_map_flips", { count: flipCount })}
            <br />
            {t("machine_only_map_intensity")}
          </div>
        </div>
      </div>
      {tooltip}
    </div>
  );
};
