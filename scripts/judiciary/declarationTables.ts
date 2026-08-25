// Structured reading of the ИВСС declaration form (чл. 175б ЗСВ, v3.0 since 22.11.2022).
//
// WHY THIS EXISTS, AND WHY IT IS NOT THE OLD HARVESTER. `__write_magistrate_holdings.ts`
// reads the same PDFs by HEURISTIC: find a currency token, take the number before or after
// it; find a cell that looks like a company name. That was a deliberate choice — the plan
// (docs/plans/judiciary-vss-v1.md §6) records a 2026-07-15 prototype that tried per-table
// column reconstruction, hit a fillable form whose text layer interleaves labels with
// values, and backed out after a hand-checked sample showed a 24% cash undercount on one
// magistrate and a false-positive figure on another.
//
// What changed is not the ambition but the ANCHOR. Every table in this form prints a
// NUMBERED COLUMN-HEADER ROW immediately above its data — `1 | 2 | 3 | … | 12` — and every
// data row is ordinal-prefixed (`1.`, `2.`, …). That gives a per-declaration column map
// derived from the document itself rather than from an assumption about layout, which is
// precisely the "per-declaration structure detection" the plan said a revival would need.
//
// ⚠️ THE POINT IS THE REFUSAL, NOT THE PARSE. Phase 6's real complaint was not that parsing
// was hard, it was that "good and bad extractions can't be told apart". So every function
// here REFUSES rather than guesses: a table whose header row is missing, whose column count
// is not the one expected, or whose data row does not fit the map comes back as a typed
// failure naming the reason. A declaration we cannot read must be reported, never
// approximated — the subject is a named judge.
//
// NOT a claim that the money tables are now safe. This module gives the mechanism; whether
// any particular table's VALUES may be published is a separate, evidence-led decision
// recorded in docs/plans/magistrate-declaration-detail-v1.md.

/** One positioned text run from the PDF text layer. */
export interface Item {
  s: string;
  x: number;
  y: number;
}

/** A visual row: runs sharing a baseline, left to right. */
export type Row = Item[];

/** Why a table could not be read. Always specific enough to act on. */
export type TableRefusal =
  | { kind: "no-header"; detail: string }
  | { kind: "column-count"; expected: number; got: number; detail: string }
  | { kind: "form-version"; got: string | null; detail: string }
  | { kind: "currency"; detail: string }
  | { kind: "no-rows"; detail: string };

export interface ColumnMap {
  /** Column count declared by the header row itself. */
  count: number;
  /** Left edge of each column, in PDF user space, ascending. */
  edges: number[];
  /** The header row's baseline — data rows sit BELOW it (smaller y). */
  y: number;
}

/** Bucket positioned runs into visual rows. Shared with the legacy harvester's `pageRows`
 *  so both read the same geometry; 3pt is the tolerance that survives this form's mixed
 *  font sizes. */
export const toRows = (items: Item[]): Row[] => {
  const rows = new Map<number, Item[]>();
  for (const it of items) {
    const k = [...rows.keys()].find((kk) => Math.abs(kk - it.y) < 3);
    if (k === undefined) rows.set(it.y, [it]);
    else rows.get(k)!.push(it);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, its]) => its.sort((a, b) => a.x - b.x));
};

const text = (r: Row): string => r.map((i) => i.s).join(" ");

/** Is this row the form's numbered column header — `1 | 2 | 3 | …`?
 *
 *  Requires at least three columns and STRICT 1..n sequence. A looser test (e.g. "most
 *  cells are digits") matches money rows, which are also mostly digits, and would hand
 *  back a column map derived from somebody's bank balances. */
export const isHeaderRow = (r: Row): boolean => {
  if (r.length < 3) return false;
  return r.every((it, i) => it.s === String(i + 1));
};

/** The column map for the table whose caption matches `caption`.
 *
 *  Searches DOWNWARD from the caption for the numbered header, so a page carrying several
 *  tables maps each to its own — the form puts up to four on one page. */
