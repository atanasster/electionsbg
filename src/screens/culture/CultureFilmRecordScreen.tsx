// /culture/film/:id — the record page for a single НФЦ film subsidy. A shareable,
// SEO-titled detail of one award (discipline, producer, year, subsidy in EUR+BGN,
// production stage, рег.№, ФК protocol) plus the producer's other funded films.
// Plan §5.1 tile 13. Resolved client-side from the whole films.json via the shared
// filmId (the register's рег.№ isn't unique) — see @/data/culture/filmId.

import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useCultureFilms } from "@/data/culture/useCulture";
import type { FilmAward } from "@/data/culture/types";
import { filmId, indexFilms } from "@/data/culture/filmId";
import { DISCIPLINE_COLOR, disciplineLabel } from "./cultureLabels";

const Row: FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex justify-between gap-4 border-t border-border/60 py-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{children}</span>
  </div>
);

export const CultureFilmRecordScreen: FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading } = useCultureFilms();
  const films = useMemo(() => data?.films ?? [], [data]);
  const index = useMemo(() => indexFilms(films), [films]);
  const film: FilmAward | undefined = index.get(id);

  const siblings = useMemo(
    () =>
      film
        ? films
            .filter(
              (f) => f.producerFold === film.producerFold && filmId(f) !== id,
            )
            .sort((a, b) => b.subsidyEur - a.subsidyEur)
        : [],
    [films, film, id],
  );

  if (!film) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        {isLoading
          ? bg
            ? "Зареждане…"
            : "Loading…"
          : bg
            ? "Филмът не е намерен."
            : "Film not found."}
        <div className="mt-4">
          <Link
            to="/culture/films"
            className="text-sm text-primary hover:underline"
          >
            {bg ? "Към всички субсидии" : "Back to all subsidies"}
          </Link>
        </div>
      </div>
    );
  }

  const description = bg
    ? `${film.title} — държавна субсидия ${formatEur(film.subsidyEur, lang)} от Националния филмов център (${film.year}), продуцент ${film.producer}.`
    : `${film.title} — ${formatEur(film.subsidyEur, lang)} state subsidy from the National Film Center (${film.year}), producer ${film.producer}.`;

  return (
    <>
      <Title description={description}>{film.title}</Title>

      <div className="mt-2">
        <Link
          to="/culture/films"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {bg ? "Всички филмови субсидии" : "All film subsidies"}
        </Link>
      </div>

      <div className="mt-3 flex items-start gap-2">
        <Clapperboard className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
        <h1 className="text-2xl font-bold">{film.title}</h1>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-sm ${DISCIPLINE_COLOR[film.discipline]}`}
        />
        <span className="text-sm text-muted-foreground">
          {disciplineLabel(film.discipline, lang)} · {film.year}
        </span>
      </div>

      <Card className="mt-4 max-w-xl">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">
              {bg ? "Държавна субсидия" : "State subsidy"}
            </span>
            <span className="text-2xl font-bold tabular-nums">
              {formatEur(film.subsidyEur, lang)}
            </span>
          </div>
          <p className="mt-0.5 text-right text-xs text-muted-foreground tabular-nums">
            {film.subsidyBgn.toLocaleString("bg-BG")} {bg ? "лв." : "BGN"}
          </p>

          <div className="mt-3">
            <Row label={bg ? "Продуцент" : "Producer"}>{film.producer}</Row>
            <Row label={bg ? "Вид" : "Discipline"}>
              {disciplineLabel(film.discipline, lang)}
            </Row>
            <Row label={bg ? "Година" : "Year"}>{film.year}</Row>
            {film.stage && (
              <Row label={bg ? "Етап" : "Stage"}>{film.stage}</Row>
            )}
            <Row label={bg ? "Рег. №" : "Reg. no."}>{film.regNo}</Row>
            {film.protocol && (
              <Row label={bg ? "Протокол на ФК" : "Commission protocol"}>
                {film.protocol}
              </Row>
            )}
          </div>
        </CardContent>
      </Card>

      {siblings.length > 0 && (
        <div className="mt-6 max-w-xl">
          <h2 className="mb-2 text-sm font-semibold">
            {bg
              ? `Други филми на ${film.producer} (${siblings.length})`
              : `Other films by ${film.producer} (${siblings.length})`}
          </h2>
          <ul className="divide-y divide-border/60">
            {siblings.map((f) => (
              <li key={filmId(f)}>
                <Link
                  to={`/culture/film/${filmId(f)}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm hover:text-primary hover:underline">
                    {f.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {f.year}
                  </span>
                  <span className="shrink-0 tabular-nums text-sm font-medium">
                    {formatEur(f.subsidyEur, lang)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 max-w-xl text-[11px] text-muted-foreground/80">
        {bg
          ? "Данните са от Единния публичен регистър на финансираните филми и сериали на Националния филмов център. Сумата е държавна субсидия в лева, конвертирана в евро по фиксирания курс 1 EUR = 1,95583 лв."
          : "Data from the National Film Center's public register of financed films and series. The amount is state subsidy in leva, converted to euro at the fixed rate 1 EUR = 1.95583 BGN."}
      </p>
    </>
  );
};
