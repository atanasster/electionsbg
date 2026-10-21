// ИВСС declaration money tables — № 10 налични парични средства, № 11 банкови сметки,
// № 13 задължения и кредити над 10 000 лева. All three are point-in-time STOCKS (balance at
// 31.12 of the declared year; verified 2026-10-21 against a 2026 filing and Phase 6's notes).
//
// ⚠️ STORAGE AND VALIDATION ONLY. Nothing here may reach `person_wealth_year` or a page until
// (a) the validation in validate_money_tables.ts has been reviewed and (b) a rule exists for
// which register wins when one person has both an ИВСС filing and a КПКОНПИ/Сметна палата one
// for the same year — 090 keeps ONE declaration per (person, year), so loading these would
// arbitrate silently. Owner decision 2026-10-21: precondition only.
//
// WHY ROWS ARE READ BY THE CURRENCY ANCHOR, NOT BY COLUMN POSITION. The form's equivalence
// cell („Равностойност в лв.") is often left blank on a лев row — the amount already IS the
// лев value — so such a row has one run fewer than the header has columns, and the generic
// reader (`tableRows`) falls back to the NEAREST header digit. Those digits are centred while
// amounts are right-aligned, so measured on Kovachev's 2025 filing „60000@187" lands nearer
// column 3's digit (226) than column 2's (142): the amount would be read as the currency.
// That is the 24% undercount Phase 6 recorded, in a new form. Every money row has exactly one
// currency token, and the columns run AMOUNT | CURRENCY | EQUIVALENCE, so the anchor is exact:
// the amount is the number immediately before it, the equivalence the number immediately
// after it, or absent.

import {
  columnMapFor,
  columnOfLabel,
  formVersion,
  isHeaderRow,
  isRefusal,
  type ColumnMap,
  type Row,
  type TableRefusal,
} from "./declarationTables";

export type MoneyTable = "10" | "11" | "13";

interface MoneyLayout {
  columns: number;
  currencyCol: number;
  /** Null where the form has no equivalence column. */
  equivCol: number | null;
}

/** Each table's layout PER FORM, as its numbered header declares it.
 *
 *  ⚠️ v4.0 IS NOT v3.0 WITH A NEW UNIT. The euro reissue (2026) DROPPED the „Равностойност"
 *  column from all three tables — 6 → 5, 8 → 7, 9 → 8 columns, measured on Петрова's 2026
 *  filing — because with the лев gone there is nothing to state an equivalence in. The
 *  currency column did not move. A v4.0 row therefore has no equivalence, and a v4.0 row in
 *  a third currency has NO euro value this form can give: it is stored with valueEur NULL
 *  rather than converted at a rate the document does not state. */
export const MONEY_TABLES: Record<
  MoneyTable,
  { label: string; forms: Record<"3.0" | "4.0", MoneyLayout> }
> = {
  "10": {
    label: "налични парични средства",
    forms: {
      "3.0": { columns: 6, currencyCol: 3, equivCol: 4 },
      "4.0": { columns: 5, currencyCol: 3, equivCol: null },
    },
  },
  "11": {
    label: "банкови сметки",
    forms: {
      "3.0": { columns: 8, currencyCol: 3, equivCol: 4 },
      "4.0": { columns: 7, currencyCol: 3, equivCol: null },
    },
  },
  "13": {
    label: "задължения и кредити",
    forms: {
      "3.0": { columns: 9, currencyCol: 4, equivCol: 5 },
      "4.0": { columns: 8, currencyCol: 4, equivCol: null },
    },
  },
};

/** Only the current form and its euro reissue are mapped for these tables. */
const isMoneyForm = (v: string | null): v is "3.0" | "4.0" =>
  v === "3.0" || v === "4.0";

export const PEG = 1.95583;

/** Third currencies a declaration may name by code. An allowlist, not „any three Latin
 *  letters": a bank abbreviation in a cell (UBB, ING, DSK) is not a currency, and taking it
 *  for one would refuse the whole table over a holder's bank name. */
const ISO_CURRENCIES = new Set(
  "USD GBP CHF JPY CAD AUD NOK SEK DKK PLN CZK HUF RON TRY RUB CNY HKD SGD NZD ILS AED ZAR MKD RSD UAH".split(
    " ",
  ),
);

const text = (r: Row): string => r.map((i) => i.s).join(" ");

