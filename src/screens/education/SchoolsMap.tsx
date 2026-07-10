// School-finder map for /education — one canvas dot per geocoded school,
// coloured by its latest matura (ДЗИ БЕЛ) average, click drills to /school/:id.
// Coordinates are settlement-centroid geocodes (scripts/schools/build_index.ts),
// so Столична община's ~157 schools stack on the Sofia city pin until per-school
// МОН-register coordinates land — the tooltip says so.
//
// Colouring by raw score is a finder aid, not a verdict: small cohorts (< the
// rank threshold) are greyed, and the SES-adjusted "growth vs similar schools"
// map is a separate, later phase.

import { FC, useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  type DirectorySchool,
  MIN_RANK_COHORT,
} from "@/data/schools/useSchoolDirectory";

import("leaflet/dist/leaflet.css");

// Colour-blind-safe-ish sequential ramp for the 2–6 matura scale. Grey = a
// cohort too small to trust (suppressed, matching the report card / tables).
const SUPPRESSED = "#94a3b8"; // slate-400
const scoreColor = (score: number | null, n: number | null): string => {
  if (score == null || (n ?? 0) < MIN_RANK_COHORT) return SUPPRESSED;
  if (score < 3.0) return "#b91c1c"; // rose-700
  if (score < 3.5) return "#ea580c"; // orange-600
  if (score < 4.0) return "#d97706"; // amber-600
  if (score < 4.5) return "#65a30d"; // lime-600
  if (score < 5.0) return "#16a34a"; // green-600
  return "#047857"; // emerald-700
};

const BG_BOUNDS: LatLngBoundsExpression = [
  [41.2, 22.3],
  [44.3, 28.7],
];

const fmtScore = (v: number, lang: string): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const parseLoc = (loc: string): [number, number] | null => {
  const [lng, lat] = loc.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
};

// The map mounts inside a lazy Suspense boundary and below the fold, so on first
// paint the container is still zero-height — Leaflet then fits `bounds` to a
// degenerate viewport and zooms to street level. Watch the container and re-fit
// the moment it actually has dimensions.
const FitBulgaria: FC = () => {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let done = false;
    const fit = () => {
      if (done || el.clientHeight <= 0 || el.clientWidth <= 0) return;
      done = true;
      map.invalidateSize();
      map.fitBounds(BG_BOUNDS, { padding: [10, 10] });
      ro.disconnect();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [map]);
  return null;
};

export const SchoolsMap: FC<{ schools: DirectorySchool[] }> = ({ schools }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const navigate = useNavigate();

  const points = useMemo(
    () =>
      schools.flatMap((s) => {
        if (!s.loc) return [];
        const c = parseLoc(s.loc);
        return c ? [{ s, c }] : [];
      }),
    [schools],
  );

  if (!points.length) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-xl border bg-card text-muted-foreground">
        {t("no_map_data") || "No map data"}
      </div>
    );
  }

  return (
    <div className="h-[460px] w-full overflow-hidden rounded-xl border">
      <MapContainer
        className="h-full w-full"
        bounds={BG_BOUNDS}
        boundsOptions={{ padding: [10, 10] }}
        scrollWheelZoom
        preferCanvas
      >
        <FitBulgaria />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map(({ s, c }) => {
          const color = scoreColor(s.latestScore, s.latestN);
          return (
            <CircleMarker
              key={s.id}
              center={c}
              radius={5}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.75,
                weight: 1,
              }}
              eventHandlers={{ click: () => navigate(`/school/${s.id}`) }}
            >
              <Tooltip direction="auto" offset={[0, -4]}>
                <div style={{ maxWidth: 230, whiteSpace: "normal" }}>
                  <div className="pb-0.5 text-sm font-semibold">{s.name}</div>
                  <div className="pb-1 text-xs opacity-80">
                    {s.obshtinaName}
                  </div>
                  {s.latestScore != null ? (
                    <div className="text-xs">
                      {bg ? "матура БЕЛ" : "Bulgarian matura"}{" "}
                      <span className="font-semibold tabular-nums">
                        {fmtScore(s.latestScore, lang)}
                      </span>{" "}
                      <span className="opacity-70">
                        ({s.latestYear} · {s.latestN ?? "?"}{" "}
                        {bg ? "зрел." : "grads"})
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs opacity-70">
                      {bg ? "няма данни" : "no data"}
                    </div>
                  )}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
};
