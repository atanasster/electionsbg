// Per-sector headline stat for the government sector tiles, from the
// pre-generated static file (built by db:gen-sector-stats). Keyed by the SAME
// scope key the window hook derives (useScopeWindow), so the sectors hub's
// scope control is live — one fetch, then look up the active scope.
//
// The headline answers "how much does this sector spend from public money?", so
// the number's MEANING varies by sector — `basis` records which, and the tile
// turns it into a one-word caption so the mixed kinds stay honest side by side:
//   budget      — приет expenditure of the fronting ПРБ (defense, security, …)
//   payout      — transfer outlay (pension, health, agri)
//   procurement — tender € in the selected scope (roads, energy, revenue, …)
//   headcount   — filled state-admin positions (administration)
//   score       — mean ДЗИ success (schools)
// `kind` still drives number formatting; `year` (annual bases) names the fiscal
// year for the caption.

import type { TFunction } from "i18next";
import { useQuery } from "@tanstack/react-query";
import { formatEurCompact } from "@/lib/currency";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export type SectorBasis =
  | "budget"
  | "payout"
  | "procurement"
  | "headcount"
  | "score";

export interface SectorStat {
  kind: "eur" | "score" | "count";
  basis: SectorBasis;
  value: number;
  /** Fiscal year the value came from (annual bases only). */
  year?: number;
  /** Caption qualifier the tile abbreviates. 'adjusted' = the figure is a
   *  годишен уточнен план (the НАП/АМ second-level agencies), not ЗДБРБ-приет. */
  note?: "adjusted";
  /** The selected `y:<year>` scope has no datum for this sector, so value/year
   *  are a fall-back to the latest available year (e.g. НЗОК before 2022). The
   *  tile shows a "no data for <year>" notice, not the misleading number. */
  unavailable?: boolean;
}

/** Tile-ready string for a sector stat: a compact € for euro figures, a
 *  two-decimal outcome score (matura), or a thousands-grouped integer
 *  (administration headcount). undefined for a missing/zero stat. */
export const formatSectorMetric = (
  stat: SectorStat | undefined,
  lang: string,
): string | undefined => {
  // No datum for the selected year → a dash, so the tile carries the
  // "no data for <year>" caption instead of a misleading fall-back number.
  if (stat?.unavailable) return "—";
  if (!stat || !stat.value) return undefined;
  if (stat.kind === "score")
    return stat.value.toLocaleString(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (stat.kind === "count") return Math.round(stat.value).toLocaleString(lang);
  return formatEurCompact(stat.value, lang);
};

const BASIS_LABEL_KEY: Record<SectorBasis, string> = {
  budget: "sector_metric_budget",
  payout: "sector_metric_payout",
  procurement: "sector_metric_procurement",
  headcount: "sector_metric_headcount",
  score: "sector_metric_score",
};

/** The calendar-period label for a procurement (windowed) stat, from the active
 *  scope: a single year for `y:<year>`, the selected parliament's span for `ns`
 *  (`2026` when it began and is still running this year, `2024–2026` across
 *  years), or undefined for `all` (the full corpus needs no period). An
 *  open-ended `ns` window (the latest parliament) runs to the current year. */
export const scopeProcurementPeriod = (win: {
  all: boolean;
  year: number | null;
  from: string | null;
  to: string | null;
}): string | undefined => {
  if (win.all) return undefined;
  if (win.year != null) return String(win.year);
  if (!win.from) return undefined;
  const fromY = Number(win.from.slice(0, 4));
  // `to` is the next election (exclusive upper bound); a Jan-1 bound belongs to
  // the prior year. No `to` → the latest parliament, still running → this year.
  const endY = win.to
    ? win.to.slice(5) === "01-01"
      ? Number(win.to.slice(0, 4)) - 1
      : Number(win.to.slice(0, 4))
    : new Date().getFullYear();
  return fromY >= endY ? String(fromY) : `${fromY}–${endY}`;
};

/** One-word caption under the tile number, telling the reader what the figure
 *  measures (бюджет 2025 / изплатено 2024 / поръчки 2026 / служители / успех).
 *  Annual bases append their fiscal year; procurement appends `period` (the
 *  active scope's window, via scopeProcurementPeriod). undefined when the stat
 *  is missing/zero (the number itself is hidden then too). */
export const sectorMetricCaption = (
  stat: SectorStat | undefined,
  t: TFunction,
  period?: string,
  selectedYear?: number | null,
): string | undefined => {
  if (!stat) return undefined;
  // Fall-back year (no datum for the selected year): say so plainly. Pairs with
  // the "—" from formatSectorMetric so the tile is honest about the gap.
  if (stat.unavailable)
    return selectedYear
      ? t("sector_metric_no_data_year", { year: selectedYear }) ||
          `няма данни за ${selectedYear}`
      : t("sector_metric_no_data") || "няма данни";
  if (!stat.value) return undefined;
  const label = t(BASIS_LABEL_KEY[stat.basis]);
  if (stat.basis === "procurement")
    return period ? `${label} ${period}` : label;
  const base = stat.year ? `${label} ${stat.year}` : label;
  // Qualifier abbreviation for the second-level agency budgets (НАП/АМ), whose
  // figure is a годишен уточнен план rather than the ЗДБРБ-приет of the ПРБ tiles.
  return stat.note === "adjusted"
    ? `${base} · ${t("sector_metric_budget_adjusted_abbr")}`
    : base;
};

/** scopeKey → sectorId → stat */
export type SectorStatsFile = Record<string, Record<string, SectorStat>>;

/** The sector→stat map for the active ?pscope, or undefined while loading. */
export const useSectorStats = (): Record<string, SectorStat> | undefined => {
  const { all, year, selected } = useScopeWindow();
  const key = all ? "all" : year != null ? `y:${year}` : `ns:${selected}`;
  const { data } = useQuery({
    queryKey: ["procurement", "sector-stats"] as const,
    queryFn: async (): Promise<SectorStatsFile> => {
      const r = await fetch("/procurement/derived/sector_stats.json");
      if (!r.ok) throw new Error(`sector-stats fetch failed: ${r.status}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return data?.[key];
};
