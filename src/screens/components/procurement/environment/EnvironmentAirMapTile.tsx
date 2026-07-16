// ★ The signature outcome hero of /sector/environment: „Качеството на въздуха, което
// измерваме" — one marker per municipality with an ИАОС monitoring station, coloured by
// the latest measured ФПЧ10 (PM10) against the EU limit (50 µg/m³). This is the half of
// the money-vs-outcome story the procurement corpus can't show: the RESULT. ИАОС — the
// agency that produces this very series — is itself a top-tier buyer in the group.
//
// Renders CLIENT-SIDE off the already-loaded air/index.json (37 foreground stations) +
// municipalities.json centroids — NO server route (§0.5). Stations key on obshtina codes
// (no coords in source) → município centroids; Sofia (SOF00) has no municipalities.json
// row, so its centroid is pinned. The 14 background/mountain stations carry an empty
// obshtina and are omitted (a separate regional-context layer is a Phase-3 item).
//
// ⚠ Snapshot, not a trend: air/index.json holds only the latest quarterly readings +
// maxObserved (no historical series) — the caption says as-of, and the money-vs-outcome
// TREND lives in EnvironmentAirMoneyTile (money trend + this snapshot).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wind } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import { useAirQuality, type AirStation } from "@/data/air/useAirQuality";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";

// Sofia city (Столична) has no data/municipalities.json row (the SFO* codes are the
// Sofia-oblast municipalities, not the city) — pin the city centroid.
const SOF00_LOC: [number, number] = [23.3219, 42.6977];

// PM10 EU limit is 50 µg/m³. A fixed green/amber/red ramp keyed to the limit (not to
// rank) — dataviz house rule for a hard-yardstick metric.
const PM10_LIMIT = 50;
const bandOf = (
  pm10: number,
): { color: string; label: { bg: string; en: string } } => {
  if (pm10 < PM10_LIMIT / 2)
    return { color: "#15803d", label: { bg: "нисък", en: "low" } };
  if (pm10 < PM10_LIMIT)
    return { color: "#d97706", label: { bg: "умерен", en: "moderate" } };
  return { color: "#b91c1c", label: { bg: "над нормата", en: "over limit" } };
};
const NO_DATA = "#94a3b8";

