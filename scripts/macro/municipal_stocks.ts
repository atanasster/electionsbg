// The NATIONAL municipal liability stocks — the aggregate half of the
// per-município corpus (migration 149), read into `data/macro.json` so they sit
// beside the deficit, the fiscal reserve and the debt emissions on
// /indicators/fiscal.
//
// **`fetch_eurostat.ts` is the durable writer.** It rebuilds macro.json from
// its indicator list, so anything patched in from the side is dropped at the
// next macro refresh — which is why the three entries below are pushed onto
// `CURATED_INDICATORS` there rather than written here.
// `patch_municipal_stocks.ts` applies the SAME entries to an existing
// macro.json for the case where the corpus moved and a full network refresh is
// not wanted; both import from this file, so the two can never disagree about a
// figure or a caption.
//
// Unlike `arrears`, there is no fetch/cache step: T1's ingest already commits
// `data/budget/municipal_fiscal/<YYYY>-Q<n>.json`, and this is a pure reader
// over it. No database, so a macro rebuild never needs one.
//
// QUARTERLY, not annual, and that is deliberate. The справка is quarterly, the
// fiscal reserve it is charted against is quarterly, and stocks may only be
// compared at the SAME quarter — an annual roll-up would either drop three
// quarters of every year or invent a within-year aggregate that means nothing
// (these are stocks, so they do not sum over time).
//
// THREE series, not one. The story is the CONTRAST between them — commitments
// against arrears is 46× at 2024-Q4 — and a consumer that had to sum three
// tables to see it would not bother.
//
// **They are not a component of anything else on that page.** The consolidated
// cash deficit books a municipal payment when it is MADE, so these are invisible
// in the national numbers until paid. Never stack, sum or subtract them against
// the deficit, the debt or the reserve.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Money,
  MunicipalFiscalQuarter,
} from "../budget/municipal_fiscal/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, "../../data/budget/municipal_fiscal");

export type StockField = "commitments" | "expenseObligations" | "arrears";

export interface QuarterPoint {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  period: string;
  value: number;
  /** Municipalities actually behind the figure. Reported because the ingest
   *  withholds a frozen column rather than zeroing it, so a total can be a
   *  genuine undercount — and a sum with no denominator hides that. */
  municipalityCount: number;
  /** True when this quarter has fewer contributing municipalities than the
   *  widest quarter in the corpus — either because a município withheld the
   *  field, or because it filed no row at all. Both make the total an
   *  undercount, and neither is visible from the figure alone. */
  partial: boolean;
}

export interface QuarterFile {
  period: string;
  rows: MunicipalFiscalQuarter[];
}

export const buildSeries = (
  files: QuarterFile[],
  field: StockField,
): QuarterPoint[] => {
  // The denominator for `partial` is the WIDEST quarter in the corpus, not the
  // file's own row count. A município that filed nothing at all gets no row
  // written (ingest T1.5), so a shrunken file would otherwise look complete —
  // 262 of 262 reported, `partial: false` — with three municipalities silently
  // absent from a national total. Comparing against the widest quarter makes a
  // shrunken file visible as the undercount it is.
  const roster = files.reduce((n, f) => Math.max(n, f.rows.length), 0);
  return files
    .map((f) => {
      const m = /^(\d{4})-Q([1-4])$/.exec(f.period);
      if (!m) return null;
      // Filter on the NUMBER, not on the Money object: a row whose `amountEur`
      // is missing or NaN would otherwise be counted in `municipalityCount`
      // while contributing nothing to the sum — the same „a hole became a zero"
      // failure this module exists to prevent, one level down.
      const present = f.rows.filter((r) =>
        Number.isFinite(r[field]?.amountEur),
      );
      // A quarter where NOBODY reported the field is not a zero — it is the
      // frozen-column case, and publishing €0 would read as „nothing
      // contracted" on the one figure this whole pillar exists to surface.
      if (present.length === 0) return null;
      return {
        year: Number(m[1]),
        quarter: Number(m[2]) as 1 | 2 | 3 | 4,
        period: f.period,
        value:
          Math.round(
            (present.reduce((a, r) => a + (r[field] as Money).amountEur, 0) /
              1e6) *
              10,
          ) / 10,
        municipalityCount: present.length,
        partial: present.length < Math.max(f.rows.length, roster),
      };
    })
    .filter((p): p is QuarterPoint => p != null)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
};

