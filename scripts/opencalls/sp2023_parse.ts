// PURE parser for the ДФЗ / Стратегически план 2023-2027 indicative intake schedule
// („Индикативен годишен график за планираните приеми"), published as a single XLSX.
//
// WHY THIS SOURCE MATTERS. ИСУН publishes exact deadlines and NO money; this file is the
// mirror image — it carries budget, eligible beneficiaries, aid rate and per-project ceiling
// in real columns, and only a MONTH RANGE for the date. Neither source alone answers a reader's
// question; together they do. See docs/plans/funds-module-v2.md §2.4.
//
// EVERY ROW IS `indicative`. „В периода октомври-декември за срок не по-кратък от 60 дни" is a
// forecast, and the file is already an „Актуализиран" (updated) revision — it moves. The DDL
// refuses a closes_at on these rows precisely so a forecast can never be read as a deadline.
//
// ── CURRENCY: THE PLAN GOT THIS WRONG, AND THE HEADER IS WHY ────────────────────────────
// The budget column is headed „БЮДЖЕТ ЗА ПРИЕМ / До левовата равностойност на:", which reads
// like a lev marker. It is not — it is legal boilerplate ("up to the lev equivalent of"), and
// MEASURED on the 2026 file every populated amount is denominated in евро (24 cells say евро,
// 0 data cells say лв/лева). So the rule here is: require an explicit currency word, convert
// лв at 1.95583 if one ever appears, and DROP the figure when neither marker is present.
// Guessing the unit would overstate by 1.96×, and these columns are sortable — a wrong number
// silently ranks the page.
//
// ── WHY THE EXTRACTORS ARE DELIBERATELY CONSERVATIVE ───────────────────────────────────
// Most cells are prose with numbers embedded in them, and a first-number-wins regex produces
// confident nonsense. The worst real example is the per-project ceiling
// „Помощта се предоставя под формата на опростен разход в размер на 18, 38 или 54 евро" — a
// per-unit simplified cost, which a naive parse stores as a €18 project ceiling. So a figure is
// taken ONLY from a cell that begins with it; otherwise the cell is kept verbatim in a note and
// the numeric column stays NULL. Missing beats wrong: NULL renders as „не е публикувано", a
// wrong ceiling renders as a fact.

import { deriveAudience } from "./audience";
import type { OpenCall } from "./types";

/** Fixed since 1997 and unchanged by euro adoption; see feedback_bg_uses_eur. */
export const BGN_PER_EUR = 1.95583;

const clean = (v: unknown): string =>
  String(v ?? "")
    .replace(/\s+/gu, " ")
    .trim();

