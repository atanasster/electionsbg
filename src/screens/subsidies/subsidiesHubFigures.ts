// The /subsidies head's KPI band, as a pure function over the agri hub-stats blob.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts` and
// `consumptionHubFigures.ts` are: a band built inline is unreachable from
// `hubHead.gates.test.ts`, whose band/tile clause compares band values against tile metrics
// as rendered strings.

import type { HubKpi } from "@/ux/infographic/HubHead";
import type { AgriHubStats } from "@/data/agri/useAgriHubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { numberLocale } from "@/data/agri/labels";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Which tile a band cell displaces, keyed by that cell's DESTINATION.
 *
 *  ⚠️ KEYED ON WHAT THE BAND EMITTED, never a compile-time list — a cell can legitimately
 *  not render (this blob withholds a figure rather than publishing a zero), and a constant
 *  list would then blank the tile anyway and remove the number from the page entirely. */
const TILES_BY_DESTINATION: Record<string, readonly string[]> = {
  "/subsidies/browse": [],
  "/subsidies/recipients": ["recipients"],
  "/subsidies/untraceable": ["untraceable"],
  "/subsidies/concentration": ["concentration"],
};

/** The tiles whose metric this band is carrying, derived from the cells that rendered. */
export const promotedTiles = (kpis: HubKpi[]): Set<string> => {
  const out = new Set<string>();
  for (const k of kpis)
    for (const id of TILES_BY_DESTINATION[String(k.to)] ?? []) out.add(id);
  return out;
};

/** Every tile any band cell could displace — for gates, never for rendering. */
export const SUBSIDIES_BAND_TILES = Object.values(TILES_BY_DESTINATION).flat();

/** The head's four figures.
 *
 *  ⚠️⚠️ EVERY CELL IS SCOPE-DEPENDENT, AND THE SCOPE MOVES THEM BY 7×. `/subsidies` carries
 *  a `?pscope` control whose default is the LATEST FINANCIAL YEAR, not the corpus: measured
 *  2026-08-26, €1.59bn against €11.04bn all-time, 8,396 recipients against 16,701. So the
 *  basis is not a decoration that can lag the figure — it is the difference between „the
 *  state paid out €1.59bn" being true and being eight times too small. Each cell's caption
 *  is built from the SAME blob that carried its number (`scopeKey` / `scopeYear` ride on it
 *  for exactly this reason), so the two cannot come from different scopes.
 *
 *  ⚠️ THE `all` SCOPE IS EIGHT YEARS, NOT ELEVEN. The corpus covers 2015-2017 and 2021-2025
 *  — ДФЗ published nothing for 2018, 2019 or 2020 — so a caption reading „2015–2025" claims
 *  three years of coverage that do not exist. The count leads and the span follows it.
 *
 *  ⚠️ THE TWO PERCENTAGES HAVE DIFFERENT DENOMINATORS and sit side by side: 49.3% is of
 *  TOTAL money, 14.8% is of ENTITY money (the payer excluded — see 162's own comment on why
 *  that suffix is load-bearing). Captioned only „%", the smaller would read as the milder
 *  fact when they are not measured against the same thing at all. */
export const subsidiesHubKpis = (
  stats: AgriHubStats | null | undefined,
  years: readonly number[],
  lang: string,
  bg: boolean,
  t: T,
): HubKpi[] => {
  const out: HubKpi[] = [];
  if (!stats) return out;

  const nloc = numberLocale(bg);
  const pct = (n: number) =>
    `${new Intl.NumberFormat(nloc, { maximumFractionDigits: 1 }).format(n)}%`;

  // The window every cell is measured over, in the reader's words. ONE definition, so no
  // two cells can describe different scopes — and it names the PERIOD only. The source is
  // declared once, in the head's eyebrow („СУБСИДИИ · ДФ „ЗЕМЕДЕЛИЕ“"); repeating it here
  // composed into „… без ДФЗ · финансова 2025 г. · ДФЗ".
  const sorted = [...years].sort((a, b) => a - b);
  const window = stats.scopeYear
    ? t("subsidies_kpi_window_year", { year: stats.scopeYear })
    : t("subsidies_kpi_window_all", {
        count: formatInt(sorted.length, lang),
        first: sorted[0],
        last: sorted[sorted.length - 1],
      });

  // ⚠️ TWO OF THE FOUR GUARDS BELOW ARE BELT-AND-BRACES, AND THE ASYMMETRY IS DELIBERATE.
  // `AgriHubStats` types `totalEur` and `entityCountExPayer` non-nullable (162 reads both
  // from the driving CTE, not a LEFT JOIN), so those two guards describe a state the type
  // says cannot occur — they exist against a blob from an older deploy, which is a real
  // hazard on this page because the payload is rebuilt by a manual loader. The other two
  // ARE nullable in the contract and their guards are load-bearing.
  if (stats.totalEur != null)
    out.push({
      value: formatEurCompact(stats.totalEur, lang),
      label: t("subsidies_kpi_paid"),
      basis: window,
      to: "/subsidies/browse",
    });

  // „фирми", not „получатели" — this counts entities carrying an ЕИК, and the ~61k
  // beneficiaries WITHOUT one are a separate population that the third cell is about.
  // Calling it „recipients" would silently annex them.
  if (stats.entityCountExPayer != null)
    out.push({
      value: formatInt(stats.entityCountExPayer, lang),
      label: t("subsidies_kpi_firms"),
      basis: t("subsidies_kpi_firms_basis", { window }),
      to: "/subsidies/recipients",
    });

  if (stats.noEikPctOfTotalEur != null)
    out.push({
      value: pct(stats.noEikPctOfTotalEur),
      label: t("subsidies_kpi_no_eik"),
      basis: t("subsidies_kpi_no_eik_basis", { window }),
      to: "/subsidies/untraceable",
    });

  if (stats.top100PctOfEntityEur != null)
    out.push({
      value: pct(stats.top100PctOfEntityEur),
      label: t("subsidies_kpi_top100"),
      basis: t("subsidies_kpi_top100_basis", { window }),
      to: "/subsidies/concentration",
    });

  return out;
};
