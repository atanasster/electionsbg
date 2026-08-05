// Per-place education blobs — the slice of the schools corpus a Governance
// place node renders ("Матура в областта" + "Над очакваното").
//
// Pure over the already-computed directory schools, for two reasons. It is
// unit-testable without a database (the regressions and verdicts are the
// loader's job and arrive baked in — this file never re-fits anything), and it
// keeps the size discipline honest: a place blob is a few KB, against the 647 KB
// directory blob that a place dashboard must never fetch just to show two tiles.
// Same reasoning as the 'risk' blob, one grain down.
//
// The residuals here are measured against the NATIONAL SES regression computed
// once in the loader. Re-fitting within an oblast — 20-142 schools — would be
// noise dressed as a finding.

import { isRankable, r1, r2, type Verdict } from "./school_stats";

/** One school as a place blob renders it: score, cohort, and both verdicts. */
export type PlaceSchoolRow = {
  id: string;
  name: string;
  obshtina: string;
  obshtinaName: string;
  score: number;
  n: number;
  predicted: number | null;
  residual: number | null;
  verdict: Verdict | null;
  vaResidual: number | null;
  vaVerdict: Verdict | null;
};

/** One município row of a region blob's "по общини" table. */
export type PlaceMuniRow = {
  obshtina: string;
  name: string;
  avg: number;
  examinees: number;
  schools: number;
  /** Change against this município's own first year, or null with one year. */
  delta: number | null;
};

export type PlaceBlob = {
  grain: "region" | "muni";
  code: string;
  latestYear: number | null;
  /** Count-weighted latest-year ДЗИ БЕЛ average for the place. */
  avg: number;
  examinees: number;
  schools: number;
  /** 1 = highest average. Regions only — a município rank across 265 unequal
   *  places would rank a 12-graduate village against Пловдив. */
  rank: number | null;
  rankOf: number | null;
  nationalAvg: number | null;
  /** Ascending per-year rollup for this place. */
  series: { year: number; avg: number; examinees: number; schools: number }[];
  /** Share (%) of the place's graduates ATTENDING a school whose average is
   *  below the passing mark — not the share of graduates who failed. */
  shareInFailingSchools: number | null;
  /** Schools eligible for every ranked list below: ≥10 graduates in the
   *  headline year. The denominator of the value-added coverage label. */
  rankable: number;
  /** Region blobs only; [] for a município. */
  byObshtina: PlaceMuniRow[];
  top: PlaceSchoolRow[];
  /** Empty when the place has too few rankable schools for a head and a tail
   *  that don't overlap — see the cap check in `blobFor`. */
  bottom: PlaceSchoolRow[];
  /** Best by SES residual — the "над очакваното" list. */
  above: PlaceSchoolRow[];
  /** Mean SES residual over the place's rankable schools. */
  meanResidual: number | null;
  /** The value-added (7→12 НВО) arm. `covered` of the blob's `rankable` is
   *  published alongside every figure: nationally only ~50-66% of schools carry
   *  an НВО prior, so an unlabelled mean would imply a completeness we don't
   *  have. */
  va: {
    covered: number;
    meanResidual: number | null;
    rows: PlaceSchoolRow[];
  };
};

/** What this builder needs off a directory school — a structural subset, so the
 *  loader's DirSchool satisfies it without a cast. */
export type PlaceInputSchool = {
  id: string;
  name: string;
  obshtina: string;
  obshtinaName: string;
  oblast: string;
  latestYear: number | null;
  latestScore: number | null;
  latestN: number | null;
  series: { year: number; score: number; n?: number }[];
  /** The regression outputs, all optional: only the loader fits them. The
   *  build-time reader supplies none, and the blobs it produces carry no
   *  residual — a static body states the level and the spread, never a
   *  context-adjusted reading nobody computed. */
  predicted?: number | null;
  residual?: number | null;
  verdict?: Verdict | null;
  vaResidual?: number | null;
  vaVerdict?: Verdict | null;
};

/** The oblast a município belongs to, as the education corpus keys it.
 *
 *  Two consumers now depend on this being ONE rule: the Postgres loader that
 *  builds the served blobs, and the prerender that writes the crawler-facing
 *  region bodies at build time. The Sofia case is the whole reason it is worth
 *  extracting — МОН publishes Столична община as one aggregate, so the city's
 *  schools are keyed to the `S23` МИР rather than to a `SOF` oblast that does
 *  not exist in this corpus. */
