// Имотен фонд / Property stock — per-oblast land-use composition for
// the My-Area dashboard. Sourced from НСИ's annual "Баланс на
// територията" press-release, which is itself computed from АГКК's
// digital cadastral map (so it's the closest open-data equivalent of
// a "cadastre composition" view at oblast grain).
//
// Granularity: 28 oblasts. We resolve Sofia stolitsa МИРs and the
// Plovdiv city sub-code back to NSI's canonical row in the hook
// (`useLandUse` → `resolveNsiOblast`). National figures sit on the
// same payload for the comparison row.
//
// Auto-hides when the data file is missing or the area's oblast
// can't be resolved — silent absence is consistent with the other
// My-Area tiles (Transparency / Air / Council).
//
// Bulk parcel polygons (the canonical "cadastre" view) are NOT
// available from АГКК's public portals — KAIS is per-parcel + CAPTCHA
// only, and АГКК does not publish bulk extracts. This tile is the
// realistic open-data substitute at the oblast grain.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useLandUse,
  type CategoryKey,
  type LandUseCategory,
  type LandUseOblast,
} from "@/data/landuse/useLandUse";

type Props = {
  oblast: string;
};

// Visual ramp shared with the rest of the dashboard. Roughly:
// agricultural → wheat/khaki, forest → green, urban → muted blue,
// water → cyan, transport → slate, protected → teal, disturbed →
// orange-red, unclassified → grey.
const CATEGORY_COLOR: Record<CategoryKey, string> = {
  agricultural: "#D6B85A",
  forest: "#56A86F",
  urbanized: "#5577AA",
  transport: "#6E7480",
  water: "#5BA9C2",
  protected: "#3F8E83",
  disturbed: "#D87C5A",
  unclassified: "#B7B7B7",
};

const formatPct = (v: number, lang: "bg" | "en"): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(v) + "%";

const formatKm2 = (v: number, lang: "bg" | "en"): string => {
  const n = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(v);
  return lang === "bg" ? `${n} км²` : `${n} km²`;
};

const formatDensity = (v: number, lang: "bg" | "en"): string => {
  const n = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(v);
  return lang === "bg" ? `${n} души / км²` : `${n} ppl/km²`;
};

const categoryLabel = (c: LandUseCategory, lang: "bg" | "en"): string =>
  lang === "bg" ? c.bg : c.en;

const oblastLabel = (r: LandUseOblast, lang: "bg" | "en"): string =>
  lang === "bg" ? r.nameBg : r.nameEn;

// Comparison line: how the oblast's urbanized share compares to the
// national 4.76% baseline. Returns null when the difference is within
// a third of a percentage-point (visually "about average").
const buildUrbanComparison = (
  oblastPct: number,
  nationalPct: number,
  lang: "bg" | "en",
): { text: string; tone: "good" | "bad" | "neutral" } | null => {
  if (!Number.isFinite(nationalPct) || nationalPct <= 0) return null;
  const diff = oblastPct - nationalPct;
  if (Math.abs(diff) < 0.33) {
    return {
      tone: "neutral",
      text:
        lang === "bg"
          ? `около средното за страната (${formatPct(nationalPct, lang)})`
          : `about national average (${formatPct(nationalPct, lang)})`,
    };
  }
  const above = diff > 0;
  // No moral valence on urbanization — paint above as "neutral high"
  // and below as "neutral low" via the same muted colour.
  return {
    tone: "neutral",
    text:
      lang === "bg"
        ? `${above ? "над" : "под"} средното за страната (${formatPct(nationalPct, lang)})`
        : `${above ? "above" : "below"} national average (${formatPct(nationalPct, lang)})`,
  };
};

export const MyAreaPropertyStockTile: FC<Props> = ({ oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, year, oblastRow, latestYear } = useLandUse(oblast);

  // Sort categories by oblast share descending so the visual stack
  // leads with whatever dominates this oblast (forest in Smolyan,
  // agricultural in Dobrich, urbanized in Sofia stolitsa).
  const orderedCategories = useMemo<LandUseCategory[]>(() => {
    if (!data || !oblastRow) return [];
    return [...data.categories].sort(
      (a, b) => oblastRow.byCategoryPct[b.key] - oblastRow.byCategoryPct[a.key],
    );
  }, [data, oblastRow]);

  if (!data || !year || !oblastRow || latestYear == null) return null;

  const urbanCompare = buildUrbanComparison(
    oblastRow.byCategoryPct.urbanized,
    year.national.byCategoryPct.urbanized,
    lang,
  );

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <MapIcon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {lang === "bg" ? "Имотен фонд" : "Property stock"}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {lang === "bg"
            ? `към 31.12.${latestYear}`
            : `as of 31.12.${latestYear}`}
        </span>
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        {lang === "bg"
          ? `Земеползване в област ${oblastLabel(oblastRow, "bg")} — ${formatKm2(oblastRow.totalKm2, lang)}, гъстота ${formatDensity(oblastRow.popDensityTotal, lang)}.`
          : `Land use in ${oblastLabel(oblastRow, "en")} district — ${formatKm2(oblastRow.totalKm2, lang)}, density ${formatDensity(oblastRow.popDensityTotal, lang)}.`}
      </div>

      {/* Stacked composition bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-md border">
        {orderedCategories.map((c) => {
          const pct = oblastRow.byCategoryPct[c.key];
          if (pct <= 0) return null;
          return (
            <div
              key={c.key}
              className="h-full"
              style={{
                width: `${pct}%`,
                backgroundColor: CATEGORY_COLOR[c.key],
              }}
              title={`${categoryLabel(c, lang)} · ${formatPct(pct, lang)}`}
            />
          );
        })}
      </div>

      {/* Per-category legend, sorted by oblast share. We show the share
          for the oblast and, in muted text, the national reference so
          the user can spot where this oblast diverges from the country
          mean. */}
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {orderedCategories.map((c) => {
          const oblastPct = oblastRow.byCategoryPct[c.key];
          const nationalPct = year.national.byCategoryPct[c.key];
          return (
            <li key={c.key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: CATEGORY_COLOR[c.key] }}
              />
              <span className="flex-1 truncate">{categoryLabel(c, lang)}</span>
              <span className="tabular-nums font-medium">
                {formatPct(oblastPct, lang)}
              </span>
              <span className="tabular-nums text-muted-foreground w-12 text-right">
                {formatPct(nationalPct, lang)}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
        <div className="text-muted-foreground">
          {lang === "bg" ? "Урбанизирани територии: " : "Urbanized areas: "}
          <span className="font-medium text-foreground">
            {formatPct(oblastRow.byCategoryPct.urbanized, lang)}
          </span>
          {urbanCompare ? (
            <span className="ml-1">· {urbanCompare.text}</span>
          ) : null}
        </div>
        <div className="text-muted-foreground tabular-nums">
          {lang === "bg" ? "ср. за страната" : "national avg"}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">
        {lang === "bg"
          ? "Източник: НСИ, изчислено от дигиталния модел на кадастралната карта (АГКК). Гранулярност: 28 области (общинско ниво не се публикува). "
          : "Source: NSI, computed from the digital cadastral map (АГКК). Granularity: 28 districts (municipal-level figures are not published). "}
        <a
          href={year.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {lang === "bg" ? "PDF" : "PDF"}
        </a>
        {" · "}
        <a
          href={data.source.url}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {lang === "bg" ? "НСИ" : "NSI"}
        </a>
      </p>
      {/* Reference t() so future translatable copy can hook in without
          re-adding the import. */}
      <span hidden aria-hidden>
        {t("my_area_dashboard")}
      </span>
    </Card>
  );
};
