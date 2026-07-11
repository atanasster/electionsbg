// Най-големите филмови субсидии — the biggest single НФЦ awards, newest-first
// within amount. A Top-N preview of the full corpus; each row shows the film,
// producer, discipline swatch, year and the subsidy. (A dedicated /culture/films
// browser is the Phase-3 "See all" target — plan §5.1 tile 12.)

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { FilmAward } from "@/data/culture/types";
import { DISCIPLINE_COLOR, disciplineLabel } from "./cultureLabels";

export const CultureFilmAwardsTile: FC<{ films: FilmAward[] }> = ({
  films,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [expanded, setExpanded] = useState(false);
  if (films.length === 0) return null;

  const ranked = [...films].sort((a, b) => b.subsidyEur - a.subsidyEur);
  const shown = ranked.slice(0, expanded ? 40 : 10);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Film className="h-4 w-4" />
          {bg ? "Най-големите субсидии за филм" : "Largest film subsidies"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <ul className="divide-y divide-border/60">
          {shown.map((f, i) => (
            <li
              key={`${f.year}-${f.regNo}-${i}`}
              className="flex items-center gap-3 py-1.5"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-sm ${DISCIPLINE_COLOR[f.discipline]}`}
                title={disciplineLabel(f.discipline, lang)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={f.title}>
                  {f.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {f.producer} · {f.year}
                </div>
              </div>
              <span className="shrink-0 tabular-nums text-sm font-medium">
                {formatEurCompact(f.subsidyEur, lang)}
              </span>
            </li>
          ))}
        </ul>
        {ranked.length > 10 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {expanded
              ? bg
                ? "Свий"
                : "Show less"
              : bg
                ? `Виж още (${ranked.length} общо)`
                : `Show more (${ranked.length} total)`}
          </button>
        )}
      </CardContent>
    </Card>
  );
};