export const oblastOfObshtina = (obshtina: string): string =>
  obshtina === "SOF00" ? "S23" : obshtina.slice(0, 3);

/** A school's ascending ДЗИ БЕЛ series from the raw index, carrying each
 *  year's cohort where the index has one. Shared for the same reason as
 *  `oblastOfObshtina`: the rollups on both sides must agree year for year. */
export const dziSeriesOf = (
  scoresByYear: Record<string, Record<string, number>>,
  countsByYear?: Record<string, Record<string, number>>,
): { year: number; score: number; n?: number }[] =>
  Object.keys(scoresByYear)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((y) => {
      const s = scoresByYear[String(y)]?.dzi_bel;
      if (typeof s !== "number") return [];
      const n = countsByYear?.[String(y)]?.dzi_bel;
      return [
        typeof n === "number"
          ? { year: y, score: s, n }
          : { year: y, score: s },
      ];
    });

/** The headline year — the membership rule every place figure is computed on,
 *  so the loader and the prerender must derive it identically. A one-year
 *  disagreement would change the average, both counts, the top five and the
 *  rank on every region page, silently. The index's own `latestYear` wins; the
 *  fallback is the latest year any school reports a scored, counted cohort. */
export const latestYearOf = (
  declared: number | null | undefined,
  schools: { series: { year: number; n?: number }[] }[],
): number | null => {
  if (typeof declared === "number") return declared;
  let latest: number | null = null;
  for (const s of schools)
    for (const p of s.series)
      if (typeof p.n === "number" && (latest == null || p.year > latest))
        latest = p.year;
  return latest;
};

const TOP_N = 5;
const BOTTOM_N = 5;
const ABOVE_N = 8;
const VA_N = 5;
/** A school whose cohort AVERAGE falls below this sits under the lowest passing
 *  mark. It is a property of the school's mean, not a per-pupil failure rate —
 *  which is why the field it feeds is named for the graduates who ATTEND such a
 *  school, not for graduates who failed. */
const FAILING_BELOW = 3;

/** A school ranked inside a place's card: rankable AND reporting the headline
 *  year. The year half is what keeps every list on the same membership rule as
 *  the headline above it — without it a school that stopped reporting keeps its
 *  old `latestScore` and gets ranked, undated, inside a card headlined with a
 *  later year (10 such rows across 7 blobs when this was first written). */
type RankableSchool = PlaceInputSchool & {
  latestScore: number;
  latestN: number;
};

const isCurrentRankable = (
  s: PlaceInputSchool,
  latestYear: number | null,
): s is RankableSchool => s.latestYear === latestYear && isRankable(s);

const rowOf = (s: RankableSchool): PlaceSchoolRow => ({
  id: s.id,
  name: s.name,
  obshtina: s.obshtina,
  obshtinaName: s.obshtinaName,
  score: s.latestScore,
  n: s.latestN,
  predicted: s.predicted ?? null,
  residual: s.residual ?? null,
  verdict: s.verdict ?? null,
  vaResidual: s.vaResidual ?? null,
  vaVerdict: s.vaVerdict ?? null,
});

/** Descending by `value`, ties broken on id — the blob is stored verbatim, so
 *  an unstable order would make local and cloud payloads differ byte for byte. */
const topBy = (
  rows: PlaceSchoolRow[],
  value: (r: PlaceSchoolRow) => number | null,
  n: number,
  dir: 1 | -1 = 1,
): PlaceSchoolRow[] =>
  rows
    .filter((r) => value(r) != null)
    .sort(
      (a, b) =>
        dir * ((value(b) as number) - (value(a) as number)) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, n);

const mean = (vals: number[]): number | null =>
  vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;

/** Per-year rollup over a set of schools, count-weighted, ascending.
 *  Mirrors the directory's byOblastYear rule: a year counts a school only when
 *  BOTH its score and its cohort are known, and each year aggregates whoever
 *  reported it (not a fixed school set) — the honest rule for a trend once a
 *  school stops reporting. */
