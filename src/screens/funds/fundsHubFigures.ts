// The /funds hub's two PURE payload→display functions.
//
// They live outside FundsScreen.tsx so `hubHead.gates.test.ts` can call them, and so the screen
// exports only components (react-refresh/only-export-components). A gate that compares the
// band's figures against the tiles' has to render both, and it cannot import a screen without
// dragging the whole page's module graph into a unit test.

import { formatEur, formatEurCompact, formatInt } from "@/lib/currency";
import type { HubKpi } from "@/ux/infographic";
import type { FundsHubStats } from "@/data/funds/useFundsHubStats";
import type { FundsIndexFile } from "@/data/funds/types";

/** One tile's metric, or nothing.
 *
 * EVERY FIGURE HERE IS THE DESTINATION'S OWN. That is the dashboard-hub skill's rule and this
 * module has already broken it twice: the beneficiaries tile must quote 53 108 (ИСУН's
 * REGISTER, which /funds/beneficiaries ranks) and not the 47 599 contract-derived count, and the
 * Interreg tile must quote the BG-filtered 1 115 and not the corpus-wide 1 954.
 *
 * `undefined` when the figure is absent — a cold database, an unapplied migration. The tile then
 * renders with no number, which is the honest state; a `0` would be a claim.
 */
export const tileMetric = (
  id: string,
  s: FundsHubStats | null | undefined,
  lang: string,
  t: (k: string) => string,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const int = (n: number | null | undefined) =>
    n == null ? null : formatInt(n, lang);
  const eur = (n: number | null | undefined) =>
    n == null ? null : formatEur(n, lang);
  // A DECIMAL COMMA in Bulgarian. `${53.8}%` renders „53.8%" whatever the page language is,
  // which is the one formatting slip a template literal makes silently.
  const pct = (n: number | null | undefined) =>
    n == null
      ? null
      : `${new Intl.NumberFormat(lang === "en" ? "en-GB" : "bg-BG", {
          maximumFractionDigits: 1,
        }).format(n)}%`;
  const m = (
    metric: string | null,
    metricCaption: string,
    metricSecondary?: string,
  ) =>
    metric
      ? {
          metric,
          metricCaption,
          ...(metricSecondary ? { metricSecondary } : {}),
        }
      : undefined;

  switch (id) {
    case "beneficiaries":
      // DELIBERATELY NO METRIC. `tiles.registerBeneficiaries` is 53 122 and so is the head's
      // first KPI cell — same number, same destination, one screen apart. §3.1 rule 5 resolves
      // that by taking the figure off the TILE, not out of the band: the band is where a
      // corpus-level figure earns its size, and a tile whose number the reader has just read
      // teaches them the grid repeats itself. The other candidate, `isun.beneficiaryCount`
      // (47 617), is the CONTRACT-derived count on a card captioned „организации в регистъра" —
      // a second denominator for the same word, which is worse than no number.
      return undefined;
    case "programmes":
      return m(int(s.isun.programmeCount), t("funds_m_programmes"));
    case "places":
      // The PLACED money, with its coverage — never the corpus total, which is twice this.
      return m(
        eur(s.isun.placedContractedEur),
        t("funds_m_placed"),
        pct(s.isun.placedMoneyPct)
          ? `${pct(s.isun.placedMoneyPct)} ${t("funds_m_of_corpus")}`
          : undefined,
      );
    case "political":
      return m(int(s.tiles.politicalEiks), t("funds_m_flagged"));
    case "integrity":
      return m(
        int(s.tiles.highConcentrationProgrammes),
        t("funds_m_concentrated"),
        `${t("funds_m_of")} ${s.isun.programmeCount}`,
      );
    case "dualCorpus":
      return m(int(s.tiles.dualCorpusCompanies), t("funds_m_both_corpora"));
    case "focus":
      return m(int(s.tiles.focusDossiers), t("funds_m_dossiers"));
    case "absorption":
      // The GRANT basis, named in the caption — the other answer is 41.1%.
      return m(
        pct(s.isun.absorptionPctOfGrant),
        t("funds_m_paid_of_grant"),
        eur(s.isun.paidEur) ?? undefined,
      );
    case "rrf":
      return m(
        eur(s.rrf.contractedEur),
        t("funds_m_rrf_contracted"),
        pct(s.rrf.absorptionPctOfGrant)
          ? `${pct(s.rrf.absorptionPctOfGrant)} ${t("funds_m_paid")}`
          : undefined,
      );
    case "interreg":
      // The BG-FILTERED count, matching /funds/interreg's own headline.
      return m(
        int(s.interreg.bgOperationCount),
        t("funds_m_bg_projects"),
        eur(s.interreg.bgBudgetEur) ?? undefined,
      );
    default:
      return undefined;
  }
};

