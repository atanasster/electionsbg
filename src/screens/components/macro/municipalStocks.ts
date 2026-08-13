// Pure shaping helpers behind MunicipalCommitmentsTile, in their own module so
// the tile file exports a component and nothing else (react-refresh) and so the
// rules they encode are testable without rendering recharts.

import { MacroPoint } from "@/data/macro/useMacro";

/** The generator emits two extra fields per point; `MacroPoint` does not know
 *  about them, and both are load-bearing here — a total with fewer than the
 *  full roster behind it is an undercount and must say so. */
export type StockPoint = MacroPoint & {
  municipalityCount?: number;
  partial?: boolean;
};

/** The palette for the three nested stocks, keyed on the CONCEPT rather than on
 *  either surface's column names — /indicators/fiscal reads macro.json keys and
 *  the município tile reads SQL columns, and a reader carries the meaning from
 *  one page to the other by colour. Two independent literals is the silent way
 *  to break that link. */
export const STOCK_COLOR = {
  commitments: "#6366f1",
  obligations: "#f59e0b",
  arrears: "#dc2626",
} as const;

export const STOCKS = [
  { key: "municipalCommitments", color: STOCK_COLOR.commitments },
  { key: "municipalExpenseObligations", color: STOCK_COLOR.obligations },
  { key: "municipalArrears", color: STOCK_COLOR.arrears },
] as const;

export type StockKey = (typeof STOCKS)[number]["key"];

export type ChartRow = {
  period: string;
  count?: number;
  partial?: boolean;
} & Partial<Record<StockKey, number>>;

export const buildRows = (
  series: Partial<Record<StockKey, StockPoint[]>>,
): ChartRow[] => {
  const byPeriod = new Map<string, ChartRow>();
  for (const { key } of STOCKS) {
    for (const p of series[key] ?? []) {
      const period = p.period ?? `${p.year}-Q${p.quarter ?? 4}`;
      const row = byPeriod.get(period) ?? { period };
      row[key] = p.value;
      // The widest roster of the three wins the caption: any short one is the
      // withheld-field case, which `partial` reports separately.
      if ((p.municipalityCount ?? 0) > (row.count ?? 0)) {
        row.count = p.municipalityCount;
      }
      if (p.partial) row.partial = true;
      byPeriod.set(period, row);
    }
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
};

/** The newest quarter at which BOTH stocks have a figure. Rule 2 above: a
 *  headline ratio may only pair same-quarter readings, and the commitments
 *  series legitimately skips a quarter when the source freezes its column. */
/** A point's quarter label, or null when it does not have one. Never invents a
 *  Q4: an ANNUAL point carries no quarter, and defaulting it to Q4 would let
 *  this helper pair a Q4 stock with a whole-year figure — the precise
 *  cross-date pairing it exists to refuse. */
const quarterPeriodOf = (p: MacroPoint): string | null =>
  p.period ?? (p.quarter ? `${p.year}-Q${p.quarter}` : null);

export const latestSharedQuarter = (
  a: StockPoint[] | undefined,
  b: MacroPoint[] | undefined,
): { period: string; a: number; b: number } | null => {
  if (!a?.length || !b?.length) return null;
  const bByPeriod = new Map<string, number>();
  for (const p of b) {
    const period = quarterPeriodOf(p);
    // A non-positive comparand cannot carry a share, and rendering
    // `a / 0 * 100` would put „Infinity %" into user-facing copy.
    if (period != null && p.value > 0) bByPeriod.set(period, p.value);
  }
  const sorted = [...a]
    .map((p) => ({ p, period: quarterPeriodOf(p) }))
    .filter((x): x is { p: StockPoint; period: string } => x.period != null)
    .sort((x, y) => x.period.localeCompare(y.period));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { p, period } = sorted[i];
    const other = bByPeriod.get(period);
    if (other != null) return { period, a: p.value, b: other };
  }
  return null;
};

/** The newest quarter at which THIS stock has a figure — which is not always
 *  the newest quarter in the chart. When МФ freezes a column the ingest
 *  withholds it, so at 2025-Q3 arrears exist and commitments do not; a headline
 *  card reading the last ROW would then print „—" for the two figures the tile
 *  is mainly about, while the data for the previous quarter sits right there.
 *  Each card states its OWN quarter instead. */
export const latestPerStock = (
  rows: ChartRow[],
): Partial<Record<StockKey, { period: string; value: number }>> => {
  const out: Partial<Record<StockKey, { period: string; value: number }>> = {};
  for (const row of rows) {
    for (const { key } of STOCKS) {
      const v = row[key];
      if (v != null) out[key] = { period: row.period, value: v };
    }
  }
  return out;
};

/** EUR millions → a localised display string, switching unit at a billion.
 *  Lives here rather than in the tile so the threshold, the rounding and the
 *  language branch are testable without rendering recharts. Distinct from the
 *  registry's `eurMnToBn`, which always converts to billions — „€75 млн."
 *  reads better on a card than „€0.1B". */
export const fmtEurM = (v: number, locale: string): string => {
  const bg = locale.startsWith("bg");
  return v >= 1000
    ? `€${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} ${bg ? "млрд." : "bn"}`
    : `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })} ${bg ? "млн." : "m"}`;
};