const seriesOf = (
  group: PlaceInputSchool[],
): { year: number; avg: number; examinees: number; schools: number }[] => {
  const acc = new Map<number, { sum: number; n: number; schools: number }>();
  for (const s of group) {
    for (const p of s.series) {
      if (typeof p.n !== "number") continue;
      const a = acc.get(p.year) ?? { sum: 0, n: 0, schools: 0 };
      a.sum += p.score * p.n;
      a.n += p.n;
      a.schools += 1;
      acc.set(p.year, a);
    }
  }
  return [...acc.entries()]
    .map(([year, a]) => ({
      year,
      avg: r2(a.sum / a.n),
      examinees: a.n,
      schools: a.schools,
    }))
    .sort((a, b) => a.year - b.year);
};

/** The schools a place's headline is computed over: those whose OWN latest year
 *  IS the national latest year. The directory's byOblast rule, applied in ONE
 *  place so the headline, the failing share and every ranked list cannot drift
 *  onto different school sets — which is exactly how they drifted before. */
const currentOf = (
  group: PlaceInputSchool[],
  latestYear: number | null,
): (PlaceInputSchool & { latestScore: number; latestN: number })[] =>
  group.filter(
    (s): s is PlaceInputSchool & { latestScore: number; latestN: number } =>
      s.latestYear === latestYear && s.latestN != null && s.latestScore != null,
  );

/** Count-weighted headline plus the share (%) of that cohort sitting in schools
 *  averaging below the passing mark — one pass over the current set. */
const headlineOf = (
  current: { latestScore: number; latestN: number }[],
): {
  avg: number;
  examinees: number;
  schools: number;
  shareInFailingSchools: number | null;
} => {
  let sum = 0;
  let n = 0;
  let failing = 0;
  for (const s of current) {
    sum += s.latestScore * s.latestN;
    n += s.latestN;
    if (s.latestScore < FAILING_BELOW) failing += s.latestN;
  }
  return {
    avg: n ? r2(sum / n) : 0,
    examinees: n,
    schools: current.length,
    shareInFailingSchools: n ? r1((100 * failing) / n) : null,
  };
};

/** Groups by `key`, counting rather than swallowing the rows whose key is
 *  blank — a schools-index regression that blanked an oblast code would
 *  otherwise shrink every place blob while the directory kept the school. */
const groupBy = <T>(
  items: T[],
  key: (t: T) => string,
): { groups: Map<string, T[]>; dropped: number } => {
  const groups = new Map<string, T[]>();
  let dropped = 0;
  for (const it of items) {
    const k = key(it);
    if (!k) {
      dropped += 1;
      continue;
    }
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }
  return { groups, dropped };
};

const blobFor = (
  grain: "region" | "muni",
  code: string,
  group: PlaceInputSchool[],
  latestYear: number | null,
  nationalAvg: number | null,
): PlaceBlob => {
  const head = headlineOf(currentOf(group, latestYear));
  const rows = group
    .filter((s): s is RankableSchool => isCurrentRankable(s, latestYear))
    .map(rowOf);
  const va = rows.filter((r) => r.vaResidual != null && r.vaVerdict != null);
  return {
    grain,
    code,
    latestYear,
    ...head,
    rank: null,
    rankOf: null,
    nationalAvg,
    series: seriesOf(group),
    rankable: rows.length,
    byObshtina: [],
    top: topBy(rows, (r) => r.score, TOP_N),
    // A place needs a distinct head AND tail to have a "worst" list at all:
    // with 3 rankable schools, top and bottom would name the same schools in
    // opposite orders and the tile would read "best: A, B, C · worst: C, B, A".
    bottom:
      rows.length >= TOP_N + BOTTOM_N
        ? topBy(rows, (r) => r.score, BOTTOM_N, -1)
        : [],
    above: topBy(
      rows.filter((r) => r.verdict === "above"),
      (r) => r.residual,
      ABOVE_N,
    ),
    meanResidual: mean(
      rows.flatMap((r) => (r.residual != null ? [r.residual] : [])),
    ),
    va: {
      covered: va.length,
      meanResidual: mean(va.map((r) => r.vaResidual as number)),
      rows: topBy(
        va.filter((r) => r.vaVerdict === "above"),
        (r) => r.vaResidual,
        VA_N,
      ),
    },
  };
};