interface ObshtinaAir {
  obshtina: string;
  meanPm10: number | null;
  meanPm25: number | null;
  maxPm10: number | null;
  stationCount: number;
  stations: AirStation[];
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const EnvironmentAirMapTile: FC<{ snapshotAsOf?: string | null }> = ({
  snapshotAsOf,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: air } = useAirQuality();
  const { municipalities, findMunicipality } = useMunicipalities();

  // Aggregate the foreground stations to one row per obshtina (a município can hold
  // several stations — e.g. Sofia's network).
  const byObshtina = useMemo<ObshtinaAir[]>(() => {
    const map = new Map<string, AirStation[]>();
    for (const s of air?.stations ?? []) {
      if (!s.obshtina) continue;
      const arr = map.get(s.obshtina) ?? [];
      arr.push(s);
      map.set(s.obshtina, arr);
    }
    return [...map.entries()].map(([obshtina, stations]) => {
      const pm10s = stations
        .map((s) => s.latestReadings?.pm10)
        .filter((v): v is number => v != null);
      const pm25s = stations
        .map((s) => s.latestReadings?.pm25)
        .filter((v): v is number => v != null);
      const maxes = stations
        .map(
          (s) =>
            (s as AirStation & { maxObserved?: { pm10?: number } }).maxObserved
              ?.pm10,
        )
        .filter((v): v is number => v != null);
      return {
        obshtina,
        meanPm10: mean(pm10s),
        meanPm25: mean(pm25s),
        maxPm10: maxes.length ? Math.max(...maxes) : null,
        stationCount: stations.length,
        stations,
      };
    });
  }, [air]);

  // National station-mean (foreground) — the headline figure.
  const nationalMean = useMemo(() => {
    const vals = byObshtina
      .map((o) => o.meanPm10)
      .filter((v): v is number => v != null);
    return mean(vals);
  }, [byObshtina]);

  const points = useMemo<SectorMapPoint[]>(() => {
    if (!municipalities?.length) return [];
    const out: SectorMapPoint[] = [];
    for (const o of byObshtina) {
      let loc: [number, number] | null = null;
      if (o.obshtina === "SOF00") loc = SOF00_LOC;
      else {
        const m = findMunicipality(o.obshtina);
        const raw = m?.loc;
        if (typeof raw === "string" && raw.includes(",")) {
          const [lng, lat] = raw.split(",").map(Number);
          if (Number.isFinite(lng) && Number.isFinite(lat)) loc = [lng, lat];
        }
      }
      if (!loc) continue;
      const pm10 = o.meanPm10;
      const band = pm10 != null ? bandOf(pm10) : null;
      const name =
        o.obshtina === "SOF00"
          ? bg
            ? "Столична"
            : "Sofia"
          : (findMunicipality(o.obshtina)?.[bg ? "name" : "name_en"] ??
            o.obshtina);
      out.push({
        id: o.obshtina,
        loc,
        value: pm10 ?? -1,
        color: band?.color ?? NO_DATA,
        badge: o.stationCount,
        title: String(name),
        subtitle: bg
          ? `${o.stationCount} ${o.stationCount === 1 ? "станция" : "станции"}`
          : `${o.stationCount} station${o.stationCount === 1 ? "" : "s"}`,
        detail: (
          <div className="space-y-0.5">
            {pm10 != null && (
              <div>
                <span className="opacity-70">ФПЧ10: </span>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: band?.color }}
                >
                  {pm10.toLocaleString(bg ? "bg-BG" : "en-US", {
                    maximumFractionDigits: 0,
                  })}
                </span>{" "}
                <span className="opacity-60">/ {PM10_LIMIT} µg/m³</span>
              </div>
            )}
            {o.meanPm25 != null && (
              <div className="opacity-70">
                ФПЧ2.5:{" "}
                <span className="font-medium tabular-nums">
                  {o.meanPm25.toLocaleString(bg ? "bg-BG" : "en-US", {
                    maximumFractionDigits: 0,
                  })}
                </span>{" "}
                / 25 µg/m³
              </div>
            )}
            {o.maxPm10 != null && (
              <div className="opacity-60">
                {bg ? "връх ФПЧ10: " : "peak PM10: "}
                <span className="tabular-nums">
                  {o.maxPm10.toLocaleString(bg ? "bg-BG" : "en-US", {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
            )}
          </div>
        ),
        href: `/municipality/${o.obshtina}`,
      });
    }
    return out;
  }, [byObshtina, municipalities, findMunicipality, bg]);

  if (!air || points.length < 3) return null;

  const asOf = snapshotAsOf ?? air.snapshotAsOf;

  return (
    <Card data-og="environment-air-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wind className="h-4 w-4" />
          {bg
            ? "Качеството на въздуха, което измерваме"
            : "The air quality we measure"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {nationalMean != null && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="text-2xl font-bold tabular-nums"
              style={{ color: bandOf(nationalMean).color }}
            >
              {nationalMean.toLocaleString(bg ? "bg-BG" : "en-US", {
                maximumFractionDigits: 0,
              })}{" "}
              µg/m³
            </span>
            <span className="text-xs text-muted-foreground">
              {bg
                ? `средно ФПЧ10 по станции (норма на ЕС ${PM10_LIMIT})`
                : `mean PM10 across stations (EU limit ${PM10_LIMIT})`}
            </span>
          </div>
        )}

        <SectorPointMap
          points={points}
          groupNoun={bg ? "общини" : "municipalities"}
          badgeNoun={bg ? "станции" : "stations"}
          openLabel={bg ? "Към общината" : "To the municipality"}
        />

        {/* Colour bands */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{bg ? "ФПЧ10 (последно):" : "PM10 (latest):"}</span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "#15803d" }}
            />
            {bg ? "< 25" : "< 25"}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "#d97706" }}
            />
            25–50
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "#b91c1c" }}
            />
            {bg ? "≥ 50 (над нормата)" : "≥ 50 (over limit)"}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Всяка точка е община с измервателна станция на ИАОС (агенция на МОСВ), оцветена по последното средно ниво на ФПЧ10 спрямо нормата на ЕС от ${PM10_LIMIT} µg/m³${asOf ? ` (към ${asOf})` : ""}. Това е моментна снимка, не тренд. Фоновите/планинските станции без община не са показани.`
            : `Each point is a municipality with an ИАОС monitoring station (an МОСВ agency), coloured by the latest mean PM10 against the EU limit of ${PM10_LIMIT} µg/m³${asOf ? ` (as of ${asOf})` : ""}. This is a snapshot, not a trend. Background/mountain stations with no municipality are not shown.`}
        </p>
      </CardContent>
    </Card>
  );
};
