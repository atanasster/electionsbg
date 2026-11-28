// Named appropriations in the State Budget Law: „Приложение № 2 към чл. 110, ал. 1 —
// Програма за приоритетни стратегически инвестиционни проекти с национално
// финансиране". Each row is one coded project
// (NP-25.001-0048) with the capital spending the law sets for it — for the law's own
// year and, from 2026, a forecast for the two years after.
//
// Parsed from the cached Държавен вестник HTML (raw_data/budget/law-<idMat>.html.gz,
// written by the budget ingest). The table carries its own header, so the year
// columns and the unit are READ from it rather than assumed: the 2025 law prints
// „(в хил. лв.)" and one year, the 2026 law „(хил. евро)" and three.
//
// The annex has up to two sections, and only the first appropriates anything:
//   раздел I  — „Програма за приоритетни …" (чл. 110, ал. 1): the capital spending set
//               for the year, plus forecasts for later years;
//   раздел II — „Списък с резервни …" (чл. 110, ал. 2): RESERVE projects with an
//               indicative amount, funded only if money frees up.
// Every amount carries its kind so no consumer can sum a reserve or a forecast into
// what the law appropriated.
//
// ⚠️ APPROPRIATED ≠ TRANSFERRED ≠ SPENT. A row is what the law allows; nothing here
// says the money moved.

import { decodeEntities, stripTags } from "../lib/html";

export const BGN_PER_EUR = 1.95583;

export type AmountKind = "appropriation" | "forecast" | "indicative";
export type AnnexSection = "priority" | "reserve";

export type NamedAppropriation = {
  fiscalYear: number; // the law's year
  section: AnnexSection;
  seq: number; // the row's № within its section
  projectCode: string; // NP-25.001-0048
  title: string;
  indicator: string | null;
  institution: string;
  amounts: {
    year: number;
    kind: AmountKind;
    native: number; // in thousands of `currency`
    eur: number;
  }[];
  currency: "BGN" | "EUR";
};

export type ParseResult = {
  rows: NamedAppropriation[];
  /** Rows with a project code that could not be read — the caller refuses on any. */
  rejected: { code: string; reason: string }[];
};

// `decodeEntities` leaves dashes alone; the annex uses „–" both inside titles and as
// the whole cell for a year with nothing set.
const cellText = (html: string): string =>
  decodeEntities(stripTags(html).replace(/&[nm]dash;/gi, "–"))
    .replace(/\s+/g, " ")
    .trim();

const rowsOf = (tableHtml: string): string[][] =>
  [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      cellText(m[1]),
    ),
  );

