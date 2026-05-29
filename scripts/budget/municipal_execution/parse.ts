// Parser for the MINFIN B3 ЕБК cash-execution template, as published to
// data.egov.bg by общини like Русе and Николаево.
//
// getResourceData returns the workbook as a 2D row array. The file is a
// concatenation of appendices, each preceded by an "ОТЧЕТНИ ДАННИ ПО ЕБК"
// banner:
//   I.  П Р И Х О Д И … …                         — revenue, by ЕБК paragraph
//   II. РАЗХОДИ - РЕКАПИТУЛАЦИЯ ПО ПАРАГРАФИ       — expense, by economic §
//   II.1. РАЗХОДИ ПО ДЕЙНОСТИ (repeated per unit)  — functional detail (bulk)
//
// We extract the two recapitulation sections only — they carry the headline
// plan-vs-actual figures by economic paragraph. Column layout (resolved from
// the "(1) … (8)" marker row so it survives minor shifts):
//   (1) Уточнен план — Общо     (5) Отчет — държавни дейности
//   (2) план — държавни          (6) Отчет — местни дейности
//   (3) план — местни            (7) Отчет — дофинансиране
//   (4) план — дофинансиране     (8) Отчет — Общо
//
// Headline totals are the sum of the economic-paragraph (XX-00) rows, which
// equals what the byParagraph list the reader drills into sums to — the same
// "honest tile" convention the capital-programme parsers use.

import { BGN_PER_EUR } from "../../../src/lib/currency";
import type {
  ExecutionParagraph,
  ExecutionSide,
  Money,
  MunicipalExecutionFile,
} from "./types";

export interface ParseB3Options {
  rows: unknown[][];
  fiscalYear: number;
  obshtina: string;
  muniSlug: string;
  muniNameBg: string;
  muniNameEn: string;
  source: { publisher: string; datasetUrl: string; resourceUri: string };
}

const WS_RE = new RegExp("[\\s\\u00a0\\u2007\\u202f]", "g");

const cellText = (c: unknown): string => String(c ?? "").trim();
const joinRow = (r: unknown[]): string =>
  r.map(cellText).filter(Boolean).join(" ");

// The ЕБК §§ code appears in two interchangeable encodings across files:
//   dashed   — "01-00", "13-00"          (Ruse 2024)
//   no-dash  — "100", "1300", "200"       (Ruse 2023, Николаево) where the
//              last two digits are the под-§§ and the rest is the §§
// Normalise both to the dashed form. Returns null for anything else (sequence
// numbers, the "99-99" grand-total marker lives in the под-§§ column anyway).
const normalizeCode = (raw: string): string | null => {
  const t = raw.replace(WS_RE, "");
  if (/^\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{3,4}$/.test(t)) {
    const p = t.padStart(4, "0");
    return `${p.slice(0, 2)}-${p.slice(2)}`;
  }
  return null;
};