/** „BGN", „лв", „лв.", „лева" → BGN; „EUR", „евро" → EUR; „ЩД" / „долара" → USD; another
 *  ISO code as written. */
export const normCurrency = (s: string): string | null => {
  const t = s.trim().replace(/\.$/, "").toLowerCase();
  if (/^(bgn|лв|лева|лев)$/.test(t)) return "BGN";
  if (/^(eur|евро)$/.test(t)) return "EUR";
  // „ЩД" = щатски долари — measured on Янева's 2026 filing, whose row states its own лев
  // equivalence (9724 → 16202, i.e. ~1.67 лв/$) so the reading is confirmed by the document.
  // Only spellings that can mean nothing else; an unknown word still refuses the table.
  if (/^(щд|щ\.\s*д|щатски долари|долара?|долари)$/.test(t)) return "USD";
  if (ISO_CURRENCIES.has(t.toUpperCase())) return t.toUpperCase();
  return null;
};

/** „11 000", „11000,50", „18000,0000" → number; anything else → null. Up to four decimals,
 *  because the fillable form prints amounts as „18000,0000" on some 2023 filings. */
export const parseMoney = (s: string): number | null => {
  const t = s.replace(/[\s\u00a0]/g, "");
  if (!/^\d+([.,]\d{1,4})?$/.test(t)) return null;
  return Number(t.replace(",", "."));
};

export interface MoneyRow {
  table: MoneyTable;
  ord: number;
  /** As declared, in `currency`. */
  amount: number;
  currency: string;
  /** The declarant's own equivalence cell, in `equivUnit`, or null when left blank — and
   *  always null on v4.0, which has no such column. */
  equiv: number | null;
  /** How the euro value below was obtained — never silently. */
  valueBasis: "equiv" | "amount-bgn" | "amount-eur" | null;
  /** In euro at the peg. NULL when the row is in a third currency with no equivalence. */
  valueEur: number | null;
  /** The text BEFORE the amount — on № 13 the kind of debt („кредитна карта", „финансов
   *  лизинг"); empty on № 10/11, whose amount is the first cell. */
  lead: string;
  /** The text after the equivalence cell: holder, then origin / flags, as one string. */
  rest: string;
}

export interface MoneyTableResult {
  rows: MoneyRow[];
  /** The equivalence column's printed unit, read from its label; null on v4.0, which has no
   *  equivalence column at all. */
  equivUnit: "BGN" | "EUR" | null;
}

/** The equivalence column's unit, read from its own header label — never from the year. */
const equivUnitOf = (
  rows: Row[],
  capIdx: number,
  hdrIdx: number,
  edges: number[],
  equivCol: number,
): "BGN" | "EUR" | null => {
  const lv = columnOfLabel(rows, capIdx, hdrIdx, /^в\s*лв/iu, edges);
  const eur = columnOfLabel(rows, capIdx, hdrIdx, /^в\s*евро/iu, edges);
  if (lv === equivCol && eur !== equivCol) return "BGN";
  if (eur === equivCol && lv !== equivCol) return "EUR";
  return null;
};

/** The „Нямам нищо за деклариране" tick-box label wraps, and a fragment of it can land INSIDE
 *  the numbered header row — measured on Ангелова's 2024 Таблица № 11, whose header reads
 *  „1 2 3 4 5 деклариране 6 7 8", so no header was found and the table was refused. A bare
 *  fragment is never a money cell, and the reader's stop sentinel is the WHOLE phrase, which
 *  this leaves alone. */
const LABEL_FRAGMENT = /^(Нямам нищо за|деклариране)$/u;
const withoutLabelFragments = (pages: Row[][]): Row[][] =>
  pages.map((rows) =>
    rows
      .map((r) => r.filter((it) => !LABEL_FRAGMENT.test(it.s)))
      .filter((r) => r.length > 0),
  );

/** Where a table's caption and numbered header sit. Usually on one page; when the caption is
 *  the last thing printed on a page (measured: Бозуков's 2025 Таблица № 13 caption at the foot
 *  of page 6, its header at the top of page 7) the header is looked for at the top of the NEXT
 *  page — the same expected column count, so another table's header cannot be adopted. The
 *  label proofs then read both segments (under the caption, above the header). Null = no
 *  caption on this page. */
