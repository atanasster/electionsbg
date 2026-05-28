// School-level НВО + ДЗИ scores tile. Top-3 and bottom-3 schools in the
// município by composite average across available subjects in the latest
// year. Auto-hides until update-schools populates the data file.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useSchools, type SchoolRecord } from "@/data/schools/useSchools";

type Props = {
  obshtina: string;
};

type Ranked = {
  school: SchoolRecord;
  composite: number;
};

const compositeFor = (school: SchoolRecord, year: number): number | null => {
  const yearScores = school.scoresByYear[String(year)];
  if (!yearScores) return null;
  const vals = Object.values(yearScores).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
};

export const MyAreaSchoolsTile: FC<Props> = ({ obshtina }) => {
  const { t } = useTranslation();
  const { data, schools } = useSchools(obshtina);

  const { top, bottom, year } = useMemo(() => {
    if (!data?.latestYear || schools.length === 0) {
      return { top: [] as Ranked[], bottom: [] as Ranked[], year: null };
    }
    const y = data.latestYear;
    const ranked: Ranked[] = [];
    for (const school of schools) {
      const c = compositeFor(school, y);
      if (c == null) continue;
      ranked.push({ school, composite: c });
    }
    ranked.sort((a, b) => b.composite - a.composite);
    return {
      top: ranked.slice(0, 3),
      bottom: ranked.slice(-3).reverse(),
      year: y,
    };
  }, [data, schools]);

  if (!year || top.length === 0) return null;

  const renderRow = (r: Ranked) => (
    <div
      key={r.school.id}
      className="flex items-center justify-between gap-2 text-xs"
    >
      <span className="truncate flex-1" title={r.school.name}>
        {r.school.name}
      </span>
      <span className="font-bold tabular-nums shrink-0">
        {r.composite.toFixed(2)}
      </span>
    </div>
  );

  // Suppress the bottom-3 panel when the município only has a handful of
  // schools (the same row would otherwise appear in both panels). Threshold
  // chosen to give the user a clear "best vs worst" contrast.
  const showBottom = schools.length >= 8 && bottom.length > 0;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <GraduationCap className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_schools_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {year}
        </span>
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("my_area_schools_best")}
          </div>
          <div className="flex flex-col gap-1">{top.map(renderRow)}</div>
        </div>
        {showBottom ? (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              {t("my_area_schools_worst")}
            </div>
            <div className="flex flex-col gap-1">{bottom.map(renderRow)}</div>
          </div>
        ) : null}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {t("my_area_schools_caveat")}
      </p>
    </Card>
  );
};
