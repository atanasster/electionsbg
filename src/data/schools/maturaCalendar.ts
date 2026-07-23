// The ДЗИ (matura) exam calendar — the piece МОН's open-data register drops.
//
// The register keys results by year only, but a trend chart carrying a
// governments strip has to place each point on the day the cohort actually sat
// the exam: the ДЗИ по БЕЛ is the first exam of the май-юни session, held in
// the third week of May, and a whole cabinet can turn over inside one school
// year (2024 alone ran Денков → Главчев). Placing 2024 at "the middle of 2024"
// would attribute the exam to the wrong government.
//
// Dates below are МОН's own, per the annual заповед / изпитен график, each
// checked against the ministry or РУО publication for that year — the 2024 one
// against МОН's answer-key filename itself (dzi-bel_17052024-otgovori.pdf). A
// year that arrives without a curated date falls back to 20 May, the modal date
// of the session: off by at most a few days, which never moves a point across a
// cabinet boundary.

/** ISO date of the ДЗИ по БЕЛ (first mandatory matura), by result year. */
export const DZI_BEL_EXAM_DATES: Record<number, string> = {
  2022: "2022-05-18",
  2023: "2023-05-19",
  2024: "2024-05-17",
  2025: "2025-05-21",
  2026: "2026-05-20",
};

/** Exam date for a result year; falls back to the session's modal date. */
export const dziBelExamDate = (year: number): string =>
  DZI_BEL_EXAM_DATES[year] ?? `${year}-05-20`;

// МОН's officially announced national average for the ДЗИ по БЕЛ. We do NOT
// plot it, and we could not reproduce it if we wanted to: the ministry converts
// the mean POINTS to a grade (58.48 pts → 4.32 in 2024), while the register
// publishes per-school grades only. The two are different statistics, and the
// gap is systematic — every failing student enters our average as a flat 2.00
// whatever their points, so the gap grows with the failure rate (−0.09 in 2023
// when 16.8% of examinees sat in sub-3.0 schools, −0.02 in 2024 when 5.7% did).
// Quoted in the page footnote so the tile doesn't silently contradict the
// figure every newspaper printed.
export const DZI_BEL_OFFICIAL_AVG: Record<number, number> = {
  2023: 3.93,
  2024: 4.32,
  2025: 4.27,
  2026: 4.39,
};