type TFn = (k: string, o?: Record<string, unknown>) => string;

/** The head's four corpus figures, as a PURE function of the two payloads.
 *
 *  ⚠ EVERY MONEY CELL READS `hubStats`, THE SAME OBJECT THE TILES READ. The band was built
 *  from `useFundsIndex` (`fund_payloads` kind='index') while every tile metric and every
 *  destination reads `funds_hub_stats()`, and the two disagree: measured 2026-08-25,
 *  `contractedEur` matches to the cent but `paidEur` is 18 209 693 782.83 against
 *  18 576 652 667.17 — €367M, 2.0% apart. So the page printed „Изплатени €18,2 млрд." in its
 *  largest type and „€18 576 652 667" on the tile a screen below. §3.1 rule 3 („read the SAME
 *  blob the tiles read") exists for exactly this.
 *
 *  ⚠ THE RATIO IS THE BLOB'S OWN FIELD, not paid/contracted recomputed here. Recomputing gave
 *  41% against the blob's 42.2%, and the page the cell links to prints 55.4% —
 *  `absorptionPctOfGrant`, a different denominator. CLAUDE.md's funds section is explicit that
 *  both are true and ~12.7 points apart, which is why every basis names its own.
 *
 *  ⚠ EVERY CELL DECLARES ITS DENOMINATOR, and they are four different kinds: organisations in
 *  a register, a sum over signed contracts, that sum's disbursed share, and a count of PEOPLE.
 *
 *  ⚠ FOUR DISTINCT DESTINATIONS. „Договорени" and „Изплатени" both used to link to
 *  /funds/absorption, so two adjacent cells sent a reader to one page.
 *
 *  A cell whose source is absent is OMITTED rather than zeroed (§3.1 rule 7).
 *
 *  Lifted out of the component so a gate can compare the RENDERED STRINGS against the tile
 *  metrics. A field-name comparison could not catch two different fields that happen to format
 *  alike — which is the shape that shipped once: `totals.beneficiaries` and
 *  `tiles.registerBeneficiaries` are different fields and both render „53 122".
 */
export const kpisFor = (
  index: FundsIndexFile | null | undefined,
  hubStats: FundsHubStats | null | undefined,
  lang: string,
  t: TFn,
): HubKpi[] => {
  const totals = index?.totals;
  const cr = index?.crossReference;
  const isun = hubStats?.isun;
  const eikPct =
    totals && totals.beneficiaries > 0
      ? Math.round((totals.withEik / totals.beneficiaries) * 100)
      : 0;
  // Locale-aware. Pinned to "bg-BG" it grouped with U+00A0 on the English site while the euro
  // beside it followed the reader — two number conventions in one band.
  const numFmt = new Intl.NumberFormat(lang === "en" ? "en-GB" : "bg-BG");
  return [
    ...(totals
      ? [
          {
            value: numFmt.format(totals.beneficiaries),
            label: t("funds_index_beneficiaries") || "Beneficiaries",
            // Keeps the caveat the old card carried: 13% of the register's beneficiaries have
            // no EIK, so they cannot be joined to any company record.
            basis: t("funds_kpi_basis_register", { pct: eikPct }),
            to: "/funds/beneficiaries",
          },
        ]
      : []),
    ...(isun
      ? [
          {
            // COMPACT in the band. `formatEur` renders „€44 015 477 336" — 15 characters in a
            // cell sized for a headline, which wraps and shrinks the number it exists to make
            // loud. The exact figure is on the page the cell links to.
            value: formatEurCompact(isun.contractedEur, lang),
            label: t("funds_index_contracted") || "Funds contracted",
            basis: t("funds_kpi_basis_signed"),
            to: "/funds/programmes",
          },
          {
            value: formatEurCompact(isun.paidEur, lang),
            label: t("funds_index_paid") || "Funds paid",
            basis: t("funds_kpi_basis_disbursed", {
              pct: Math.round(isun.absorptionPctOfContracted),
            }),
            to: "/funds/absorption",
          },
        ]
      : []),
    ...(cr
      ? [
          {
            value: numFmt.format(cr.mpCount),
            label: t("funds_index_mp_tied") || "MP-connected",
            // Names the DENOMINATOR — how many companies those MPs are tied to and for how
            // much — rather than restating the label. „148 депутати" under „Свързани с НП"
            // said the same thing twice.
            basis: t("funds_kpi_basis_mps", {
              companies: numFmt.format(cr.beneficiaryCount),
              eur: formatEurCompact(cr.contractedEur, lang),
            }),
            to: "/funds/political",
          },
        ]
      : []),
  ];
};
