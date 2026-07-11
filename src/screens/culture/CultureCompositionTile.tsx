// "Къде отиват парите за кино" — the НФЦ film subsidy split by discipline, as a
// single horizontal composition bar + a swatch/value/percent legend (the house
// bridge-bar idiom). Colour follows the discipline id, never its rank.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { DisciplineBucket } from "@/data/culture/types";
import {
  DISCIPLINE_COLOR,
  DISCIPLINE_ORDER,
  disciplineLabel,
} from "./cultureLabels";

export const CultureCompositionTile: FC<{
  byDiscipline: DisciplineBucket[];
  totalEur: number;
}> = ({ byDiscipline, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  if (totalEur <= 0) return null;

  // Fixed order so the bar and legend never reshuffle with the data.
  const rows = DISCIPLINE_ORDER.map(
    (d) =>
      byDiscipline.find((b) => b.discipline === d) ?? {
        discipline: d,
        eur: 0,
        count: 0,
      },
  ).filter((r) => r.eur > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clapperboard className="h-4 w-4" />
          {bg
            ? "Държавната субсидия за кино — по вид"
            : "State film subsidy — by discipline"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex h-6 w-full overflow-hidden rounded-md">
          {rows.map((r) => (
            <div
              key={r.discipline}
              className={DISCIPLINE_COLOR[r.discipline]}
              style={{ width: `${(r.eur / totalEur) * 100}%` }}
              title={`${disciplineLabel(r.discipline, lang)} · ${formatEurCompact(r.eur, lang)}`}
            />
          ))}
        </div>
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.discipline} className="flex items-center gap-2 text-sm">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-sm ${DISCIPLINE_COLOR[r.discipline]}`}
              />
              <span className="min-w-0 flex-1 truncate">
                {disciplineLabel(r.discipline, lang)}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.count} {bg ? "проекта" : "projects"}
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums font-medium">
                {formatEurCompact(r.eur, lang)}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {Math.round((r.eur / totalEur) * 100)}%
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? "Видът е определен по регистрационния номер на проекта (И/Д/А)."
            : "Discipline is derived from the project's registration number (И/Д/А)."}
        </p>
      </CardContent>
    </Card>
  );
};
