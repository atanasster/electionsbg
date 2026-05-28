// Crime stats tile — per-oblast crime rate (per 10,000 inhabitants),
// annual. Latest available year + 6-category breakdown + multi-year mini
// trend. Auto-hides until update-crime-stats populates the data file.
//
// Caveat is explicit: the data is per oblast, not per município — МВР
// doesn't publish finer-grained stats. And the source dataset (the BG
// gov open-data-viz repo) hasn't been updated since 2015, so the
// "as of {year}" label makes the staleness visible.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCrime, type CrimeCategoryKey } from "@/data/crime/useCrime";

type Props = {
  oblast: string;
};

// Order matters: total first (the headline), then per-category cards.
const BREAKDOWN_CATEGORIES: CrimeCategoryKey[] = [
  "against_property",
  "against_person",
  "generally_dangerous",
  "other",
  "deaths_no_violence",
];

const formatRate = (n: number | undefined, lang: "bg" | "en"): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
  });
};

export const MyAreaCrimeTile: FC<Props> = ({ oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, yearly } = useCrime(oblast);

  const summary = useMemo(() => {
    if (!yearly || !data?.latestYear) return null;
    const latestData = yearly[data.latestYear];
    if (!latestData) return null;
    const total = latestData.total ?? 0;
    if (total === 0) return null;
    // Sort years asc for the sparkline.
    const sortedYears = Object.keys(yearly).sort();
    const sparkline = sortedYears.map((y) => ({
      year: y,
      total: yearly[y]?.total ?? null,
    }));
    return { latest: latestData, total, year: data.latestYear, sparkline };
  }, [yearly, data]);

  if (!data || !summary) return null;

  // Compact SVG sparkline of the total-rate over time.
  const sparkPoints = summary.sparkline.filter((p) => p.total != null);
  const minTotal = Math.min(...sparkPoints.map((p) => p.total as number));
  const maxTotal = Math.max(...sparkPoints.map((p) => p.total as number));
  const sparkW = 100;
  const sparkH = 18;
  const spread = maxTotal - minTotal || 1;
  const pathD = sparkPoints
    .map((p, i) => {
      const x = (i / Math.max(sparkPoints.length - 1, 1)) * sparkW;
      const y = sparkH - (((p.total as number) - minTotal) / spread) * sparkH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_crime_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {lang === "bg" ? `към ${summary.year} г.` : `as of ${summary.year}`}
        </span>
      </div>
      <div className="flex items-baseline gap-4 mb-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">
            {formatRate(summary.total, lang)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {lang === "bg"
              ? "престъпления на 10 000 души"
              : "crimes per 10,000 people"}
          </div>
        </div>
        {sparkPoints.length > 1 ? (
          <svg
            width={sparkW}
            height={sparkH}
            className="text-primary shrink-0"
            aria-hidden
          >
            <path
              d={pathD}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {BREAKDOWN_CATEGORIES.map((c) => {
          const n = summary.latest[c];
          if (n == null || n === 0) return null;
          const meta = data.categories[c];
          if (!meta) return null;
          return (
            <div key={c} className="rounded border px-2 py-1">
              <div className="text-[10px] text-muted-foreground truncate">
                {meta[lang]}
              </div>
              <div className="font-bold tabular-nums">
                {formatRate(n, lang)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {t("my_area_crime_caveat")}
      </p>
    </Card>
  );
};
