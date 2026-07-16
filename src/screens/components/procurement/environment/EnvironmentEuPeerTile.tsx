// „Разход за околна среда — спрямо ЕС" — the EU-peer comparison tile. Government
// environmental-protection spending (COFOG GF05) as a share of GDP: Bulgaria sits BELOW
// the EU average (0.6% vs 0.8%, rank 17/26 in 2024), the structural counterpoint to the
// air/waste story — the state under-spends the function relative to peers.
//
// Reads the already-ingested Eurostat COFOG artifact (data/cofog.json, update-macro):
//   peers.GF05          → { bgPctGdp, euAvgPctGdp, rank, total, top } — headline
//   peerSeriesByYear[Y] → BG / HR / HU / RO GF05 %GDP — the peer bars
// No new ingest here (the GF05 rows ride the existing peer fetch). Mirrors MvrEuPeerTile.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Leaf } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { EuFlag } from "../security/euFlags";

const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  RO: { bg: "Румъния", en: "Romania" },
  HR: { bg: "Хърватия", en: "Croatia" },
  HU: { bg: "Унгария", en: "Hungary" },
  NL: { bg: "Нидерландия", en: "Netherlands" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
};

const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

const PEER_GEOS = ["BG", "RO", "HR", "HU"] as const;

export const EnvironmentEuPeerTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useCofog();

  const band = data?.peers?.GF05;
  const year = band?.year ?? data?.peerSeriesLatestYear;
  const row = year != null ? data?.peerSeriesByYear?.[String(year)] : undefined;
  if (!band || !row) return null;

  const countries = new Map<string, number>();
  for (const g of PEER_GEOS) {
    const v = row[g]?.GF05;
    if (v != null) countries.set(g, v);
  }
  if (band.top) countries.set(band.top.geo, band.top.pctGdp);
  const rows = [...countries.entries()]
    .map(([geo, pct]) => ({ geo, pct }))
    .sort((a, b) => b.pct - a.pct);
  if (!rows.length) return null;

  const euPct = row["EU27_2020"]?.GF05 ?? band.euAvgPctGdp ?? null;
  const max = Math.max(...rows.map((r) => r.pct), euPct ?? 0, 1);
  const topGeo = band.top?.geo ?? "BG";

  const Bar: FC<{
    geo: string;
    pct: number;
    isBg?: boolean;
    isEu?: boolean;
    rank?: number;
  }> = ({ geo, pct, isBg, isEu, rank }) => (
    <div className="flex items-center gap-2">
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        <EuFlag
          geo={isEu ? "EU27_2020" : geo}
          size={11}
          title={geoName(geo, bg)}
        />
        <span
          className={`truncate text-[11px] ${
            isBg ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {geoName(geo, bg)}
        </span>
        {rank != null && (
          <span
            className={`shrink-0 rounded-full px-1 text-[9px] font-semibold leading-tight ${
              isBg
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            №{rank}
          </span>
        )}
      </span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
        <div
          className={`h-full rounded ${
            isBg
              ? "bg-primary"
              : isEu
                ? "bg-muted-foreground/30"
                : "bg-primary/30"
          }`}
          style={{ width: `${(pct / max) * 100}%` }}
        />
      </div>
      <span
        className={`w-12 shrink-0 text-right text-[11px] tabular-nums ${
          isBg ? "font-semibold" : "text-muted-foreground"
        }`}
      >
        {formatCount(pct, loc, 1)}%
      </span>
    </div>
  );

  return (
    <Card id="environment-eu-peers">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Leaf className="h-4 w-4" />
          {bg
            ? "Разход за околна среда — спрямо ЕС"
            : "Environment spending — vs the EU"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {bg ? `№ ${band.rank}` : `#${band.rank}`}
            <span className="text-base font-semibold text-muted-foreground">
              {bg ? ` от ${band.total}` : ` of ${band.total}`}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `в ЕС по разход за околна среда (% от БВП, ${band.year} г.)`
              : `in the EU on environment spend (% of GDP, ${band.year})`}
          </span>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <Bar
              key={r.geo}
              geo={r.geo}
              pct={r.pct}
              isBg={r.geo === "BG"}
              rank={
                r.geo === topGeo ? 1 : r.geo === "BG" ? band.rank : undefined
              }
            />
          ))}
          {euPct != null && <Bar geo="EU27_2020" pct={euPct} isEu />}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              България отделя{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.bgPctGdp, loc, 1)}%
              </span>{" "}
              от БВП за околна среда срещу{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.euAvgPctGdp ?? 0, loc, 1)}%
              </span>{" "}
              средно за ЕС — под средното.
              {band.top ? (
                <>
                  {" "}
                  Начело е{" "}
                  <span className="font-medium">
                    {geoName(band.top.geo, true)}
                  </span>{" "}
                  ({formatCount(band.top.pctGdp, loc, 1)}%).
                </>
              ) : null}
            </>
          ) : (
            <>
              Bulgaria spends{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.bgPctGdp, loc, 1)}%
              </span>{" "}
              of GDP on the environment vs the EU average of{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.euAvgPctGdp ?? 0, loc, 1)}%
              </span>{" "}
              — below average.
              {band.top ? (
                <>
                  {" "}
                  <span className="font-medium">
                    {geoName(band.top.geo, false)}
                  </span>{" "}
                  leads ({formatCount(band.top.pctGdp, loc, 1)}%).
                </>
              ) : null}
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat gov_10a_exp (COFOG GF05{" "}
          {bg ? "Опазване на околната среда" : "Environmental protection"}, %{" "}
          {bg ? "от БВП" : "of GDP"})
        </p>
      </CardContent>
    </Card>
  );
};
