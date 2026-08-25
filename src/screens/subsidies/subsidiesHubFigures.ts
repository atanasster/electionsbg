// The /subsidies head's KPI band, as a pure function over the agri hub-stats blob.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts` and
// `consumptionHubFigures.ts` are: a band built inline is unreachable from
// `hubHead.gates.test.ts`, whose band/tile clause compares band values against tile metrics
// as rendered strings.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { AgriHubStats } from "@/data/agri/useAgriHubStats";
import type { AgriTopRecipient } from "@/data/agri/types";
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

/** The window every figure on this head is measured over, in the reader's words.
 *
 *  ⚠️ ONE DEFINITION, used by the band AND the evidence aside — two copies is how the two
 *  halves of a head end up describing different scopes. It names the PERIOD only: the source
 *  is declared once, in the eyebrow („СУБСИДИИ · ДФ „ЗЕМЕДЕЛИЕ“"), and repeating it here
 *  composed into „… без ДФЗ · финансова 2025 г. · ДФЗ".
 *
 *  ⚠️ „ONE" MEANS WITHIN THE HEAD, NOT WITHIN THE MODULE. `formatScopeLabel` is a second
 *  window vocabulary used by seven sibling /subsidies pages („Финансова година 2025" /
 *  „Всички години"), and the two are deliberately different registers — a basis line under a
 *  figure versus a scope pill's own label. Merging them is a module-wide decision, not a
 *  head one; what matters here is that the band and the aside cannot disagree.
 *
 *  ⚠️ ON `all` THE COUNT LEADS AND THE SPAN FOLLOWS. ДФЗ published nothing for 2018-2020,
 *  so the corpus is EIGHT financial years across an eleven-year span; „2015–2025" alone
 *  claims three years of coverage that do not exist. */
export const subsidiesWindow = (
  stats: Pick<AgriHubStats, "scopeYear">,
  years: readonly number[],
  lang: string,
  t: T,
): string => {
  const sorted = [...years].sort((a, b) => a - b);
  return stats.scopeYear
    ? t("subsidies_kpi_window_year", { year: stats.scopeYear })
    : t("subsidies_kpi_window_all", {
        count: formatInt(sorted.length, lang),
        first: sorted[0],
        last: sorted[sorted.length - 1],
      });
};

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

  const window = subsidiesWindow(stats, years, lang, t);

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

/** The head's evidence aside: the largest recipients, by name.
 *
 *  ⚠️⚠️ THE CAPTION MUST SAY THIS RANKS ONLY THE TRACEABLE HALF. On the default scope
 *  49.3% of the money sits on rows with NO ЕИК — the band's third cell is about exactly
 *  that — and those beneficiaries cannot be aggregated into a recipient at all, so they
 *  are absent from this ranking by construction rather than by size. „Най-големи
 *  получатели" over a corpus where half the money is unattributable is a claim about the
 *  attributable half, and only the caption can say so.
 *
 *  ⚠️ THE ROWS AND THE CAPTION COME FROM TWO BLOBS. `topRecipients` is in `agri_payloads`
 *  (written by `db:load:agri:pg`) while the window and the no-ЕИК share come from
 *  `agri_hub_stats_cache` (migration 162, `db:load:agri-hub-stats:pg`) — two loaders that
 *  CLAUDE.md documents as able to diverge, since the hub-stats one has five inputs and its
 *  own trigger list. A rebuild of one without the other captions this year's rows with last
 *  vintage's percentage. Nothing here can detect that; it is recorded so a future reader
 *  does not assume the pair is atomic.
 *
 *  ⚠️ ROWS CARRY THE MONEY, NEVER THE YEAR SPAN. `AgriTopRecipient.totalEur` follows the
 *  scope while `firstYear`/`lastYear`/`yearCount` do not — on a year scope the row pairs
 *  one year's money with the recipient's whole corpus presence, which reads as a multi-year
 *  total roughly five times too small. */
export const subsidiesHubEvidence = (
  rows: readonly AgriTopRecipient[] | undefined,
  noEikPct: number | null | undefined,
  window: string,
  lang: string,
  bg: boolean,
  t: T,
): HubEvidence | undefined => {
  if (!rows?.length) return undefined;
  // Refused without the share it has to disclaim — a top-recipients list that cannot say
  // how much of the money it leaves out is the fragment-of-an-unstated-whole shape.
  if (noEikPct == null) return undefined;

  const nloc = numberLocale(bg);
  const pct = new Intl.NumberFormat(nloc, { maximumFractionDigits: 1 }).format(
    noEikPct,
  );

  return {
    heading: t("subsidies_evidence_heading"),
    basis: t("subsidies_evidence_basis", { window, pct }),
    rows: rows.slice(0, 5).map((r) => ({
      // The ЕИК, not the name: two companies can share one, and React then reuses the row.
      id: r.eik,
      label: r.name,
      value: formatEurCompact(r.totalEur, lang),
      to: `/farm/${r.eik}`,
    })),
    action: {
      to: "/subsidies/recipients",
      label: t("subsidies_evidence_action"),
    },
  };
};
