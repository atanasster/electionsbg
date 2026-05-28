// Crime stats tile — monthly tallies per ОДМВР (oblast grain). Auto-hides
// until update-crime-stats populates the data file.
//
// Caveat is explicit: the data is per oblast, not per município — МВР
// doesn't publish finer-grained official monthly stats. Surfacing this in
// the tile prevents the user from thinking it's their município's number.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCrime, type CrimeCategory } from "@/data/crime/useCrime";

type Props = {
  oblast: string;
};

const CATEGORIES: CrimeCategory[] = [
  "property",
  "violent",
  "traffic",
  "drugs",
  "fraud",
  "other",
];

export const MyAreaCrimeTile: FC<Props> = ({ oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, monthly } = useCrime(oblast);

  const summary = useMemo(() => {
    if (!monthly || !data?.latestMonth) return null;
    const latestData = monthly[data.latestMonth];
    if (!latestData) return null;
    const total = CATEGORIES.reduce((s, c) => s + (latestData[c] ?? 0), 0);
    if (total === 0) return null;
    return { latest: latestData, total, month: data.latestMonth };
  }, [monthly, data]);

  if (!data || !summary) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_crime_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {summary.month}
        </span>
      </div>
      <div className="text-2xl font-bold tabular-nums mb-2">
        {summary.total.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")}
        <span className="text-xs text-muted-foreground font-normal ml-1">
          {lang === "bg" ? "регистрирани" : "registered"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {CATEGORIES.map((c) => {
          const n = summary.latest[c] ?? 0;
          if (n === 0) return null;
          return (
            <div key={c} className="rounded border px-2 py-1">
              <div className="text-[10px] text-muted-foreground truncate">
                {data.categories[c][lang]}
              </div>
              <div className="font-bold tabular-nums">
                {n.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")}
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