export const columnMapFor = (
  rows: Row[],
  caption: RegExp,
  expectedColumns?: number,
): ColumnMap | TableRefusal => {
  const capIdx = rows.findIndex((r) => caption.test(text(r)));
  if (capIdx < 0)
    return { kind: "no-header", detail: `caption ${caption} not on this page` };
  // The header sits within a few rows of the caption; the gap is the wrapped column
  // labels. Bounded so a later table's header cannot be adopted by an earlier caption.
  const hdrIdx = rows.findIndex(
    (r, i) => i > capIdx && i <= capIdx + 12 && isHeaderRow(r),
  );
  if (hdrIdx < 0)
    return {
      kind: "no-header",
      detail: `no numbered header row within 12 rows of ${caption}`,
    };
  const hdr = rows[hdrIdx];
  if (expectedColumns != null && hdr.length !== expectedColumns)
    return {
      kind: "column-count",
      expected: expectedColumns,
      got: hdr.length,
      detail: `${caption} header declares ${hdr.length} columns, expected ${expectedColumns}`,
    };
  return {
    count: hdr.length,
    edges: hdr.map((i) => i.x),
    y: hdr[0].y,
  };
};

/** Generic so it narrows `readTable`'s result too, not only `columnMapFor`'s. Typed to
 *  `ColumnMap | TableRefusal` it made every `readTable` call site a TS2345 — and because
 *  Vitest never typechecks, 17 green tests and a clean lint sat on top of a `tsc -b` that
 *  fails, i.e. a broken `npm run build`. */
export const isRefusal = <T>(v: T | TableRefusal): v is TableRefusal =>
  typeof v === "object" && v !== null && "kind" in v;

/** A data row of a table: cells assigned to columns by x-position.
 *
 *  Cells are indexed by COLUMN NUMBER (1-based, as the form prints them), so a caller reads
 *  `cells[6]` for „Цена на сделката" and the code matches the document. Absent columns are
 *  undefined rather than shifted, which is the difference between reading a price and
 *  reading whatever happened to be one cell to its left. */
export interface DataRow {
  ord: number;
  cells: Record<number, string>;
  /** TRUE when the row carried exactly one run per column, so each value's column is known
   *  positionally and cannot be wrong whatever the header alignment.
   *
   *  FALSE when the row was sparse and cells had to be assigned by nearest header digit.
   *  That path is a best effort: measured, it can merge two adjacent runs into one cell —
   *  „2023 Теодора Асио Доненчева" arrived in „година на придобиване", the year and the
   *  owner together. A consumer that PUBLISHES cell values should require `exact`; one that
   *  only counts rows need not. */
  exact: boolean;
}

/** Rows of the mapped table, ordinal-prefixed, until the table ends.
 *
 *  Ends at the first row that is neither ordinal-prefixed nor a continuation — the next
 *  caption, „Нямам нищо за деклариране", or the page footer. A row whose leading cell is a
 *  bare ordinal with nothing after it is an EMPTY form slot and is skipped, not returned as
 *  a row of blanks. */
export const tableRows = (
  rows: Row[],
  map: ColumnMap,
  stopAt: RegExp = /Нямам нищо за деклариране|Таблица № |Декларатор:|^Стр\./,
): DataRow[] => {
  const out: DataRow[] = [];
  for (const r of rows) {
    if (r[0] == null || r[0].y >= map.y) continue; // above the header
    const flat = text(r);
    // ⚠️ NO ESCAPE HATCH FOR A ROW THAT MERELY STARTS WITH AN ORDINAL. An earlier version
    // read `stopAt.test(flat) && !/^\d+\.\s/.test(flat)`, meaning a row beginning „3. " was
    // never a stop even when it also contained „Таблица № 3" — so the form's own furniture
    // („Нямам нищо за деклариране", the next table's caption, a bare „:") was admitted as
    // data. Measured: 36 such rows across 2,457, carrying no property type and no price.
    //
    // The hatch was meant to protect the table's OWN caption row („1. Право на собственост…"),
    // which does begin with an ordinal — but that row sits ABOVE the header and is already
    // excluded by the `r[0].y >= map.y` test above. It protected nothing and admitted junk.
    if (stopAt.test(flat)) break;
    const m = /^(\d+)\.$/.exec(r[0].s);
    if (!m) continue;
    if (r.length < 2) continue; // empty form slot
    const cells: Record<number, string> = {};
    const exact = r.length === map.count;
    if (exact) {
      // ⚠️ POSITIONAL WHEN THE COUNTS MATCH, AND THIS IS THE PRIMARY PATH.
      //
      // The header digits are not reliably aligned with the cell text beneath them: printed
      // CENTRED in their columns — the ordinary way to typeset `1 | 2 | … | 12` — every
      // digit sits well to the right of where its column's text begins, and an
      // edge-with-tolerance assignment then shifts every value one column LEFT. Measured on
      // a centred header: „Цена на сделката" came back holding the acquisition year and the
      // вид column held the location. A row count cannot see that, which is why the
      // harness's 100% agreement is not evidence about it.
      //
      // When a row has exactly as many runs as the header has columns, the k-th run IS
      // column k whatever the alignment. That is the common case (a fully-filled row) and
      // it is exact.
      r.forEach((it, i) => {
        cells[i + 1] = it.s;
      });
    } else {
      // Otherwise some cells are empty and position alone cannot say which. Fall back to
      // NEAREST header digit — symmetric, so it degrades the same way for left-, centre-
      // and right-aligned headers instead of being correct for exactly one of them.
      for (const it of r) {
        let col = 1;
        let best = Infinity;
        for (let c = 0; c < map.edges.length; c++) {
          const d = Math.abs(it.x - map.edges[c]);
          if (d < best) {
            best = d;
            col = c + 1;
          }
        }
        cells[col] = cells[col] ? `${cells[col]} ${it.s}` : it.s;
      }
    }
    out.push({ ord: Number(m[1]), cells, exact });
  }
  return out;
};