/** Read every committed quarter file. Returns [] (with a warning) when the
 *  corpus is absent, so a fresh clone still rebuilds macro.json — the three
 *  series come back empty and the tile's guard suppresses them.
 *
 *  That is only true because the assembler treats these three specially
 *  (`MAY_SHRINK` in `fetch_eurostat.ts`): a corpus-derived series may
 *  legitimately LOSE a quarter, which for a 4-point series is a 25% drop and
 *  would otherwise abort the whole macro build on designed behaviour. It may
 *  NOT drop to zero while a prior series exists — an absent corpus on a machine
 *  whose macro.json already carries the series is a broken checkout, not a
 *  design case, and still aborts. */
export const readCorpus = (dir: string = CORPUS_DIR): QuarterFile[] => {
  if (!existsSync(dir)) {
    console.warn(
      `[municipal-stocks] ${dir} absent — the three national series will be empty. ` +
        "Run scripts/budget/municipal_fiscal/ingest.ts to populate it.",
    );
    return [];
  }
  return readdirSync(dir)
    .filter((f) => /^\d{4}-Q[1-4]\.json$/.test(f))
    .sort()
    .map(
      (f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as QuarterFile,
    );
};

/** The three stocks, in nesting order (outermost first). */
const STOCKS: {
  key: string;
  field: StockField;
  titleBg: string;
  titleEn: string;
  descBg: string;
  descEn: string;
}[] = [
  {
    key: "municipalCommitments",
    field: "commitments",
    titleBg: "Поети ангажименти на общините",
    titleEn: "Municipal commitments (поети ангажименти)",
    descBg:
      "Договорени и неизпълнени към края на периода, дължими изцяло или частично през следващи бюджетни години",
    descEn:
      "Contracted and unperformed at period end, due in whole or in part in following budget years",
  },
  {
    key: "municipalExpenseObligations",
    field: "expenseObligations",
    titleBg: "Задължения за разходи на общините",
    titleEn: "Municipal expenditure obligations (задължения за разходи)",
    descBg: "Начислени, но още не просрочени",
    descEn: "Invoiced, not yet past their payment term",
  },
  {
    key: "municipalArrears",
    field: "arrears",
    titleBg: "Просрочени задължения на общините",
    titleEn: "Municipal arrears (просрочени задължения)",
    descBg:
      "Просрочени. Отчитат се от самата община по задбалансови сметки — не са одитирани",
    descEn:
      "Overdue. Self-reported by the municipality on off-balance-sheet accounts — not audited",
  },
];

/** The three keys, without touching the disk. The assembler needs them to build
 *  its shrink-gate exemption at module load, which must not read the corpus (it
 *  would double the warning on a fresh clone). */
export const MUNICIPAL_STOCK_KEYS: readonly string[] = STOCKS.map((s) => s.key);

export interface MunicipalStockIndicator {
  source: "curated";
  key: string;
  cadence: "quarterly";
  sourceUrl: string;
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  attributionEn: string;
  attributionBg: string;
  series: QuarterPoint[];
}

/** The three `CURATED_INDICATORS` entries, fully built. Shared by the assembler
 *  and the patcher so a caption or a figure can never differ between them. */
export const municipalStockIndicators = (
  dir: string = CORPUS_DIR,
): MunicipalStockIndicator[] => {
  const files = readCorpus(dir);
  return STOCKS.map((s) => ({
    source: "curated" as const,
    key: s.key,
    cadence: "quarterly" as const,
    sourceUrl: "https://www.minfin.bg/bg/810",
    titleEn: s.titleEn,
    titleBg: s.titleBg,
    unitLabelEn: "EUR million (end-of-quarter stock)",
    unitLabelBg: "млн. евро (натрупан обем, край на тримесечие)",
    attributionEn: `Ministry of Finance — municipal financial indicators (ЗПФ чл. 130г ал. 2), summed over all reporting municipalities. ${s.descEn}. NOT a component of the state deficit, debt or fiscal reserve: the consolidated cash deficit books a municipal payment when it is made, so these are invisible nationally until paid.`,
    attributionBg: `Министерство на финансите — финансови показатели на общините (ЗПФ чл. 130г ал. 2), сумирани по всички отчитащи се общини. ${s.descBg}. НЕ са част от държавния дефицит, дълг или фискален резерв: консолидираното касово салдо отчита общинско плащане в момента на плащането, така че тези суми са невидими на национално ниво до плащането им.`,
    series: buildSeries(files, s.field),
  }));
};
