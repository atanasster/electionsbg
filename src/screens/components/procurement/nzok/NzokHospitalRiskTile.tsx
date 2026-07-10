// "Риск по болници" — the НЗОК health pack's capstone: a TRANSPARENT ranking of
// hospitals by how far they sit from peer norms across three signals the rest of
// the pack already defends one by one (/awarder/121858220, migration 054).
//
// What this tile is, and — emphatically — is NOT. Each underlying signal is a
// SIGNPOST, not a verdict (drug-price dispersion has legitimate causes, a high
// cases-per-bed ratio can be day-case pathways, overdue debt can be a delayed
// transfer). This tile does not overturn any of that. It simply surfaces the
// hospitals that sit near the top of SEVERAL signposts at once — a place to start
// looking, nothing more. So every component is shown in its own column with its
// real value; the "risk index" is only the mean of the three percentile ranks
// (a missing signal counts as 0), which is why a hospital elevated on one axis
// alone tops out near 33 and only corroboration across all three approaches 100.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useNzokHospitalRisk } from "@/data/budget/useBudget";
import { FacilityLink } from "./FacilityLink";

export const NzokHospitalRiskTile: FC<{ hideTitle?: boolean }> = ({
  hideTitle,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokHospitalRisk();
  if (!data || !data.hospitals?.length) return null;

  const rows = data.hospitals.slice(0, 15);
  const dash = <span className="text-muted-foreground/40">—</span>;

  return (
    <Card>
      {!hideTitle && (
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {bg ? "Риск по болници" : "Hospitals by risk index"}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Съставен индекс, който съчетава три вече показани сигнала: надплащане за лекарства над медианата, случаи на легло над сходните болници и просрочени задължения. Индексът е средното от процентните рангове на трите — колкото повече сигнала съвпадат, толкова по-висок е той. Всеки показател е видим отделно."
            : "A composite of three signals the pack already shows: paying above the median for drugs, cases-per-bed above same-type peers, and overdue debt. The index is the mean of the three percentile ranks — the more signals coincide, the higher it climbs. Every component stays visible on its own."}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Болница" : "Hospital"}
                </th>
                <th
                  className="py-1.5 pr-2 text-right font-normal"
                  title={
                    bg
                      ? "Сума, платена над медианната цена за същата опаковка (годишно)"
                      : "Euros paid above the pack median (annual)"
                  }
                >
                  {bg ? "Лекарства" : "Drugs"}
                </th>
                <th
                  className="py-1.5 pr-2 text-right font-normal"
                  title={
                    bg
                      ? "Брой процедури с случаи/легло над медианата на сходните болници"
                      : "Procedures with cases-per-bed above the same-type peer median"
                  }
                >
                  {bg ? "Дейност" : "Activity"}
                </th>
                <th
                  className="py-1.5 pr-2 text-right font-normal"
                  title={
                    bg
                      ? "Просрочени задължения (последно тримесечие)"
                      : "Overdue liabilities (latest quarter)"
                  }
                >
                  {bg ? "Просрочени" : "Overdue"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Риск" : "Risk"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((h) => (
                <tr key={h.eik}>
                  <td className="max-w-[15rem] truncate py-1.5 pr-2">
                    <FacilityLink eik={h.eik} name={h.facility} />
                    <span className="block text-[10px] text-muted-foreground">
                      {bg
                        ? `${h.signalsPresent} от 3 сигнала`
                        : `${h.signalsPresent} of 3 signals`}
                    </span>
                  </td>
                  <td
                    className="py-1.5 pr-2 text-right tabular-nums"
                    title={
                      h.drugOverpayEur == null
                        ? undefined
                        : bg
                          ? `${h.drugPackCount} опаковки над медианата · ${h.drugInnCount} INN · макс ${h.drugMaxRatio?.toFixed(1)}×`
                          : `${h.drugPackCount} packs above median · ${h.drugInnCount} INN · max ${h.drugMaxRatio?.toFixed(1)}×`
                    }
                  >
                    {h.drugOverpayEur != null
                      ? `+${formatEurCompact(h.drugOverpayEur, i18n.language)}`
                      : dash}
                  </td>
                  <td
                    className="py-1.5 pr-2 text-right tabular-nums"
                    title={
                      h.activityOutliers == null || h.activityMaxRatio == null
                        ? undefined
                        : bg
                          ? `макс ${h.activityMaxRatio.toFixed(1)}× над медианата на сходните`
                          : `max ${h.activityMaxRatio.toFixed(1)}× above the peer median`
                    }
                  >
                    {h.activityOutliers != null ? h.activityOutliers : dash}
                  </td>
                  <td
                    className="py-1.5 pr-2 text-right tabular-nums"
                    title={
                      h.overdueEur == null || h.overduePct == null
                        ? undefined
                        : bg
                          ? `${h.overduePct}% от приходите`
                          : `${h.overduePct}% of revenue`
                    }
                  >
                    {h.overdueEur != null && h.overdueEur > 0 ? (
                      formatEurCompact(h.overdueEur, i18n.language)
                    ) : h.overdueEur === 0 ? (
                      <span className="text-muted-foreground/60">0</span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span
                        className="h-1.5 w-10 overflow-hidden rounded-full bg-muted"
                        aria-hidden
                      >
                        <span
                          className="block h-full rounded-full bg-amber-500/70"
                          style={{ width: `${h.riskIndex}%` }}
                        />
                      </span>
                      <span className="w-6 tabular-nums font-medium">
                        {h.riskIndex}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Индексът е ориентир за къде да се погледне по-внимателно, НЕ заключение за нередност — всеки от трите сигнала има законни обяснения (обем, срок на доставка, дневен стационар, забавен трансфер). Празно поле = няма данни за този сигнал (не нула). Обхват: ${data.coverage.drug} болници с данни за лекарства, ${data.coverage.activity} за дейност, ${data.coverage.financial} за финанси. Източници: НЗОК „Справка 5" (${data.drugYear}); НЗОК месечни отчети за дейността (${data.drugYear}); МЗ финансови показатели (${data.finQuarter}).`
            : `The index points to where to look more closely, NOT a finding of wrongdoing — each of the three signals has legitimate explanations (volume, delivery terms, day-case pathways, delayed transfer). A blank cell means no data for that signal (not zero). Coverage: ${data.coverage.drug} hospitals with drug data, ${data.coverage.activity} with activity, ${data.coverage.financial} with financials. Sources: НЗОК "Справка 5" (${data.drugYear}); НЗОК monthly activity reports (${data.drugYear}); МЗ financial indicators (${data.finQuarter}).`}
        </p>
      </CardContent>
    </Card>
  );
};
