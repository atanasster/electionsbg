// School-finder map for /education — one dot per geocoded school, coloured by its
// latest matura (ДЗИ БЕЛ) average; click drills to /school/:id. Rendered via the
// shared SectorPointMap: schools sharing a settlement centroid collapse into one
// count badge with a pager (browse each school), and fan out into individual score
// dots once you zoom in. Coordinates are settlement-centroid geocodes
// (scripts/schools/build_index.ts), so Столична община's ~157 schools stack on the
// Sofia city pin — too many to spiderfy, so they stay a pager badge (the caption
// says so) until per-school МОН-register coordinates land.
//
// Colouring by raw score is a finder aid, not a verdict: small cohorts (< the rank
// threshold) are greyed, and the SES-adjusted "growth vs similar schools" map is a
// separate, later phase.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import {
  type DirectorySchool,
  MIN_RANK_COHORT,
} from "@/data/schools/useSchoolDirectory";

// Colour-blind-safe-ish sequential ramp for the 2–6 matura scale. Grey = a cohort
// too small to trust (suppressed, matching the report card / tables + the legend).
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

const fmtScore = (v: number, lang: string): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// settlements.json / school `loc` is "lng,lat" — SectorMapPoint.loc is [lng, lat].
const parseLoc = (loc: string): [number, number] | null => {
  const [lng, lat] = loc.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
};

// Zoom at/above which a settlement's co-located schools fan out into individual
// score dots; below it (or for the huge София stack) they stay one count badge.
const SPREAD_ZOOM = 11;

export const SchoolsMap: FC<{ schools: DirectorySchool[] }> = ({ schools }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const points = useMemo<SectorMapPoint[]>(
    () =>
      schools.flatMap((s) => {
        if (!s.loc) return [];
        const loc = parseLoc(s.loc);
        if (!loc) return [];
        const detail =
          s.latestScore != null ? (
            <span>
              {bg ? "матура БЕЛ" : "Bulgarian matura"}{" "}
              <span className="font-semibold tabular-nums">
                {fmtScore(s.latestScore, lang)}
              </span>{" "}
              <span className="opacity-70">
                ({s.latestYear} · {s.latestN ?? "?"} {bg ? "зрел." : "grads"})
              </span>
            </span>
          ) : (
            <span className="opacity-70">{bg ? "няма данни" : "no data"}</span>
          );
        return [
          {
            id: s.id,
            loc,
            // Orders a group's pager (busiest = highest score first) and, in
            // SectorPointMap, the inter-marker draw order (higher score drawn on
            // top) — the latter is incidental for a score finder, not meaningful.
            value: s.latestScore ?? -1,
            color: scoreColor(s.latestScore, s.latestN),
            badge: 1, // each school counts one — the badge shows how many share the pin
            title: s.name,
            subtitle: s.obshtinaName,
            detail,
            href: `/school/${s.id}`,
          } satisfies SectorMapPoint,
        ];
      }),
    [schools, bg, lang],
  );

  if (!points.length) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-xl border bg-card text-muted-foreground">
        {t("no_map_data") || "No map data"}
      </div>
    );
  }

  return (
    <SectorPointMap
      points={points}
      dotMode
      preferCanvas
      spreadZoom={SPREAD_ZOOM}
      groupNoun={bg ? "училища" : "schools"}
      openLabel={bg ? "Виж училището" : "Open school"}
      height={460}
    />
  );
};