// ------------------------------------------------------- the declaration's own identity --

/** Which of the five column-1..5 boxes the declarant filled — i.e. what KIND of declaration
 *  this is. The form prints the chosen one in spaced capitals near the top of page 2. */
export type DeclarationKind =
  | "annual" // Е Ж Е Г О Д Н А — the yearly filing, due 15 May
  | "entry" // при встъпване в длъжност — a STOCK snapshot of the whole estate
  | "exit" // при освобождаване от длъжност
  | "post-exit" // one year after leaving
  | "interests" // промяна на декларирани обстоятелства (чл. 175б, ал. 1, т. 11-13)
  | "unknown";

export interface DeclarationMeta {
  kind: DeclarationKind;
  /** The calendar year the filing COVERS, from „01.01 – 31.12 <year>". Null on kinds that
   *  are anchored to a date rather than a period (entry/exit), and on any filing that does
   *  not print one.
   *
   *  ⚠️ This is NOT the year the declaration was filed, and the two differ by one for every
   *  annual: a 2026 filing covers 2025. Every „данни за <year>" label wants THIS. */
  periodYear: number | null;
}

/** Letters only, upper-cased — collapses the form's spaced capitals („Е Ж Е Г О Д Н А")
 *  onto a comparable token without also collapsing ordinary prose into one. */
const letters = (s: string): string => s.toUpperCase().replace(/[^А-ЯЁ]/g, "");

/** ⚠️ MATCHED PER ROW, NEVER OVER THE FLATTENED PAGE.
 *
 *  The form's own footnote reads „Колона 2 се попълва, когато лицето подава ежегодна
 *  декларация до 15 май" — so a search of the whole page finds that word on EVERY
 *  declaration, including entry ones, and reports the entire corpus as annual. Measured:
 *  that is exactly what it did to Цацаров's July 2022 entry filing.
 *
 *  The defence is that the row must BE the marker — `startsWith` plus the length bound
 *  below — not that the comparison is case-sensitive. `letters()` upper-cases, so a
 *  lowercase row would match; what a footnote can never do is be a row containing nothing
 *  but the phrase. (An earlier version of this comment claimed case-sensitivity was the
 *  mechanism. It was not, and a test named for it passed for an unrelated reason.) */
const KIND_MARKERS: ReadonlyArray<{ kind: DeclarationKind; token: string }> = [
  { kind: "annual", token: "ЕЖЕГОДНА" },
  // „ПРИ ВЪЗНИКВАНЕ НА КАЧЕСТВОТО, КОЕТО Е ОСНОВАНИЕ / ЗА ДЕКЛАРИРАНЕ" — wraps onto two
  // rows, so the first is what is matched.
  { kind: "entry", token: "ПРИВЪЗНИКВАНЕНАКАЧЕСТВОТО" },
  { kind: "exit", token: "ПРИПРЕКРАТЯВАНЕНАКАЧЕСТВОТО" },
  { kind: "post-exit", token: "ЕДНАГОДИНАСЛЕДОСВОБОЖДАВАНЕ" },
  { kind: "interests", token: "ПРОМЯНАНАДЕКЛАРИРАНИОБСТОЯТЕЛСТВА" },
];

/** Read the declaration's kind and covered period off page 2.
 *
 *  Cheap by design — one page, ~0.7 s including the PDF open — so a corpus-wide survey of
 *  "which magistrates have a stock snapshot" does not need the full parse. */
