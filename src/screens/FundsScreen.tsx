// /funds — EU-funds (ИСУН) landing dashboard. Reorganised to match the home
// page's section pattern: a hero strip (clickable KPIs + map), then themed
// sections that drill into the deeper /funds/{political,integrity,rrf,
// focus} pages. The map is promoted to the hero, the legacy
// "MP-connected" card is dropped (duplicated by /funds/political), and the
// breakdown table is collapsed into a single-row strip of chips.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import type { FundsIndexFile } from "@/data/funds/types";
import { FundsFinder } from "./funds/FundsFinder";
import { OpenCallsTile } from "./funds/OpenCallsTile";
import { FitResolverTile } from "./funds/FitResolverTile";
import { FundsWireLine, FundsNewsRail } from "./funds/FundsWire";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import {
  HubHead,
  TileHubGrid,
  type HubKpi,
  type TileHubSection,
} from "@/ux/infographic";
import { FUNDS_BANDS } from "./funds/fundsRegistry";
import { FUNDS_SCENES } from "./funds/fundsScenes";
import {
  useFundsHubStats,
  type FundsHubStats,
} from "@/data/funds/useFundsHubStats";
import { formatEur, formatEurCompact, formatInt } from "@/lib/currency";

// Compact one-row breakdown strip — chips for the largest by-type buckets
// plus a trailing "by legal form" mini-summary. Replaces the tall two-axis
// table that previously dominated the page.
const SourceFooter: FC = () => {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-[11px] text-muted-foreground/80">
      {t("funds_index_source_hint") ||
        "Source: ИСУН 2020 public beneficiary register."}{" "}
      <a
        href="https://2020.eufunds.bg/bg/0/0/Beneficiary"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 text-primary hover:underline"
      >
        2020.eufunds.bg <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
};

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

/** The head's search slot: the wire line over the finder.
 *
 *  Written ONCE, so `hub_finder_single_render.test.ts` — a SOURCE scan counting
 *  `<FundsFinder />` — cannot be defeated by a second copy in a loading branch.
 */
const FundsHeadSearch: FC = () => (
  <>
    <FundsWireLine className="mb-3" />
    <FundsFinder />
  </>
);

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

export const FundsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: index } = useFundsIndex();
  const { data: hubStats } = useFundsHubStats();

  // The tile grid. Metrics come from ONE fetch (migration 145), and each is read from the same
  // payload its DESTINATION renders — so a tile cannot announce a figure the page it links to
  // disagrees with. A tile whose figure is absent renders without one rather than showing 0.
  const sections: TileHubSection[] = useMemo(
    () =>
      FUNDS_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tiles.map((tile) => ({
          to: tile.to,
          title: t(tile.titleKey),
          desc: t(tile.descKey),
          accent: tile.accent,
          scene: FUNDS_SCENES[tile.id],
          // NO `cta`. „разгледай →" on every tile restates an affordance the card already has.
          ...(tileMetric(tile.id, hubStats, i18n.language, t) ?? {}),
        })),
      })),
    [t, hubStats, i18n.language],
  );

  const title = t("funds_index_title") || "EU funds";
  const description =
    "EU-funds beneficiaries from the ИСУН 2020 public register — funds contracted and paid, the political-economy cross-reference, and per-programme concentration metrics.";

  /* ONE HEAD, ONE RETURN. This screen used to early-return a whole second page shape for the
     loading state, which duplicated the identity and — because it returned — suppressed five
     modules that need no payload at all: the open calls, the fit resolver, the news rail, the
     tile grid and the source footer. A reader on a cold load saw four grey boxes where an
     entire page could already have rendered. The band is the ONLY part that waits, and
     `kpisPending` stands its own cells in its own slot until `index` lands. */
  const kpis = kpisFor(index, hubStats, i18n.language, t);

  return (
    <>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        className="mt-5"
      />
      <section aria-label={title}>
        {/* THE FOUR CORPUS FIGURES USED TO SIT AT ~2 600 px, below the wire, the finder, the
            open calls, the resolver and the news rail — on a page whose tile grid started at
            2 846 px. This hub was the extreme case in docs/plans/hub-hero-v1.md 2.1: nothing on
            it made a corpus-level statement until a reader had scrolled three screens.

            LOOK-UP STILL COMES BEFORE READ. The finder sits INSIDE the head, above the band, so
            the ordering docs/plans/funds-module-v2.md 5.2 argued for is kept: an aggregate is
            where you arrive after a look-up, not an entry point. What changed is that the
            aggregate is now on the first screen instead of the fourth. */}
        <HubHead
          eyebrow={t("funds_head_eyebrow")}
          title={title}
          seoDescription={description}
          deck={t("funds_head_deck")}
          search={<FundsHeadSearch />}
          kpis={kpis}
          kpisPending={4}
        />

        {/* BAND 1, second half. The finder answers „намери нещо конкретно"; this answers
            „какво мога да подам сега" — the question ~68% of the measured demand actually asks.
            Both sit above the KPI strip, because an aggregate is where you arrive AFTER a
            look-up, not an entry point. */}
        <OpenCallsTile />

        {/* BAND 1, third module. The finder answers „намери нещо конкретно"; the tile above
            answers „какво мога да подам сега"; this answers the question that comes BEFORE both
            and is the one most readers actually arrive with — „има ли изобщо нещо за мен".
            It sits after the open calls because a live deadline outranks a base rate: if
            something is open now, that is the more actionable fact. */}
        <FitResolverTile />

        {/* BAND 2 — the news rail, after the two band-1 lead modules and before the „кой получи
            парите" band. What is open and whether anything like mine was funded both outrank
            what merely changed. */}
        <FundsNewsRail />

        {/* THE MAP, THE BREAKDOWN STRIP AND THE „Кой получи парите" BAND ARE GONE FROM HERE.
            All five tiles they held now live on /funds/places, /funds/beneficiaries and
            /funds/programmes, and the grid below fronts them. The map was the single heaviest
            thing on this page — Leaflet plus a nation-wide GeoJSON plus a per-municipality
            payload — rendered to draw a preview nobody had asked for yet. */}

        {/* ── THE TILE GRID ────────────────────────────────────────────────────────────────
            Bands 2-4 used to render fourteen analysis tiles inline. Measured before this
            rework: /funds was 10 098 px tall and fetched 390 KB across 8 requests, of which
            /api/db/dual-corpus-rankings alone was 247 KB — 63% of the page, pulled to draw a
            preview leaderboard. Each of those tiles now lives on its own page and the hub
            fronts it, per the dashboard-hub pattern.

            Band 1 stays LIVE above this grid: /parliament keeps a lead card and a news rail
            around its own grid too, and funds-module-v2 measured that ~68% of this audience
            arrives asking „can I get money" — which band 1 answers. Band 5 („За теб") was
            removed on 2026-08-09; /funds/places is the place question's home now. */}
        <TileHubGrid sections={sections} className="mt-6 sm:mt-8" />

        <SourceFooter />
      </section>
    </>
  );
};
