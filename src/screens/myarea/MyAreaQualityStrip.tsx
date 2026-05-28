// Single "quality of life" strip — collapses MyAreaSchoolsTile /
// MyAreaServicesTile / MyAreaAirTile into one card with headline numbers.
// Each column auto-hides individually if its data is missing; the whole
// strip auto-hides when fewer than 2 columns have data, to avoid an
// awkward "1 stat alone in a wide card" state.
//
// The full per-tile detail is still available on the canonical
// /settlement/<obshtina> and /municipality/<oblast> routes (the user
// reaches them via the footer "Виж пълно табло" link card).
//
// Crime is intentionally absent — Eurostat publishes its sub-national
// crime series at NUTS 3 (oblast) only, which is too coarse for the
// settlement-grain My-Area page. National crime trends now live on
// /indicators/society under "Safety and criminal justice".

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, Wind, Stethoscope } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useSchools } from "@/data/schools/useSchools";
import { useServices } from "@/data/services/useServices";
import { useAirQuality } from "@/data/air/useAirQuality";

type Props = {
  obshtina: string;
};

type Comparison = {
  /** Short "vs national" line, e.g. "над средното · 1483 / 1102 средно". */
  text: string;
  /** "good" → green (this area beats the national avg on a metric where
   *  higher/lower is better), "bad" → rose, "neutral" → muted. */
  tone: "good" | "bad" | "neutral";
};

type Column = {
  key: string;
  icon: typeof GraduationCap;
  label: string;
  value: string;
  caption?: string;
  comparison?: Comparison;
  to: string;
};

// Build a "vs national average" comparison line. `higherIsBetter` flips
// the good/bad tone (school grades: higher is better). Returns null
// when there's no meaningful national reference.
const buildComparison = (
  value: number,
  nationalAvg: number | null,
  higherIsBetter: boolean,
  formatted: string,
  lang: "bg" | "en",
): Comparison | null => {
  if (
    nationalAvg == null ||
    !Number.isFinite(nationalAvg) ||
    nationalAvg <= 0
  ) {
    return null;
  }
  const above = value > nationalAvg;
  const better = higherIsBetter ? above : !above;
  // Within ±3% of the national average reads as "about average".
  const ratio = Math.abs(value - nationalAvg) / nationalAvg;
  const isAvg = ratio < 0.03;
  const avgLabel = lang === "bg" ? "ср. за страната" : "national avg";
  if (isAvg) {
    return {
      tone: "neutral",
      text:
        lang === "bg"
          ? `около средното · ${formatted} ${avgLabel}`
          : `about average · ${formatted} ${avgLabel}`,
    };
  }
  const word =
    lang === "bg"
      ? above
        ? "над средното"
        : "под средното"
      : above
        ? "above avg"
        : "below avg";
  return {
    tone: better ? "good" : "bad",
    text: `${word} · ${formatted} ${avgLabel}`,
  };
};

