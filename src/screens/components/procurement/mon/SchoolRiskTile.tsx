// "Риск: училища за проследяване" — the equity-risk companion on the МОН pack.
// It ranks schools that score FURTHEST BELOW what their community's social
// context predicts (the negative tail of the same SES regression the /education
// scatter draws), and badges the ones the independent 7th→12th value-added model
// ALSO flags as under-performing — the two-signal corroboration that lifts a
// school from "poor context" to "poor context AND losing ground on its own
// intake". Each row opens the school's report card.
//
// A residual is a SIGNPOST, not a verdict: it points at schools where the gap
// between outcome and context is widest — a place for МОН/an oblast to look, not
// a finding about the school. Small cohorts (<10 graduates) never carry a
// verdict, so they can't appear here.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSchoolRisk } from "@/data/schools/useSchoolDirectory";

const fmt = (v: number, lang: string): string =>
  v.toLocaleString(lang === "bg" ? "bg-BG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const SchoolRiskTile: FC<{ hideTitle?: boolean }> = ({ hideTitle }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useSchoolRisk();
  if (!data) return null;

  // The slim 'risk' payload is already the negative tail of the SES regression —
  // schools under their context's expectation, worst first — so just cap it.
  const rows = data.schools.slice(0, 15);
  if (!rows.length) return null;

  return (
    <Card>
      {!hideTitle && (
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {bg ? "Риск: училища за проследяване" : "Schools to watch by risk"}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Училищата, които постигат най-много ПОД очакваното за подобни училища (в сходни условия). „Разлика“ е успехът минус очакваното. Знакът „2 сигнала“ значи, че и моделът за напредък 7→12 клас ги отчита като изоставащи."
            : "Schools scoring furthest BELOW what their community's social context predicts. “Gap” is score minus expectation. The “2 signals” badge means the independent 7th→12th progress model also flags them as under-performing."}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Училище" : "School"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Успех" : "Score"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Очаквано" : "Expected"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Разлика" : "Gap"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => {
                const twoSignals = s.vaVerdict === "under";
                return (
                  <tr key={s.id}>
                    <td className="max-w-[15rem] truncate py-1.5 pr-2">
                      <Link
                        to={`/school/${s.id}`}
                        className="text-accent hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="block text-[10px] text-muted-foreground">
                        {s.obshtinaName}
                        {twoSignals && (
                          <span className="ml-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                            {bg ? "2 сигнала" : "2 signals"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                      {s.latestScore != null ? fmt(s.latestScore, lang) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                      {s.predicted != null ? fmt(s.predicted, lang) : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                      {s.residual != null ? s.residual.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Разликата спрямо очакваното е ориентир къде да се погледне, НЕ присъда за училището — условията обясняват голяма част от успеха, но не всичко. Училища с под 10 зрелостници не се класират. Матура по БЕЛ, ${data.latestYear}. Виж пълната графика „успех спрямо подобни училища“ на страницата на училищата.`
            : `A gap versus the expectation is a signpost for where to look, NOT a verdict on the school — context explains much of the score, not all of it. Schools with fewer than 10 graduates are not ranked. Bulgarian matura, ${data.latestYear}. See the full “score versus context” chart on the schools page.`}
        </p>
      </CardContent>
    </Card>
  );
};