export const declarationMeta = (rows: Row[]): DeclarationMeta => {
  let kind: DeclarationKind = "unknown";
  for (const r of rows) {
    const l = letters(text(r));
    const hit = KIND_MARKERS.find(
      (m) => l === m.token || l.startsWith(m.token),
    );
    // …and the row must be the marker alone: `startsWith` allows the wrapped second line
    // of the long entry/exit captions but not a sentence that merely contains the word.
    if (hit && l.length <= hit.token.length + 24) {
      kind = hit.kind;
      break;
    }
  }

  // The period line is „като: | 01.01. | – | 31.12 | 2025 | год.".
  //
  // ⚠️ A NULL YEAR IS THE DOCUMENT'S ANSWER, NOT A PARSE FAILURE. An entry or exit filing
  // is anchored to a DATE and leaves the period blank by design — and plenty of annuals
  // leave it blank too (measured: 21 of 60), so nothing may infer the period from the
  // filing year instead.
  //
  // ⚠️ READ PER ROW, AND THE ROW MUST CARRY THE WHOLE PERIOD PHRASE. Anchoring on „31.12"
  // over the FLATTENED page pulls a year across a row boundary: a money table's „към 31.12."
  // column header followed by an unrelated row beginning with a year returned 2019 for a
  // filing whose period line was blank — inventing a covered period for exactly the
  // entry/exit filings that leave it empty by design.
  const m = rows
    .map(text)
    .map((line) => /01\.01\.\D{0,12}31\.12\.?\s*(20\d\d)\b/.exec(line))
    .find(Boolean);
  return { kind, periodYear: m ? Number(m[1]) : null };
};

/** Read one table across however many pages it runs onto.
 *
 *  ⚠️ THE TABLE DOES NOT END WITH THE PAGE. Цацаров's entry declaration lists 11 properties,
 *  rows 1-6 on page 2 and 7-11 on page 3 — and the continuation page carries NO caption and
 *  NO header row, just the ordinals. Reading page by page silently returns 6 of 11, which is
 *  a wrong answer about a named judge's estate rather than a missing one.
 *
 *  The continuation is accepted only while the ordinals keep counting up, so an unrelated
 *  numbered table further on cannot be absorbed. */
/** The form revision the document was printed from — „v.3.0 / 22.11.2022 г." on page 1.
 *  Null on every pre-v3.0 filing, which simply does not print one. */
export const formVersion = (pages: Row[][]): string | null => {
  for (const rows of pages.slice(0, 2))
    for (const r of rows) {
      const m = /v\.?\s*(\d+\.\d+)/i.exec(text(r));
      if (m) return m[1];
    }
  return null;
};

/** ⚠️ THE COLUMN COUNT IS NOT THE FORM VERSION, AND ASSUMING IT IS PUBLISHES SHIFTED VALUES.
 *
 *  The pre-v3.0 Таблица 1 has the SAME twelve columns in a DIFFERENT ORDER:
 *
 *    old (≤2022):  … 7 година | 8 собственик | 9 идеална част | 10 цена …
 *    v3.0:         … 7 цена   | 8 година     | 9 собственик   | 10 идеална част …
 *
 *  So `expectedColumns: 12` passes on both and every value lands under the wrong heading —
 *  measured, „година на придобиване" came back holding the declarant's name on 5 of 60
 *  sampled filings, and „цена на сделката" holding „1997 Радослав Петров Маринов". The row
 *  count is identical either way, which is why the count-based half of the validation
 *  harness reported 100% agreement on exactly these documents.
 *
 *  Only the v3.0 map has been verified (against the PDFs and, for Цацаров's 2026 filing,
 *  against BIRD's independent reporting of the same four properties), so anything else is
 *  REFUSED. Adding the older map is a deliberate piece of work with its own evidence, not a
 *  loosened guard. */
/** The money unit Таблица 1 and 2 are denominated in, read from the price column's own
 *  header — „Цена на сделката /лева/" on v3.0, „…/евро/" on v4.0.
 *
 *  ⚠️ READ, NEVER INFERRED — not from the form version and above all not from the YEAR.
 *  Bulgaria adopted the euro on 2026-01-01 and the ИВСС reissued the form for it, so 2026
 *  carries BOTH: measured on the full corpus, 3,483 of that year's filings are v3.0 in лева
 *  beside 201 v4.0 in евро. Keying the unit on the year would restate 3,483 filings' prices
 *  at 1.95583× against named judges. Keying it on the version would be right today and is
 *  one reissue away from being wrong; the label is the document's own answer. */