export const MyAreaQualityStrip: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  // All three data hooks fire in parallel; React Query dedupes them
  // across other consumers (the full tiles on the canonical pages).
  const { data: schoolsFile, schools } = useSchools(obshtina);
  const { services } = useServices(obshtina);
  const { data: airFile, stations } = useAirQuality(obshtina);

  // National school composite average — mean composite across every
  // school in every município for the latest year. schoolsByObshtina is
  // already loaded, so this is an in-memory reduce.
  const nationalSchoolAvg = useMemo<number | null>(() => {
    if (!schoolsFile?.latestYear) return null;
    const yr = String(schoolsFile.latestYear);
    const composites: number[] = [];
    for (const list of Object.values(schoolsFile.schoolsByObshtina)) {
      for (const s of list) {
        const yearScores = s.scoresByYear[yr];
        if (!yearScores) continue;
        const vals = Object.values(yearScores).filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        );
        if (vals.length === 0) continue;
        composites.push(vals.reduce((sum, v) => sum + v, 0) / vals.length);
      }
    }
    if (composites.length === 0) return null;
    return composites.reduce((s, x) => s + x, 0) / composites.length;
  }, [schoolsFile]);

  const cols = useMemo<Column[]>(() => {
    const out: Column[] = [];
    const muniHref = `/settlement/${obshtina}`;

    // Air — average PM10 reading across all stations in the município.
    if (airFile && stations.length > 0) {
      const pm10Vals: number[] = [];
      for (const s of stations) {
        const v = s.latestReadings.pm10;
        if (typeof v === "number" && Number.isFinite(v)) pm10Vals.push(v);
      }
      if (pm10Vals.length > 0) {
        const avg = pm10Vals.reduce((s, x) => s + x, 0) / pm10Vals.length;
        out.push({
          key: "air",
          icon: Wind,
          label: lang === "bg" ? "ФПЧ₁₀" : "PM10",
          value: avg.toFixed(0),
          caption:
            lang === "bg"
              ? `${airFile.pollutants.pm10?.unit ?? ""} · ${stations.length === 1 ? "1 станция" : `${stations.length} станции`}`
              : `${airFile.pollutants.pm10?.unit ?? ""} · ${stations.length} ${stations.length === 1 ? "station" : "stations"}`,
          to: muniHref,
        });
      }
    }

    // Schools — average ДЗИ + НВО composite across all schools in the
    // município (latest year). Same composite the per-school tile shows.
    if (schoolsFile?.latestYear && schools.length > 0) {
      const yr = schoolsFile.latestYear;
      const composites: number[] = [];
      for (const s of schools) {
        const yearScores = s.scoresByYear[String(yr)];
        if (!yearScores) continue;
        const vals = Object.values(yearScores).filter(
          (v): v is number => typeof v === "number" && Number.isFinite(v),
        );
        if (vals.length === 0) continue;
        composites.push(vals.reduce((sum, v) => sum + v, 0) / vals.length);
      }
      if (composites.length > 0) {
        const avg = composites.reduce((s, x) => s + x, 0) / composites.length;
        out.push({
          key: "schools",
          icon: GraduationCap,
          label: lang === "bg" ? "Училища" : "Schools",
          value: avg.toFixed(2),
          caption:
            lang === "bg"
              ? `среден успех · ${composites.length} ${composites.length === 1 ? "училище" : "училища"}`
              : `avg grade · ${composites.length} ${composites.length === 1 ? "school" : "schools"}`,
          comparison:
            buildComparison(
              avg,
              nationalSchoolAvg,
              true, // higher grade is better
              (nationalSchoolAvg ?? 0).toFixed(2),
              lang,
            ) ?? undefined,
          to: muniHref,
        });
      }
    }

    // Services — total entries across all categories. The categories
    // themselves are visible on the canonical page.
    if (services) {
      let total = 0;
      for (const cat of Object.keys(services) as Array<keyof typeof services>) {
        const list = services[cat];
        if (Array.isArray(list)) total += list.length;
      }
      if (total > 0) {
        out.push({
          key: "services",
          icon: Stethoscope,
          label: lang === "bg" ? "Услуги" : "Services",
          value: String(total),
          caption:
            lang === "bg" ? "ОПЛ, аптеки, поща, …" : "GPs, pharmacies, post, …",
          to: muniHref,
        });
      }
    }

    return out;
  }, [
    airFile,
    stations,
    schoolsFile,
    schools,
    services,
    lang,
    obshtina,
    nationalSchoolAvg,
  ]);

  // Don't render a near-empty strip — if only one column has data, the
  // standalone tile pattern was better.
  if (cols.length < 2) return null;

  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">
          {lang === "bg" ? "Качество на живота" : "Quality of life"}
        </h2>
      </div>
      <div
        className={`grid gap-3 grid-cols-2 ${
          cols.length >= 3 ? "md:grid-cols-3" : ""
        } ${cols.length >= 4 ? "lg:grid-cols-4" : ""}`}
      >
        {cols.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.key}
              to={c.to}
              underline={false}
              className="block rounded-md border p-3 hover:bg-accent/40 transition-colors"
              aria-label={`${c.label}: ${c.value}${c.caption ? ` — ${c.caption}` : ""}`}
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                <Icon className="size-3.5" />
                <span>{c.label}</span>
              </div>
              <div className="text-2xl font-bold tabular-nums leading-tight">
                {c.value}
              </div>
              {c.caption ? (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {c.caption}
                </div>
              ) : null}
              {c.comparison ? (
                <div
                  className={`text-[10px] mt-1 font-medium ${
                    c.comparison.tone === "good"
                      ? "text-emerald-600"
                      : c.comparison.tone === "bad"
                        ? "text-rose-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {c.comparison.text}
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
      {/* Reference `t` so future translatable copy lands here without
          re-adding the import. */}
      <span hidden aria-hidden>
        {t("my_area_dashboard")}
      </span>
    </Card>
  );
};