/** „3 500,0" → 3500; „–" / empty → null. */
export const bgNumber = (s: string): number | null => {
  const t = s.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

type Header = {
  seq: number;
  code: number;
  title: number;
  indicator: number;
  institution: number;
  years: { col: number; year: number; kind: AmountKind }[];
  width: number;
};

const readHeader = (cells: string[]): Header | null => {
  const at = (re: RegExp) => cells.findIndex((c) => re.test(c));
  const code = at(/^Номер на проект$/);
  const title = at(/^Проект$/);
  const institution = at(/Отговорна институция/);
  const indicator = at(/Индикатор/);
  if (code < 0 || title < 0 || institution < 0) return null;
  const years = cells.flatMap((c, col) => {
    const m = /капиталов(?:и|ите) разходи по проекта през (\d{4}) г/.exec(c);
    if (!m) return [];
    const kind: AmountKind = /Прогнозен/.test(c)
      ? "forecast"
      : /Индикативен/.test(c)
        ? "indicative"
        : "appropriation";
    return [{ col, year: Number(m[1]), kind }];
  });
  if (!years.length) return null;
  return {
    seq: at(/^№$/),
    code,
    title,
    indicator,
    institution,
    years,
    width: cells.length,
  };
};

const ANNEX_TITLE =
  /Програма за приоритетни стратегически инвестиционни проекти с национално финансиране/;
const RESERVE_TITLE =
  /Списък с резервни стратегически инвестиционни проекти с национално финансиране/;
const NEXT_ANNEX = /Приложение №\s*(\d+)/g;
const CODE = /^NP-\d{2}\.\d{3}-\d{4}$/;

/** Every project row of the annex in one law's HTML. */
export const parseNamedAppropriations = (
  html: string,
  fiscalYear: number,
): ParseResult => {
  // The title is also cited in the law's articles; the annex itself is the
  // occurrence followed directly by a table whose header names project codes.
  const start =
    [...html.matchAll(new RegExp(ANNEX_TITLE, "g"))]
      .map((m) => m.index)
      .find((i) => {
        const t = html.indexOf("<table", i);
        const end = html.indexOf("</table>", t);
        return (
          t >= 0 &&
          end >= 0 &&
          !ANNEX_TITLE.test(cellText(html.slice(i + 1, t))) &&
          cellText(html.slice(t, end)).includes("Номер на проект")
        );
      }) ?? -1;
  if (start < 0) return { rows: [], rejected: [] };
  // The unit is printed once, between the annex title and its first table.
  const head = cellText(html.slice(start, html.indexOf("<table", start)));
  const currency: "BGN" | "EUR" | null = /хил\.\s*лв/.test(head)
    ? "BGN"
    : /хил\.\s*евро/.test(head)
      ? "EUR"
      : null;
  if (!currency)
    throw new Error(
      `${fiscalYear}: cannot read the annex's unit from „${head.slice(-200)}"`,
    );

  const rows: NamedAppropriation[] = [];
  const rejected: ParseResult["rejected"] = [];
  let header: Header | null = null;
  let section: AnnexSection = "priority";
  let prevEnd = start;
  // The annex spans several <table> elements (page breaks); a header row is
  // repeated on some and not others, so the last one seen applies. The text
  // BETWEEN tables carries the section titles and, eventually, the next annex.
  for (const t of html.slice(start).matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const at = start + (t.index ?? 0);
    const gap = cellText(html.slice(prevEnd, at));
    prevEnd = at + t[0].length;
    if (
      [...gap.matchAll(NEXT_ANNEX)].some((m) => m[1] !== "2") &&
      !RESERVE_TITLE.test(gap)
    )
      break;
    if (RESERVE_TITLE.test(gap)) {
      section = "reserve";
      header = null;
    }
    for (const cells of rowsOf(t[0])) {
      const h = readHeader(cells);
      if (h) {
        header = h;
        continue;
      }
      const code = cells.find((c) => CODE.test(c));
      if (!code) continue;
      if (!header) {
        rejected.push({ code, reason: "project row before any header" });
        continue;
      }
      if (cells.length !== header.width) {
        rejected.push({
          code,
          reason: `${cells.length} cells, header has ${header.width}`,
        });
        continue;
      }
      const amounts: NamedAppropriation["amounts"] = [];
      let bad = false;
      for (const y of header.years) {
        const raw = cells[y.col];
        if (/^[–—-]?$/.test(raw)) continue; // nothing set for that year
        // „3 151,5**" — a footnote marker; the note is in the law, the figure stands.
        const n = bgNumber(raw.replace(/\*+$/, ""));
        if (n == null) {
          bad = true;
          break;
        }
        amounts.push({
          year: y.year,
          // A reserve project's amount is indicative whatever its column says.
          kind: section === "reserve" ? "indicative" : y.kind,
          native: n,
          eur:
            Math.round(
              ((n * 1000) / (currency === "EUR" ? 1 : BGN_PER_EUR)) * 100,
            ) / 100,
        });
      }
      const seq = header.seq >= 0 ? Number(cells[header.seq]) : NaN;
      if (bad || !Number.isInteger(seq)) {
        rejected.push({ code, reason: "unreadable № or amount" });
        continue;
      }
      rows.push({
        fiscalYear,
        section,
        seq,
        projectCode: cells[header.code],
        title: cells[header.title],
        indicator:
          header.indicator >= 0 ? cells[header.indicator] || null : null,
        institution: cells[header.institution],
        amounts,
        currency,
      });
    }
  }
  return { rows, rejected };
};
