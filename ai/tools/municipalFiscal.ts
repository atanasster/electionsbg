import {
  MUNICIPAL_FISCAL_LATEST_VALIDATED_YEAR,
  MUNICIPAL_FISCAL_MAX_RESULTS,
  MUNICIPAL_FISCAL_METRICS,
  type MunicipalFiscalMetric,
} from "../../src/lib/questions/contracts/municipalFiscal";
import { fetchDb } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";

export type MunicipalFiscalRow = {
  obshtina: string;
  name_bg: string;
  name_en: string | null;
  fiscal_year: number;
  quarter: number;
  arrears_eur: number | null;
  commitments_eur: number | null;
  expense_obligations_eur: number | null;
  debt_stock_eur: number | null;
  meets_threshold: boolean | null;
  criteria_evaluable: number[] | null;
};

const metricColumn: Record<
  MunicipalFiscalMetric,
  "commitments_eur" | "expense_obligations_eur" | "arrears_eur"
> = {
  commitments: "commitments_eur",
  expense_obligations: "expense_obligations_eur",
  arrears: "arrears_eur",
};

export const rankMunicipalFiscalRows = (
  population: MunicipalFiscalRow[],
  metric: MunicipalFiscalMetric,
  count: number,
) => {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MUNICIPAL_FISCAL_MAX_RESULTS
  )
    throw new RangeError(`count must be 1–${MUNICIPAL_FISCAL_MAX_RESULTS}`);
  if (!MUNICIPAL_FISCAL_METRICS.includes(metric))
    throw new RangeError("Unknown municipal fiscal metric");
  const column = metricColumn[metric];
  return [...population]
    .sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av == null)
        return bv == null ? a.obshtina.localeCompare(b.obshtina) : 1;
      if (bv == null) return -1;
      return bv - av || a.obshtina.localeCompare(b.obshtina);
    })
    .slice(0, count);
};

/** Year-end municipal liability ranking from the same serving function as the
 * governance screen. The three liability stocks stay separate and null stays
 * unpublished; the tool performs no financial recomputation. */
export const municipalFiscalRanking = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const year = Number(args.year ?? MUNICIPAL_FISCAL_LATEST_VALIDATED_YEAR);
  const count = Number(args.count ?? 25);
  const metric = String(args.metric ?? "commitments") as MunicipalFiscalMetric;
  const population = await fetchDb<MunicipalFiscalRow[]>(
    "municipal-fiscal-ranking",
    { year, limit: 1000 },
  );
  const rows = rankMunicipalFiscalRows(population, metric, count);
  const column = metricColumn[metric];
  const metricLabel = {
    commitments: bg ? "поети ангажименти" : "commitments",
    expense_obligations: bg ? "задължения за разходи" : "expense obligations",
    arrears: bg ? "просрочени задължения" : "arrears",
  }[metric];
  return {
    tool: "municipalFiscalRanking",
    domain: "fiscal",
    kind: "table",
    viz: "bar",
    title: bg
      ? `Общини по ${metricLabel} — ${year} г.`
      : `Municipalities by ${metricLabel} — ${year}`,
    columns: [
      { key: "municipality", label: bg ? "Община" : "Municipality" },
      {
        key: "commitments",
        label: bg ? "Поети ангажименти (€)" : "Commitments (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "obligations",
        label: bg ? "Задължения за разходи (€)" : "Expense obligations (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "arrears",
        label: bg ? "Просрочия (€)" : "Arrears (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "debt",
        label: bg ? "Общински дълг (€)" : "Municipal debt (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "criteria",
        label: bg ? "Оценени критерии" : "Criteria evaluated",
      },
      {
        key: "threshold",
        label: bg ? "Праг по чл. 130а" : "Art. 130a threshold",
      },
    ],
    rows: rows.map((row) => ({
      municipality: bg ? row.name_bg : row.name_en || row.name_bg,
      commitments: row.commitments_eur,
      obligations: row.expense_obligations_eur,
      arrears: row.arrears_eur,
      debt: row.debt_stock_eur,
      criteria: row.criteria_evaluable?.join(", ") ?? null,
      threshold:
        row.meets_threshold == null
          ? null
          : row.meets_threshold
            ? bg
              ? "да"
              : "yes"
            : bg
              ? "не"
              : "no",
    })),
    facts: {
      [bg ? "период" : "period"]: `${year}-Q4`,
      [bg ? "показани общини" : "municipalities shown"]: rows.length,
      [bg ? "общини в набора" : "eligible municipalities"]: population.length,
      [bg ? "без публикувана стойност" : "without published value"]:
        population.filter((row) => row[column] == null).length,
      [bg ? "липсващо" : "missing values"]: bg
        ? "NULL означава непубликувана стойност, не нула"
        : "NULL means unpublished, not zero",
    },
    provenance: [
      "municipal_fiscal_ranking() — Ministry of Finance, year-end Q4",
    ],
  };
};