/** "235 838 246,40" → 235838246.4. Bulgarian formatting: space thousands, comma decimal. */
const toNumber = (raw: string): number | null => {
  const n = Number(raw.replace(/\s/gu, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export interface MoneyRead {
  eur: number | null;
  /** Why a figure was not taken, for the ingest log. Null when one was. */
  skipped: string | null;
}

/** A currency amount, but ONLY when the cell leads with it.
 *
 *  Accepts an optional „до"/„до " prefix, then digits, then an explicit currency word. Anything
 *  else — prose, a list of unit costs, a conditional — returns null with a reason. */
export const readLeadingAmount = (cellRaw: string): MoneyRead => {
  const cell = clean(cellRaw);
  if (!cell) return { eur: null, skipped: "empty" };
  const m = cell.match(
    /^(?:до\s+)?([\d\s]+(?:,\d+)?)\s*(евро|EUR|€|лв\.?|лева)/iu,
  );
  if (!m)
    return {
      eur: null,
      skipped: `no leading amount: ${cell.slice(0, 60)}`,
    };
  const n = toNumber(m[1]);
  if (n === null || n <= 0)
    return { eur: null, skipped: `unparseable amount: ${m[1]}` };
  const unit = m[2].toLowerCase();
  if (/лв|лева/u.test(unit))
    return { eur: Math.round((n / BGN_PER_EUR) * 100) / 100, skipped: null };
  return { eur: n, skipped: null };
};

/** The aid rate, but only when the cell states ONE.
 *
 *  „50 % от размера на одобрените разходи" → 50. „За дейности по т. 1.1. - до 100%, … по т. 1.2
 *  - до 50%" states two different rates for two different activities; there is no single number
 *  that is true of the row, so it returns null rather than picking the first. */
export const readSingleRate = (cellRaw: string): number | null => {
  const cell = clean(cellRaw);
  // The decimal part is NOT optional decoration. Without it, `(\d{1,3})\s*%` on „37,5 %"
  // backtracks past „37," and matches „5 %" → 5, and the multi-rate guard then INVERTS: one
  // distinct value looks unambiguous, so the wrong number is accepted rather than declined.
  const found = [...cell.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/gu)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  const distinct = [...new Set(found.filter((n) => n > 0 && n <= 100))];
  return distinct.length === 1 ? distinct[0] : null;
};

export interface Sp2023Row {
  call: OpenCall;
  /** Figures the parser declined to take, and why. Printed by the fetcher. */
  skipped: string[];
}

/** Header text → the field it feeds. Matched as a PREFIX of the normalised header, because the
 *  real headers carry trailing qualifiers („БЮДЖЕТ ЗА ПРИЕМ До левовата равностойност на: /където
 *  е приложимо/"). */
const COLUMNS = {
  intervention: "ИНТЕРВЕНЦИЯ",
  support: "ВИД НА ПОДКРЕПАТА",
  budget: "БЮДЖЕТ ЗА ПРИЕМ",
  beneficiaries: "БЕНЕФИЦИЕНТИ",
  territory: "ТЕРИТОРИАЛЕН ОБХВАТ",
  period: "ПЕРИОД НА ПРИЕМ",
  rate: "РАЗМЕР НА ФИНАНСОВАТА ПОМОЩ",
  ceiling: "РАЗМЕР НА РАЗХОДИТЕ ЗА ЕДИН ПРОЕКТ",
} as const;

type ColKey = keyof typeof COLUMNS;

/** Resolve every column by its HEADER, not by a hardcoded index.
 *
 *  The previous version verified only that „ИНТЕРВЕНЦИЯ" sat at index 1 and then trusted
 *  indices 3-9 — so inserting one column upstream shifted every field silently: the row count,
 *  validateCall and the shrink guard all stayed green while `periodLabel` filled with
 *  „Интервенцията се прилага на територията на цялата страна" and the money columns quietly
 *  emptied. A header map fails loudly instead, which is what the throw already claimed to do. */
const resolveColumns = (headerRow: unknown[]): Record<ColKey, number> => {
  const norm = headerRow.map((h) => clean(h).toUpperCase());
  const idx = {} as Record<ColKey, number>;
  const missing: string[] = [];
  for (const [key, label] of Object.entries(COLUMNS) as [ColKey, string][]) {
    const at = norm.findIndex((h) => h.startsWith(label.toUpperCase()));
    if (at < 0) missing.push(label);
    else idx[key] = at;
  }
  if (missing.length)
    throw new Error(
      `sheet layout changed — missing column(s): ${missing.join(" | ")}. ` +
        `Found headers: ${norm.filter(Boolean).join(" | ")}`,
    );
  return idx;
};

const SOURCE_URL =
  "https://www.sp2023.bg/index.php/bg/proceduri/indikativen-grafik";

/** Rows → OpenCall[]. `grid` is the sheet as a value matrix (row 0 title, row 1 headers). */
export const parseSp2023 = (grid: unknown[][], year: number): Sp2023Row[] => {
  const headerIdx = grid.findIndex((r) =>
    (r ?? []).some((c) => clean(c).toUpperCase().startsWith("ИНТЕРВЕНЦИЯ")),
  );
  if (headerIdx < 0)
    throw new Error(
      "ИНТЕРВЕНЦИЯ header not found — the sheet layout changed; refusing to guess column order",
    );
  const H = resolveColumns(grid[headerIdx] ?? []);

  const out: Sp2023Row[] = [];
  let blank = 0;
  for (const r of grid.slice(headerIdx + 1)) {
    const intervention = clean(r?.[H.intervention]);
    // Merged cells and spacer rows arrive as blanks. Counted and reported rather than skipped
    // in silence — a jump here is how a layout change announces itself.
    if (!intervention) {
      blank += 1;
      continue;
    }

    // „II.Д.1. - Стартова помощ …", but ALSO „II. Г.4 - …" and „II. Г.14 - …", which really do
    // carry a space after the numeral in the published file (2 of 11 rows on the 2026 sheet).
    // The first version rejected those, leaving code=null and degrading sourceKey to a 40-char
    // title prefix — which, on a table that never anti-join deletes, forks the row permanently
    // the next time somebody edits the title.
    //
    // `І` (Cyrillic U+0406) is accepted alongside Latin `I`: the source mixes them.
    const m = intervention.match(
      /^([IVXІА-Я][\wIVXІ.\sА-Я]*?)\s*[-–—]\s*(.+)$/u,
    );
    // Internal spaces are noise, not identity: „II. Г.4" and „II.Г.4" are the same intervention.
    const code = m ? m[1].replace(/\s+/gu, "").replace(/\.$/u, "") : null;
    const title = m ? clean(m[2]) : intervention;

    const period = clean(r?.[H.period]);
    // date_precision 'indicative' REQUIRES a period label (DDL CHECK). A row without one
    // cannot be represented, so it is dropped rather than silently given an empty window.
    if (!period) continue;

    const budgetRaw = clean(r?.[H.budget]);
    const ceilingRaw = clean(r?.[H.ceiling]);
    const budget = readLeadingAmount(budgetRaw);
    const ceiling = readLeadingAmount(ceilingRaw);
    const beneficiaries = clean(r?.[H.beneficiaries]);

    const skipped: string[] = [];
    if (budget.skipped) skipped.push(`budget: ${budget.skipped}`);
    if (ceiling.skipped) skipped.push(`ceiling: ${ceiling.skipped}`);

    const hasMoney = budget.eur !== null || ceiling.eur !== null;
    const rate = readSingleRate(clean(r?.[H.rate]));

    out.push({
      skipped,
      call: {
        source: "sp2023",
        // The intervention code is stable across yearly schedules; scoping by year keeps the
        // 2026 and 2027 windows as separate rows rather than one overwriting the other.
        sourceKey: `${year}:${code ?? title.slice(0, 40)}`,
        code,
        kind: "call",
        title,
        programmeCode: "SP2023",
        programmeName:
          "Стратегически план за развитие на земеделието и селските райони 2023-2027",
        objective: clean(r?.[H.support]) || null,
        datePrecision: "indicative",
        opensAt: null,
        closesAt: null,
        periodLabel: period,
        budgetEur: budget.eur,
        // The raw string always survives, including the prose budgets („остатъчният неусвоен
        // бюджет…") that cannot become a number without inventing one.
        budgetNote: budgetRaw || null,
        aidRatePct: rate,
        grantMinEur: null,
        grantMaxEur: ceiling.eur,
        beneficiariesRaw: beneficiaries || null,
        audience: deriveAudience(beneficiaries, title),
        territory: clean(r?.[H.territory]) || null,
        sourceUrl: SOURCE_URL,
        docs: [],
        // 'source' — these came from the publisher's own structured columns, so they need no
        // human pass. Only rows that actually carry a figure claim it (the DDL allows a
        // 'source' row with no money, but the flag should mean what it says).
        enrichment: hasMoney || rate !== null ? "source" : "none",
      },
    });
  }
  if (blank > 0) console.log(`  (skipped ${blank} blank/merged row(s))`);
  return out;
};
