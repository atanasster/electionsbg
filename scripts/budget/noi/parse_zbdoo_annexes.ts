// Parsers for the two ЗБДОО annex families that carry per-industry statutory
// values, both of which split the year the same way the МОД cap does:
//
//   Прил. 1  / 1А — Минимален осигурителен доход по икономически дейности и
//                   квалификационни групи професии (чл. 9, т. 1)
//   Прил. 2  / 2А — Диференцирани осигурителни вноски за фонд ТЗПБ (чл. 14, т. 1)
//
// Measured against ЗБДОО-2026 (idMat 244982): each МОД annex is 86 activity rows
// × 9 qualification groups = 774 grid positions, of which 744 carry a value and
// 30 are legitimately blank (an activity with no workers in that group). "744"
// is therefore the POPULATED-cell count, not rows × groups — a distinction worth
// keeping, because a checker written against 774 fails on correct data.
//
// The structural checks THROW: a wrong column count or a lost row means the
// table shape moved and every downstream figure is suspect. The floor check
// COUNTS instead — a cell below the period's floor would be a real (and
// editorially interesting) fact about the law, not a parse failure, and a hard
// assertion there would reject valid data. Measured today: zero below floor in
// both periods.

export interface ModAnnexRow {
  /** Пореден номер, as printed. */
  ordinal: number;
  /** КИД-2025 section letter (А, B, …). */
  kidSection: string;
  /** КИД-2025 code as printed — may be a range or a list ("01 без 1.48; 03"). */
  kidCode: string;
  activityName: string;
  /** Nine qualification groups in the law's column order; null where blank. */
  byQualificationGroup: (number | null)[];
}

export interface ModAnnex {
  /** "1" | "1А" */
  annex: string;
  periodFrom: string;
  periodTo: string;
  /** The period's statutory floor (min self-insured income). */
  floorEur: number;
  rows: ModAnnexRow[];
  stats: {
    gridCells: number;
    populatedCells: number;
    blankCells: number;
    aboveFloor: number;
    /** Cells strictly BELOW the period's floor. Counted, never fatal. */
    belowFloor: number;
    maxEur: number;
  };
}

export interface TzpbAnnexRow {
  kidCode: string;
  activityName: string;
  /** Contribution rate in percent. */
  ratePct: number;
}

export interface TzpbAnnex {
  /** "2" | "2А" */
  annex: string;
  periodFrom: string;
  periodTo: string;
  rows: TzpbAnnexRow[];
}

/** The nine qualification groups, in the law's column order. */
export const QUALIFICATION_GROUPS = [
  "Ръководители",
  "Специалисти",
  "Техници и приложни специалисти",
  "Помощен административен персонал",
  "Персонал, зает с услуга за населението, търговията и охраната",
  "Квалифицирани работници в селското, горското, ловното и рибното стопанство",
  "Квалифицирани работници и сродни на тях занаятчии",
  "Машинни оператори и монтажници",
  "Професии, неизискващи специална квалификация",
] as const;

/** Columns before the nine value columns: ordinal, section, code, name. */
const LABEL_COLS = 4;
const TOTAL_COLS = LABEL_COLS + QUALIFICATION_GROUPS.length; // 13

const cellText = (td: string): string =>
  td
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&bdquo;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Rows of a segment's FIRST table, as arrays of cell text. */
const tableRows = (segment: string): string[][] => {
  const start = segment.indexOf("<table");
  if (start === -1) return [];
  const end = segment.lastIndexOf("</table>");
  // `lastIndexOf` can land BEFORE `start` when a segment opens mid-table (a
  // stray closing tag from the previous annex). Slicing backwards yields "" and
  // then a zero-row "no table found", which is at least loud — but take the
  // rest of the segment instead, so the row-count assertion reports the real shape.
  const table =
    end === -1 || end < start
      ? segment.slice(start)
      : segment.slice(start, end + 8);
  return table
    .split(/<tr[^>]*>/i)
    .slice(1)
    .map((tr) => (tr.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(cellText));
};

/** ДВ prints decimals with either separator, sometimes both in one table
 *  (Прил. 2 uses "1,1" where Прил. 2А uses "1.1").
 *
 *  Returns `null` ONLY for a genuinely empty cell. A non-empty cell that will
 *  not parse throws: blank is data (that activity has no workers in that
 *  group), garbage is a parse fault, and collapsing the two would let a
 *  mis-sliced column read as 774 tidy blanks. */
const num = (raw: string, where: string): number | null => {
  const t = raw.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v))
    throw new Error(`${where}: cannot parse "${raw}" as a number`);
  return v;
};

/** The slice of `html` between two markers (second exclusive).
 *
 *  BOTH ends are required to exist. A missing `to` used to slice silently to
 *  end-of-document, which for an annex means swallowing every later appendix —
 *  the row-count assertion would then fail with a number that tells you nothing
 *  about the real cause. `to` is searched only AFTER `from`, so a heading that
 *  also appears in the law's own cross-references cannot pull the end backwards.
 *
 *  Note "Приложение № 1" is a PREFIX of "Приложение № 1А": the caller must pass
 *  the longer marker as `to` for the first annex, which it does. Verified
 *  against the live text — the four spans are disjoint and in order. */
const between = (html: string, from: string, to: string): string => {
  const i = html.indexOf(from);
  if (i === -1) throw new Error(`annex marker not found: ${from}`);
  const j = html.indexOf(to, i + from.length);
  if (j === -1)
    throw new Error(
      `annex end marker not found after "${from}": ${to}. Slicing to EOF would ` +
        `swallow every later appendix and fail as a row-count mismatch instead.`,
    );
  return html.slice(i, j);
};

