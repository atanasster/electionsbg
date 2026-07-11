// Най-големите филмови субсидии — the biggest single НФЦ awards. A Top-10 preview
// of the full corpus; each row deep-links to the film's record page, and "See all"
// opens the /culture/films browser (plan §5.1 tiles 12–13).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Film } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { FilmAward } from "@/data/culture/types";
import { filmId } from "@/data/culture/filmId";
import { DISCIPLINE_COLOR, disciplineLabel } from "./cultureLabels";

export const CultureFilmAwardsTile: FC<{ films: FilmAward[] }> = ({
  films,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  if (films.length === 0) return null;

  const ranked = [...films].sort((a, b) => b.subsidyEur - a.subsidyEur);
  const shown = ranked.slice(0, 10);

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
          {shown.map((f) => (
            <li key={filmId(f)}>
              <Link
                to={`/culture/film/${filmId(f)}`}
                className="group flex items-center gap-3 py-1.5"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-sm ${DISCIPLINE_COLOR[f.discipline]}`}
                  title={disciplineLabel(f.discipline, lang)}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-sm font-medium group-hover:text-primary"
                    title={f.title}
                  >
                    {f.title}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {f.producer} · {f.year}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums text-sm font-medium">
                  {formatEurCompact(f.subsidyEur, lang)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {ranked.length > 10 && (
          <Link
            to="/culture/films"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {bg
              ? `Виж всички ${ranked.length} субсидии`
              : `See all ${ranked.length} subsidies`}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
};