/** One "по общини" row. `delta` follows the /education convention
 *  (`oblastRows.ts`): the headline average minus the FIRST year of the series,
 *  so the change a reader sees is measured against the average printed beside
 *  it. Taking both ends off the series instead would be internally tidier and
 *  would disagree with the number in the same row the moment a school stops
 *  reporting — which is the case this whole module is careful about. */
const muniRowsOf = (
  group: PlaceInputSchool[],
  latestYear: number | null,
): PlaceMuniRow[] =>
  [...groupBy(group, (s) => s.obshtina).groups]
    .flatMap(([obshtina, muniGroup]) => {
      const h = headlineOf(currentOf(muniGroup, latestYear));
      if (!h.schools) return [];
      const ser = seriesOf(muniGroup);
      const first = ser.length >= 2 ? ser[0] : null;
      return [
        {
          obshtina,
          name: muniGroup[0].obshtinaName,
          avg: h.avg,
          examinees: h.examinees,
          schools: h.schools,
          delta: first ? r2(h.avg - first.avg) : null,
        },
      ];
    })
    .sort((a, b) => b.avg - a.avg || a.obshtina.localeCompare(b.obshtina));

/**
 * One blob per place with a current cohort — regions keyed by oblast code
 * (`SML`, `S23`), municípios by obshtina code (`SML10`, `SOF00`). The two code
 * spaces are 3 and 5 characters today, so a single (kind, key) namespace does
 * not collide; the guard below makes that an assertion rather than a hope,
 * because `data/municipalities.json` also carries six 2-character diaspora
 * codes for which the loader's `code.slice(0, 3)` returns the code itself.
 *
 * A place whose schools all stopped reporting gets NO blob rather than one
 * reading `avg: 0` — the tiles' contract is "no blob ⇒ self-hide", and an
 * existing blob with an empty headline would render 0,00 as a matura average.
 *
 * Município blobs are emitted even though only the region UI reads them today:
 * the rows are free (the loader already holds every school in memory) while the
 * expensive, forgettable half is the cloud reload that publishes them.
 */
export const buildPlacePayloads = (
  schools: PlaceInputSchool[],
  latestYear: number | null,
  nationalByYear: { year: number; avg: number | null }[],
): Map<string, PlaceBlob> => {
  const nationalAvg =
    nationalByYear.find((p) => p.year === latestYear)?.avg ?? null;
  const scored = schools.filter((s) => s.latestScore != null);
  const out = new Map<string, PlaceBlob>();

  const byMuni = groupBy(scored, (s) => s.obshtina);
  const byOblast = groupBy(scored, (s) => s.oblast);
  const dropped = byMuni.dropped + byOblast.dropped;
  if (dropped)
    console.warn(
      `school_places: ${dropped} school(s) skipped for a blank oblast/obshtina code`,
    );

  for (const [obshtina, group] of byMuni.groups) {
    const blob = blobFor("muni", obshtina, group, latestYear, nationalAvg);
    if (blob.schools) out.set(obshtina, blob);
  }

  const regions: PlaceBlob[] = [];
  for (const [oblast, group] of byOblast.groups) {
    // Fail loudly rather than let a region blob overwrite a município one in
    // this map — the DB never sees the collision, so the loader's row count
    // would still look plausible. Same convention as the duplicate-school-id
    // throw in load_schools_pg.ts.
    if (out.has(oblast) && out.get(oblast)?.grain === "muni")
      throw new Error(
        `place key collision: '${oblast}' is both an oblast and an obshtina code`,
      );
    const blob = blobFor("region", oblast, group, latestYear, nationalAvg);
    if (!blob.schools) continue;
    // The по-общини table is the region node's whole reason to exist as a
    // crawl path (country → region → município), so it is complete rather than
    // top-N: at most 19 municípios have matura schools in any oblast.
    blob.byObshtina = muniRowsOf(group, latestYear);
    regions.push(blob);
    out.set(oblast, blob);
  }

  // Rank regions by the same headline the /education table sorts on.
  const ranked = [...regions].sort(
    (a, b) => b.avg - a.avg || a.code.localeCompare(b.code),
  );
  ranked.forEach((blob, i) => {
    blob.rank = i + 1;
    blob.rankOf = ranked.length;
  });

  return out;
};