/**
 * Parse one МОД annex (Прил. 1 or 1А).
 *
 * @param expectedRows the activity-row count the caller believes the annex has.
 *   Passed in rather than inferred so a silently truncated table is fatal —
 *   inferring it would make "we parsed 3 rows" look like success.
 */
export const parseModAnnex = (
  html: string,
  opts: {
    annex: string;
    fromMarker: string;
    toMarker: string;
    periodFrom: string;
    periodTo: string;
    floorEur: number;
    expectedRows: number;
  },
): ModAnnex => {
  const rowsRaw = tableRows(between(html, opts.fromMarker, opts.toMarker));
  if (rowsRaw.length === 0)
    throw new Error(`Прил. ${opts.annex}: no table found`);

  const widths = new Set(rowsRaw.map((r) => r.length));
  if (widths.size !== 1 || !widths.has(TOTAL_COLS))
    throw new Error(
      `Прил. ${opts.annex}: expected every row to have ${TOTAL_COLS} cells ` +
        `(${LABEL_COLS} label + ${QUALIFICATION_GROUPS.length} qualification ` +
        `groups); saw widths ${[...widths].join(", ")}. The table shape moved — ` +
        `every value below is suspect.`,
    );

  const data = rowsRaw.filter((r) => /^\d+$/.test(r[0]));
  if (data.length !== opts.expectedRows)
    throw new Error(
      `Прил. ${opts.annex}: expected ${opts.expectedRows} activity rows, got ` +
        `${data.length}. A dropped row is silent in every aggregate downstream.`,
    );

  let populatedCells = 0;
  let aboveFloor = 0;
  let belowFloor = 0;
  let maxEur = 0;

  const rows: ModAnnexRow[] = data.map((r) => {
    const values = r.slice(LABEL_COLS).map((c, gi) => {
      const v = num(
        c,
        `Прил. ${opts.annex} row ${r[0]} / ${QUALIFICATION_GROUPS[gi]}`,
      );
      if (v == null) return null;
      populatedCells++;
      if (v > opts.floorEur + 1e-9) aboveFloor++;
      if (v < opts.floorEur - 1e-9) belowFloor++;
      if (v > maxEur) maxEur = v;
      return v;
    });
    return {
      ordinal: Number(r[0]),
      kidSection: r[1],
      kidCode: r[2],
      activityName: r[3],
      byQualificationGroup: values,
    };
  });

  const gridCells = rows.length * QUALIFICATION_GROUPS.length;
  return {
    annex: opts.annex,
    periodFrom: opts.periodFrom,
    periodTo: opts.periodTo,
    floorEur: opts.floorEur,
    rows,
    stats: {
      gridCells,
      populatedCells,
      blankCells: gridCells - populatedCells,
      aboveFloor,
      belowFloor,
      maxEur,
    },
  };
};

/** код по КИД-2025 | наименование | осигурителна вноска (%). */
const TZPB_COLS = 3;

/** Rates the ТЗПБ annex is allowed to use (чл. 14). */
export const TZPB_RATES = [0.4, 0.5, 0.7, 0.9, 1.1] as const;

/** Parse one ТЗПБ annex (Прил. 2 or 2А). */
export const parseTzpbAnnex = (
  html: string,
  opts: {
    annex: string;
    fromMarker: string;
    toMarker: string;
    periodFrom: string;
    periodTo: string;
    expectedRows: number;
  },
): TzpbAnnex => {
  const rowsRaw = tableRows(between(html, opts.fromMarker, opts.toMarker));
  if (rowsRaw.length === 0)
    throw new Error(`Прил. ${opts.annex}: no table found`);
  // Same structural bar as the МОД annexes: a shifted column count means the
  // table shape moved and every rate below is suspect. Three columns —
  // код по КИД-2025, наименование, осигурителна вноска (%).
  const widths = new Set(rowsRaw.map((r) => r.length));
  if (widths.size !== 1 || !widths.has(TZPB_COLS))
    throw new Error(
      `Прил. ${opts.annex}: expected every row to have ${TZPB_COLS} cells; ` +
        `saw widths ${[...widths].join(", ")}`,
    );
  // The first numbered row is the law's column-number legend ("1","2","3"),
  // not an activity; a real row's second cell is a name, not a bare digit.
  const data = rowsRaw.filter(
    (r) =>
      r.length >= 3 &&
      r[0] &&
      !/^\d+$/.test(r[1]) &&
      /^[\d.,\s]+$/.test(r[2]) &&
      r[2].trim() !== "",
  );
  if (data.length !== opts.expectedRows)
    throw new Error(
      `Прил. ${opts.annex}: expected ${opts.expectedRows} activity rows, got ${data.length}`,
    );

  const rows: TzpbAnnexRow[] = data.map((r) => {
    const ratePct = num(r[2], `Прил. ${opts.annex} row ${r[0]}`);
    if (ratePct == null)
      throw new Error(`Прил. ${opts.annex}: empty rate in row ${r[0]}`);
    return { kidCode: r[0], activityName: r[1], ratePct };
  });

  const allowed: readonly number[] = TZPB_RATES;
  const stray = [...new Set(rows.map((r) => r.ratePct))].filter(
    (v) => !allowed.includes(v),
  );
  if (stray.length)
    throw new Error(
      `Прил. ${opts.annex}: rate(s) outside чл. 14's set ` +
        `{${TZPB_RATES.join(", ")}}: ${stray.join(", ")}`,
    );

  return {
    annex: opts.annex,
    periodFrom: opts.periodFrom,
    periodTo: opts.periodTo,
    rows,
  };
};