export const priceCurrency = (pages: Row[][]): "BGN" | "EUR" | null => {
  // ⚠️ SCOPED TO THE PRICE COLUMN'S OWN HEADER, not to the page. The unit is a slash-delimited
  // token — „/лева/", „/евро/" — and the form is full of others („/правото/", „/кв.м./",
  // „/декара/", „/подпис/"), while the declarant's own free text is right there too. A
  // page-wide search lets anything that happens to say „евро" anywhere in the first pages
  // decide what a judge's declared prices are denominated in.
  //
  // The label wraps across rows exactly as the header does — „Цена на" / „сделката" /
  // „/лева/" are three separate visual rows in the PDF — so the anchor is the caption and the
  // window is the few rows under it.
  const UNIT = /\/\s*(лева|лв\.?|евро|eur)\s*\//i;
  for (const rows of pages.slice(0, 4))
    for (let i = 0; i < rows.length; i++) {
      if (!/Цена\s+на/i.test(text(rows[i]))) continue;
      for (let j = i; j < Math.min(i + 5, rows.length); j++) {
        const m = UNIT.exec(text(rows[j]));
        if (m) return /евро|eur/i.test(m[1]) ? "EUR" : "BGN";
      }
    }
  return null;
};

/** ⚠️ v4.0 IS v3.0 RE-DENOMINATED, NOT A NEW LAYOUT — verified before it was admitted here.
 *  Across 6 v4.0 and 2 v3.0 filings the header declares the same 12 columns at the same
 *  x-positions (39, 88, 163, 231, 282, 327, 374, 421, 519, 618, 686, 767) in the same order;
 *  the sole difference in the whole table is the price column's unit label. Both tables 1 and
 *  2 move together. So they share ONE map, and what varies is `priceCurrency`.
 *
 *  That is the opposite of the pre-v3.0 case below, where the count is also 12 and the ORDER
 *  differs — which is why version alone can never stand in for either check. */
const SUPPORTED_FORMS = new Set(["3.0", "4.0"]);

export const readTable = (
  pages: Row[][],
  caption: RegExp,
  expectedColumns: number,
): { rows: DataRow[]; map: ColumnMap } | TableRefusal => {
  const version = formVersion(pages);
  if (version === null || !SUPPORTED_FORMS.has(version))
    return {
      kind: "form-version",
      got: version,
      detail:
        `form version ${version ?? "(unstated — pre-v3.0)"} has a different column ` +
        `ORDER for the same column COUNT; mapped: ${[...SUPPORTED_FORMS]
          .map((v) => `v${v}`)
          .join(", ")}`,
    };
  // ⚠️ A PRICE WITH NO UNIT IS THE ONE THING WORSE THAN NO PRICE. The two mapped versions
  // are denominated differently, so a document whose label we cannot read would have its
  // prices stored under whichever unit the consumer happens to assume — off by 1.95583
  // against a named judge, in a figure that looks entirely ordinary. Refuse instead.
  if (priceCurrency(pages) === null)
    return {
      kind: "currency",
      detail:
        `v${version} states no /лева/ or /евро/ unit on the price column; refusing rather ` +
        `than storing an amount whose unit is a guess`,
    };
  const pageIdx = pages.findIndex(
    (rows) => !isRefusal(columnMapFor(rows, caption, expectedColumns)),
  );
  if (pageIdx < 0) {
    // Report the most specific refusal we saw rather than a generic miss.
    for (const rows of pages) {
      const r = columnMapFor(rows, caption, expectedColumns);
      if (isRefusal(r) && r.kind === "column-count") return r;
    }
    return {
      kind: "no-header",
      detail: `${caption} not found in this document`,
    };
  }
  const map = columnMapFor(
    pages[pageIdx],
    caption,
    expectedColumns,
  ) as ColumnMap;
  const rows = tableRows(pages[pageIdx], map);
  for (let p = pageIdx + 1; p < pages.length; p++) {
    const last = rows[rows.length - 1]?.ord ?? 0;
    // A continuation page has no header, so the map's `y` would exclude everything on it;
    // read it with the same column edges but from the top of the page.
    const cont = tableRows(pages[p], { ...map, y: Infinity });
    if (!cont.length || cont[0].ord !== last + 1) break;
    rows.push(...cont);
  }
  return { rows, map };
};