const locate = (
  pages: Row[][],
  p: number,
  caption: RegExp,
  columns: number,
):
  | { rows: Row[]; map: ColumnMap; labelRows: Row[]; pageIdx: number }
  | TableRefusal
  | null => {
  const rows = pages[p];
  const capIdx = rows.findIndex((r) => caption.test(text(r)));
  if (capIdx < 0) return null;
  const map = columnMapFor(rows, caption, columns);
  if (!isRefusal(map)) {
    const hdrIdx = rows.findIndex(
      (r, i) => i > capIdx && i <= capIdx + 12 && isHeaderRow(r),
    );
    return { rows, map, labelRows: rows.slice(capIdx, hdrIdx), pageIdx: p };
  }
  if (map.kind === "column-count") return map;
  const next = pages[p + 1];
  // Only a caption near the page END can continue overleaf; within 12 rows covers the wrapped
  // header labels and the page footer printed after it.
  if (!next || capIdx < rows.length - 12) return map;
  const hdrIdx = next.findIndex((r, i) => i <= 12 && isHeaderRow(r));
  if (hdrIdx < 0) return map;
  const hdr = next[hdrIdx];
  if (hdr.length !== columns)
    return {
      kind: "column-count",
      expected: columns,
      got: hdr.length,
      detail: `continued header on the next page declares ${hdr.length} columns, expected ${columns}`,
    };
  // The column labels straddle the break: printed under the caption on this page and/or above
  // the header overleaf, so the label proofs read both segments.
  return {
    rows: next,
    map: { count: hdr.length, edges: hdr.map((i) => i.x), y: hdr[0].y },
    labelRows: [...rows.slice(capIdx), ...next.slice(0, hdrIdx)],
    pageIdx: p + 1,
  };
};

/** The first ordinal printed on a page before any caption or empty-table label — the only
 *  thing a headerless continuation page has to say which table it continues. */
const firstOrdinal = (rows: Row[]): number | null => {
  for (const r of rows) {
    if (/Нямам нищо за деклариране|Таблица № /.test(text(r))) return null;
    const m = r[0] ? /^(\d+)\.$/.exec(r[0].s) : null;
    if (m) return Number(m[1]);
  }
  return null;
};