// Strip whitespace variants + thousands separators; "x"/empty → null (so a
// genuine 0 stays distinct from "not applicable").
const parseAmount = (raw: unknown): number | null => {
  const s = cellText(raw).replace(WS_RE, "");
  if (s === "" || s === "x" || s === "X" || s === "-") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const toMoney = (amount: number, currency: "BGN" | "EUR"): Money => ({
  amount,
  currency,
  amountEur:
    currency === "BGN" ? Math.round(amount / BGN_PER_EUR) : Math.round(amount),
});

const executionPct = (plan: number, actual: number): number | null =>
  plan > 0 ? Math.round((actual / plan) * 1000) / 10 : null;

interface ColumnMap {
  planTotal: number;
  actualTotal: number;
  ssCol: number; // §§ economic-paragraph code column
}

// Resolve column positions within [start, end). The "(1) … (8)" marker row
// gives the plan/actual totals; the "§§" header cell gives the paragraph-code
// column. Falls back to the canonical 4/11/1 layout.
const resolveColumns = (
  rows: unknown[][],
  start: number,
  end: number,
): ColumnMap => {
  let planTotal = -1;
  let actualTotal = -1;
  let ssCol = -1;
  for (let i = start; i < end; i++) {
    const r = rows[i];
    for (let c = 0; c < r.length; c++) {
      const t = cellText(r[c]);
      if (t === "(1)") planTotal = c;
      if (t === "(8)") actualTotal = c;
      if (t === "§§" && ssCol < 0) ssCol = c;
    }
    if (planTotal >= 0 && actualTotal >= 0 && ssCol >= 0) break;
  }
  return {
    planTotal: planTotal >= 0 ? planTotal : 4,
    actualTotal: actualTotal >= 0 ? actualTotal : 11,
    ssCol: ssCol >= 0 ? ssCol : 1,
  };
};

// The label for a §§ row sits in the first text cell after the code column.
const findName = (r: unknown[], ssCol: number): string => {
  for (let c = ssCol + 1; c < Math.min(ssCol + 4, r.length); c++) {
    const t = cellText(r[c]);
    if (t && normalizeCode(t) === null && !/^\d+$/.test(t)) {
      return t.replace(WS_RE, " ").replace(/\s+/g, " ").trim();
    }
  }
  return "";
};

// Section banners. We find the index of each, then walk rows until the next
// banner / the end.
const REVENUE_RE = /П\s*Р\s*И\s*Х\s*О\s*Д\s*И/;
const EXPENSE_RECAP_RE = /РАЗХОДИ\s*-?\s*РЕКАПИТУЛАЦИЯ\s*ПО\s*ПАРАГРАФИ/i;
const BANNER_RE = /ОТЧЕТНИ\s*ДАННИ\s*ПО\s*ЕБК/i;
const DEINOSTI_RE = /РАЗХОДИ\s*ПО\s*ДЕЙНОСТИ/i;

const findSection = (
  rows: unknown[][],
  headerRe: RegExp,
): { start: number; end: number } | null => {
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    if (headerRe.test(joinRow(rows[i]))) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = rows.length;
  for (let i = start + 1; i < rows.length; i++) {
    const j = joinRow(rows[i]);
    if (BANNER_RE.test(j) || EXPENSE_RECAP_RE.test(j) || DEINOSTI_RE.test(j)) {
      end = i;
      break;
    }
  }
  return { start, end };
};

const parseSide = (
  rows: unknown[][],
  start: number,
  end: number,
  currency: "BGN" | "EUR",
): ExecutionSide => {
  const cols = resolveColumns(rows, start, end);
  const byParagraph: ExecutionParagraph[] = [];
  let planSum = 0;
  let actualSum = 0;
  for (let i = start; i < end; i++) {
    const r = rows[i];
    // The §§ column holds the economic-paragraph code on paragraph rows and is
    // empty on под-§§ detail rows — so reading it directly yields exactly the
    // paragraph rollups (and skips the "99-99" grand total, which sits in the
    // под-§§ column).
    const code = normalizeCode(cellText(r[cols.ssCol]));
    if (!code || !code.endsWith("-00")) continue;
    const plan = parseAmount(r[cols.planTotal]);
    const actual = parseAmount(r[cols.actualTotal]);
    if (plan === null && actual === null) continue;
    const p = plan ?? 0;
    const a = actual ?? 0;
    // A genuinely empty paragraph (no plan, no actual) carries no signal.
    if (p === 0 && a === 0) continue;
    byParagraph.push({
      code,
      name: findName(r, cols.ssCol),
      plan: toMoney(p, currency),
      actual: toMoney(a, currency),
      executionPct: executionPct(p, a),
    });
    planSum += p;
    actualSum += a;
  }
  byParagraph.sort((x, y) => y.actual.amountEur - x.actual.amountEur);
  return {
    plan: toMoney(planSum, currency),
    actual: toMoney(actualSum, currency),
    executionPct: executionPct(planSum, actualSum),
    byParagraph,
  };
};

// "01.1.2024 г." → "2024-01-01". The source uses non-zero-padded months.
const parseBgDate = (raw: string): string | null => {
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

const detectPeriod = (
  rows: unknown[][],
  fiscalYear: number,
): MunicipalExecutionFile["period"] => {
  // Scan the banner zone for a row carrying two DD.M.YYYY dates.
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const dates = rows[i]
      .map((c) => parseBgDate(cellText(c)))
      .filter((x): x is string => x !== null);
    if (dates.length >= 2) {
      const [start, end] = dates;
      return {
        start,
        end,
        isFullYear: end.endsWith("-12-31"),
        labelBg: `${start.split("-").reverse().join(".")} – ${end
          .split("-")
          .reverse()
          .join(".")}`,
      };
    }
  }
  // Fallback: assume the full fiscal year.
  return {
    start: `${fiscalYear}-01-01`,
    end: `${fiscalYear}-12-31`,
    isFullYear: true,
    labelBg: `01.01.${fiscalYear} – 31.12.${fiscalYear}`,
  };
};

// Some egov responses return each row as a bare object keyed by stringified
// column indices ({"0": "...", "1": "..."}) rather than a flat array of
// cells. Normalise both shapes to the array form so the same regex paths
// work either way.
const flattenRow = (raw: unknown): unknown[] | null => {
  if (Array.isArray(raw)) {
    // Some files wrap the object in a single-element array: [{"0": ...}].
    if (raw.length === 1) {
      const inner = flattenRow(raw[0]);
      if (inner) return inner;
    }
    return raw;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return null;
  const numericOnly = entries.every(([k]) => /^\d+$/.test(k));
  if (!numericOnly) return null;
  const max = entries.reduce((m, [k]) => Math.max(m, Number(k)), -1);
  const flat: unknown[] = new Array(max + 1).fill("");
  for (const [k, v] of entries) flat[Number(k)] = v;
  return flat;
};

// "ОТЧЕТ ЗА КАСОВОТО ИЗПЪЛНЕНИЕ" (per-group narrative format used by some
// municipalities pre-2019) carries plan/actual totals by named group, not by
// §§ paragraph code. The B3 parser can't roll it up; detect and skip cleanly.
const LEGACY_TEMPLATE_RE =
  /ОТЧЕТ\s+ЗА\s+КАСОВОТО\s+ИЗПЪЛНЕНИЕ\s+НА\s+БЮДЖЕТА.*ЧУЖДИТЕ\s+СРЕДСТВА/i;

export const parseB3 = (opts: ParseB3Options): MunicipalExecutionFile => {
  const { fiscalYear } = opts;
  // Some resources carry malformed trailing rows; drop them. Other resources
  // (the pre-B3 template variants) ship each row as a bare object instead of
  // an array, so normalise both shapes via flattenRow.
  const rows = opts.rows
    .map(flattenRow)
    .filter((r): r is unknown[] => r !== null);
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  // Sniff the legacy pre-B3 narrative template before the section finder runs
  // so the operator gets a meaningful "not yet supported" message instead of
  // "could not locate the I. ПРИХОДИ section".
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    if (LEGACY_TEMPLATE_RE.test(joinRow(rows[i]))) {
      throw new Error(
        "legacy 'Отчет за касовото изпълнение на бюджета, сметките за СЕС и " +
          "чуждите средства' template — no §§-paragraph column to roll up. " +
          "Not yet supported; the B3 template was adopted from FY2019 onward.",
      );
    }
  }

  const revSec = findSection(rows, REVENUE_RE);
  if (!revSec) throw new Error("could not locate the I. ПРИХОДИ section");
  const expSec = findSection(rows, EXPENSE_RECAP_RE);
  if (!expSec)
    throw new Error(
      "could not locate the II. РАЗХОДИ - РЕКАПИТУЛАЦИЯ ПО ПАРАГРАФИ section",
    );

  const revenue = parseSide(rows, revSec.start, revSec.end, currency);
  const expense = parseSide(rows, expSec.start, expSec.end, currency);

  if (revenue.byParagraph.length === 0 || expense.byParagraph.length === 0) {
    throw new Error(
      `parsed 0 paragraphs (revenue=${revenue.byParagraph.length}, ` +
        `expense=${expense.byParagraph.length}) — the B3 column layout may ` +
        `differ from the expected MINFIN template`,
    );
  }

  return {
    obshtina: opts.obshtina,
    muniSlug: opts.muniSlug,
    muniNameBg: opts.muniNameBg,
    muniNameEn: opts.muniNameEn,
    fiscalYear,
    period: detectPeriod(rows, fiscalYear),
    currency,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: opts.source.publisher,
      datasetUrl: opts.source.datasetUrl,
      resourceUri: opts.source.resourceUri,
      fetchedAt: new Date().toISOString(),
    },
    revenue,
    expense,
  };
};
