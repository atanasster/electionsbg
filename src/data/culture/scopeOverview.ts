// Year-scoping for the /culture film-subsidy tiles. The dashboard defaults to the
// whole 2014–2025 corpus, but the scope control lets the reader pin one year; the
// KPIs, discipline split and producer concentration then re-aggregate to that year
// from the full film corpus (films.json) — client-side, so no per-year precomputed
// blob is needed for a 944-row set. The time-spine (a historical trend) is left on
// the full-history byYear and never scoped.
//
// Producer→EIK links can't be recomputed (films.json has no EIK), so they are
// carried over from the all-years overview by producer fold.

import type {
  CultureOverviewFile,
  DisciplineBucket,
  FilmAward,
  FilmDiscipline,
  ProducerBucket,
} from "./types";

export const CULTURE_FIRST_YEAR = 2014;

/** Re-aggregate the overview for a single calendar year from the film corpus.
 *  Returns the original all-years overview when `year` is null or falls outside
 *  the register's span (so a stray cross-section `?pscope` can't blank the page).
 *  `byYear` is intentionally left untouched — the time-spine stays full-history. */
export const scopeCultureOverview = (
  overview: CultureOverviewFile,
  films: FilmAward[] | undefined,
  year: number | null,
): CultureOverviewFile => {
  if (
    year == null ||
    !films ||
    year < overview.firstYear ||
    year > overview.lastYear
  )
    return overview;

  const rows = films.filter((f) => f.year === year);
  const totalEur = rows.reduce((s, f) => s + f.subsidyEur, 0);

  const dMap = new Map<FilmDiscipline, { eur: number; count: number }>();
  for (const f of rows) {
    const d = dMap.get(f.discipline) ?? { eur: 0, count: 0 };
    d.eur += f.subsidyEur;
    d.count += 1;
    dMap.set(f.discipline, d);
  }
  const byDiscipline: DisciplineBucket[] = [...dMap.entries()]
    .map(([discipline, v]) => ({ discipline, eur: v.eur, count: v.count }))
    .sort((a, b) => b.eur - a.eur);

  const eikByFold = new Map(
    overview.topProducers
      .filter((p) => p.eik)
      .map((p) => [p.producerFold, p.eik]),
  );
  const pMap = new Map<
    string,
    { producer: string; eur: number; count: number }
  >();
  for (const f of rows) {
    const p = pMap.get(f.producerFold) ?? {
      producer: f.producer,
      eur: 0,
      count: 0,
    };
    p.eur += f.subsidyEur;
    p.count += 1;
    pMap.set(f.producerFold, p);
  }
  const topProducers: ProducerBucket[] = [...pMap.entries()]
    .map(([producerFold, v]) => ({
      producer: v.producer,
      producerFold,
      eur: v.eur,
      count: v.count,
      share: totalEur ? v.eur / totalEur : 0,
      eik: eikByFold.get(producerFold),
    }))
    .sort(
      (a, b) => b.eur - a.eur || a.producerFold.localeCompare(b.producerFold),
    );
  const top10Share = totalEur
    ? topProducers.slice(0, 10).reduce((s, p) => s + p.eur, 0) / totalEur
    : 0;

  return {
    ...overview,
    totalEur,
    filmCount: rows.length,
    producerCount: pMap.size,
    firstYear: year,
    lastYear: year,
    byDiscipline,
    topProducers,
    top10Share,
  };
};