/** One money table of one filing, or a refusal naming why it could not be read. */
export const readMoneyTable = (
  pages: Row[][],
  table: MoneyTable,
): MoneyTableResult | TableRefusal => {
  const version = formVersion(pages);
  if (!isMoneyForm(version))
    return {
      kind: "form-version",
      got: version,
      detail: `money tables are verified on v3.0/v4.0 only; this filing is ${version ?? "unversioned"}`,
    };
  const spec = MONEY_TABLES[table].forms[version];
  const caption = new RegExp(`Таблица\\s*№\\s*${table}(?![\\d])`, "u");
  const clean = withoutLabelFragments(pages);
  for (let p = 0; p < clean.length; p++) {
    const located = locate(clean, p, caption, spec.columns);
    if (located === null) continue;
    if (isRefusal(located)) return located;
    const { rows, map, labelRows, pageIdx } = located;
    const lastLabel = labelRows.length;
    // PROVE the two columns that decide the money before reading any: the currency label and
    // the equivalence label must each sit in their own column. Absent is a refusal here — the
    // document itself has to confirm the layout.
    const curCol = columnOfLabel(
      labelRows,
      0,
      lastLabel,
      /^валутата/iu,
      map.edges,
    );
    if (curCol !== spec.currencyCol)
      return {
        kind: "column-role",
        detail: `Таблица № ${table}: „валутата" label in column ${curCol ?? "(absent)"}, expected ${spec.currencyCol}`,
      };
    // v4.0: no equivalence column, so nothing to prove — but the v3.0 label must then be
    // ABSENT, or this is not the layout the version says it is.
    const equivUnit =
      spec.equivCol === null
        ? null
        : equivUnitOf(labelRows, 0, lastLabel, map.edges, spec.equivCol);
    if (
      spec.equivCol === null &&
      columnOfLabel(labelRows, 0, lastLabel, /^в\s*(лв|евро)/iu, map.edges) !==
        null
    )
      return {
        kind: "column-role",
        detail: `Таблица № ${table}: an equivalence label on a v4.0 form, which has none`,
      };
    if (spec.equivCol !== null && !equivUnit)
      return {
        kind: "currency",
        detail: `Таблица № ${table}: no „в лв." / „в евро" label on the equivalence column`,
      };
    const out: MoneyRow[] = [];
    // One page's worth of rows, read off the PDF RUNS directly (a printed cell is one run, so
    // an amount like „11 000" stays whole). Below `yTop`, ordinal-prefixed, until the next
    // caption / the empty-table label (the table has ENDED) or the page footer (it may go on).
    const readSegment = (
      segRows: Row[],
      yTop: number,
    ): { lastOrd: number; ended: boolean } | TableRefusal => {
      let lastOrd = 0;
      for (const r of segRows) {
        if (r[0] == null || r[0].y >= yTop) continue;
        const line = text(r);
        if (/Нямам нищо за деклариране|Таблица № /.test(line))
          return { lastOrd, ended: true };
        if (/Декларатор:|^Стр\./.test(line)) return { lastOrd, ended: false };
        const m = /^(\d+)\.$/.exec(r[0].s);
        if (!m) continue;
        // Empty form slots count toward the sequence: a continuation must pick up after
        // the last PRINTED ordinal, filled or not.
        lastOrd = Number(m[1]);
        if (r.length < 2) continue; // an empty form slot
        const dr = { ord: Number(m[1]) };
        const runs = r.slice(1).map((it) => it.s);
        const curIdx = runs.findIndex((x) => normCurrency(x) !== null);
        const curCount = runs.filter((x) => normCurrency(x) !== null).length;
        if (curIdx < 1 || curCount !== 1)
          return {
            kind: "column-role",
            detail: `Таблица № ${table} row ${dr.ord}: ${curCount} currency tokens — cannot anchor the amount`,
          };
        const amount = parseMoney(runs[curIdx - 1]);
        if (amount === null)
          return {
            kind: "column-role",
            detail: `Таблица № ${table} row ${dr.ord}: „${runs[curIdx - 1]}" before the currency is not an amount`,
          };
        const currency = normCurrency(runs[curIdx])!;
        const after = runs[curIdx + 1];
        const equiv =
          spec.equivCol !== null && after !== undefined
            ? parseMoney(after)
            : null;
        const rest = runs.slice(curIdx + (equiv === null ? 1 : 2)).join(" ");
        // The AMOUNT is authoritative for euro and лев rows; the equivalence is the declarant's
        // own arithmetic and the validation measured it wrong in practice — a rate of 2.0
        // („3400 EUR → 6800"), an inconsistent one („2716 EUR → 5078"), a typo („80610 BGN →
        // 80601"). It is used only for a third currency, where it is the one figure in лева/евро.
        let valueEur: number | null = null;
        let valueBasis: MoneyRow["valueBasis"] = null;
        if (currency === "EUR") {
          valueEur = amount;
          valueBasis = "amount-eur";
        } else if (currency === "BGN") {
          valueEur = amount / PEG;
          valueBasis = "amount-bgn";
        } else if (equiv !== null && equivUnit !== null) {
          valueEur = equivUnit === "EUR" ? equiv : equiv / PEG;
          valueBasis = "equiv";
        }
        out.push({
          table,
          ord: dr.ord,
          amount,
          currency,
          equiv,
          valueBasis,
          valueEur: valueEur === null ? null : Math.round(valueEur * 100) / 100,
          lead: runs.slice(0, curIdx - 1).join(" "),
          rest,
        });
      }
      return { lastOrd, ended: false };
    };

    let seg = readSegment(rows, map.y);
    if (isRefusal(seg)) return seg;
    // ⚠️ THE TABLE DOES NOT END WITH THE PAGE — the readTable rule (Цацаров's 6-of-11), here
    // for money: a long bank-account list runs onto the next page, which carries NO caption
    // and NO header, only the ordinals. Read on while the page ended at its footer and the
    // next page's first ordinal continues the sequence; anything else is not this table.
    for (let q = pageIdx + 1; q < clean.length && !seg.ended; q++) {
      // Decide it is OURS before reading a cell: a refusal from somebody else's numbered
      // block must not refuse this table.
      if (firstOrdinal(clean[q]) !== seg.lastOrd + 1) break;
      const next = readSegment(clean[q], Infinity);
      if (isRefusal(next)) return next;
      seg = next;
    }
    return { rows: out, equivUnit };
  }
  return {
    kind: "no-header",
    detail: `Таблица № ${table} not found in this document`,
  };
};

/** The three tables of one filing. */
export const readMoneyTables = (
  pages: Row[][],
): Record<MoneyTable, MoneyTableResult | TableRefusal> => ({
  "10": readMoneyTable(pages, "10"),
  "11": readMoneyTable(pages, "11"),
  "13": readMoneyTable(pages, "13"),
});
