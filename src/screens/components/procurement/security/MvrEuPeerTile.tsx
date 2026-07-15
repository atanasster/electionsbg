// "Разход за обществен ред спрямо ЕС" — the EU-peer comparison tile. Public order
// & security (COFOG GF03) as a share of GDP: Bulgaria sits near the very top of the
// EU on this, which is the structural point behind the "expensive МВР" story — the
// spend is high not just in levs but relative to the economy and to peers.
//
// Reads the already-ingested Eurostat COFOG artifact (data/cofog.json, update-macro):
//   peers.GF03            → { bgPctGdp, euAvgPctGdp, rank, total, top } — headline
//                           + the #1-ranked member state (dynamic; Latvia in 2024)
//   peerSeriesByYear[Y]   → BG / EU27 / HR / HU / RO GF03 %GDP — the peer bars
// No new ingest. National (country-level) figures only.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatCount } from "@/lib/currency";
import { useCofog } from "@/data/macro/useCofog";
import { EuFlag } from "./euFlags";

// Geo → display name. Covers the fixed peers, the EU aggregate, and the member
// states that plausibly rank #1 on GF03 (so the dynamic top country gets a real
// name). Anything unmapped falls back to the raw geo code.
const GEO_NAME: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  RO: { bg: "Румъния", en: "Romania" },
  HR: { bg: "Хърватия", en: "Croatia" },
  HU: { bg: "Унгария", en: "Hungary" },
  LV: { bg: "Латвия", en: "Latvia" },
  GR: { bg: "Гърция", en: "Greece" },
  EE: { bg: "Естония", en: "Estonia" },
  LT: { bg: "Литва", en: "Lithuania" },
  PL: { bg: "Полша", en: "Poland" },
  SI: { bg: "Словения", en: "Slovenia" },
  CY: { bg: "Кипър", en: "Cyprus" },
  CZ: { bg: "Чехия", en: "Czechia" },
  SK: { bg: "Словакия", en: "Slovakia" },
  EU27_2020: { bg: "ЕС средно", en: "EU average" },
};

const geoName = (geo: string, bg: boolean): string =>
  GEO_NAME[geo]?.[bg ? "bg" : "en"] ?? geo;

// The fixed regional peers we always chart alongside BG (EU average is drawn
// separately, always last).
const PEER_GEOS = ["BG", "RO", "HR", "HU"] as const;

export const MvrEuPeerTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const loc = bg ? "bg-BG" : "en-US";
  const { data } = useCofog();

  const band = data?.peers?.GF03;
  const year = band?.year ?? data?.peerSeriesLatestYear;
  const row = year != null ? data?.peerSeriesByYear?.[String(year)] : undefined;
  if (!band || !row) return null;

  // Country rows: the fixed peers (from the per-year composition) plus, when it
  // is not already one of them, the #1-ranked member state carried on the band.
  const countries = new Map<string, number>();
  for (const g of PEER_GEOS) {
    const v = row[g]?.GF03;
    if (v != null) countries.set(g, v);
  }
  if (band.top) countries.set(band.top.geo, band.top.pctGdp);
  const rows = [...countries.entries()]
    .map(([geo, pct]) => ({ geo, pct }))
    .sort((a, b) => b.pct - a.pct);
  if (!rows.length) return null;

  // EU average anchors the bottom of the chart.
  const euPct = row["EU27_2020"]?.GF03 ?? band.euAvgPctGdp ?? null;
  const max = Math.max(...rows.map((r) => r.pct), euPct ?? 0, 1);
  const topGeo = band.top?.geo ?? "BG";

  const multiple =
    band.euAvgPctGdp && band.euAvgPctGdp > 0
      ? band.bgPctGdp / band.euAvgPctGdp
      : null;

  const Bar: FC<{
    geo: string;
    pct: number;
    isBg?: boolean;
    isEu?: boolean;
    rank?: number;
  }> = ({ geo, pct, isBg, isEu, rank }) => (
    <div className="flex items-center gap-2">
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        {isEu ? (
          <EuFlag geo="EU27_2020" size={11} title={geoName(geo, bg)} />
        ) : (
          <EuFlag geo={geo} size={11} title={geoName(geo, bg)} />
        )}
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
    <Card id="mvr-eu-peers">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg ? "Обществен ред — спрямо ЕС" : "Public order — vs the EU"}
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
              ? `в ЕС по разход за обществен ред и сигурност (% от БВП, ${band.year} г.)`
              : `in the EU on public order & security spend (% of GDP, ${band.year})`}
          </span>
        </div>

        {/* Horizontal bars — GF03 % of GDP. #1 country on top, BG highlighted,
            regional peers, EU average anchoring the bottom. */}
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
              от БВП за обществен ред и сигурност срещу{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.euAvgPctGdp, loc, 1)}%
              </span>{" "}
              средно за ЕС
              {multiple ? (
                <>
                  {" "}
                  — около{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(multiple, loc, 1)}×
                  </span>{" "}
                  повече
                </>
              ) : null}
              .{" "}
              {band.top ? (
                <>
                  Само{" "}
                  <span className="font-medium">
                    {geoName(band.top.geo, true)}
                  </span>{" "}
                  ({formatCount(band.top.pctGdp, loc, 1)}%) е пред нея.
                </>
              ) : null}
            </>
          ) : (
            <>
              Bulgaria spends{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.bgPctGdp, loc, 1)}%
              </span>{" "}
              of GDP on public order & security vs the EU average of{" "}
              <span className="font-semibold tabular-nums">
                {formatCount(band.euAvgPctGdp, loc, 1)}%
              </span>
              {multiple ? (
                <>
                  {" "}
                  — about{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCount(multiple, loc, 1)}×
                  </span>{" "}
                  more
                </>
              ) : null}
              .{" "}
              {band.top ? (
                <>
                  Only{" "}
                  <span className="font-medium">
                    {geoName(band.top.geo, false)}
                  </span>{" "}
                  ({formatCount(band.top.pctGdp, loc, 1)}%) ranks above it.
                </>
              ) : null}
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg ? "Източник: " : "Source: "}
          Eurostat gov_10a_exp (COFOG GF03, % {bg ? "от БВП" : "of GDP"})
        </p>
      </CardContent>
    </Card>
  );
};
