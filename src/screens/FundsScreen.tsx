// /funds — EU-funds (ИСУН) landing dashboard. Reorganised to match the home
// page's section pattern: a hero strip (clickable KPIs + map), then themed
// sections that drill into the deeper /funds/{political,integrity,rrf,
// focus} pages. The map is promoted to the hero, the legacy
// "MP-connected" card is dropped (duplicated by /funds/political), and the
// breakdown table is collapsed into a single-row strip of chips.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Banknote, Building2, Coins, ExternalLink, Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import { FundsFinder } from "./funds/FundsFinder";
import { OpenCallsTile } from "./funds/OpenCallsTile";
import { FitResolverTile } from "./funds/FitResolverTile";
import { FundsWireLine, FundsNewsRail } from "./funds/FundsWire";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { TileHubGrid, type TileHubSection } from "@/ux/infographic";
import { FUNDS_BANDS } from "./funds/fundsRegistry";
import { FUNDS_SCENES } from "./funds/fundsScenes";
import {
  useFundsHubStats,
  type FundsHubStats,
} from "@/data/funds/useFundsHubStats";
import { formatEur, formatInt } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

// KPI strip — each card links to its drilldown. We render the underlying
// StatCard (visual) inside a Link so the whole tile reads as clickable.
const KpiLink: FC<{
  to: string;
  ariaLabel: string;
  children: React.ReactNode;
}> = ({ to, ariaLabel, children }) => (
  <Link
    to={to}
    aria-label={ariaLabel}
    className="group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
  >
    {children}
  </Link>
);

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
const tileMetric = (
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
      // The REGISTER count — what /funds/beneficiaries ranks.
      return m(int(s.tiles.registerBeneficiaries), t("funds_m_orgs"));
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

export const FundsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: index, isLoading } = useFundsIndex();
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

  if (isLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section aria-label={title} className="my-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </>
    );
  }

  if (!index) return null;

  const { totals } = index;
  const cr = index.crossReference;
  const absorption =
    totals.contractedEur > 0
      ? Math.round((totals.paidEur / totals.contractedEur) * 100)
      : 0;
  const eikPct =
    totals.beneficiaries > 0
      ? Math.round((totals.withEik / totals.beneficiaries) * 100)
      : 0;

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-4 text-sm text-muted-foreground">
          {t("funds_index_intro") ||
            "Every organisation that has signed an EU-funds contract recorded in ИСУН 2020 — the 2014-2020 and 2021-2027 programmes plus the Recovery Plan."}
        </p>

        {/* LOOK-UP BEFORE READ. The finder sits above the KPI strip deliberately: most
            arrivals want to find a thing (their company, their town, a contract), and an
            aggregate is a destination you reach AFTER the look-up, not an entry point. The
            KPI strip below used to be the first thing on the page — that ordering is what
            docs/plans/funds-module-v2.md §5.2 calls out as analysis-first. */}
        {/* BAND 0 — the wire. One line, above everything, because a returning reader's first
            question is „did anything happen". It renders nothing on a failure: a wire is itself
            a claim that the page is current. */}
        <FundsWireLine className="mb-3" />

        <FundsFinder className="mb-4" />

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

        {/* HERO: 4 clickable KPI cards then the choropleth map. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* PAGES, not fragments. These three used to target #top-beneficiaries, #money-flow
              and #absorption — sections this rework moved onto their own pages, so all three
              cards silently did nothing when clicked. A same-page anchor is exactly the link
              that rots when a hub is reorganised.

              THE STRIP AND THE GRID NOW OVERLAP, and that is a deliberate trade rather than an
              oversight: this card and the „Бенефициенти" tile a screen below read the same
              `fund_payloads` field, so they cannot disagree. The strip is the corpus at a
              glance, the tile is a destination — the duplication is one number, and removing
              the card would leave the strip with a hole where the module's headline count goes.
              Worth revisiting if the strip grows. */}
          <KpiLink
            to="/funds/beneficiaries"
            ariaLabel={t("funds_index_beneficiaries") || "Beneficiaries"}
          >
            <StatCard
              label={t("funds_index_beneficiaries") || "Beneficiaries"}
              hint={
                t("funds_index_beneficiaries_hint") ||
                "Distinct organisations with at least one EU-funds contract."
              }
              className="h-full transition-shadow group-hover:shadow-md"
            >
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {numFmt.format(totals.beneficiaries)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {numFmt.format(totals.contractCount)}{" "}
                {t("funds_index_contracts") || "contracts"} · {eikPct}%{" "}
                {t("funds_index_with_eik") || "with EIK"}
              </div>
            </StatCard>
          </KpiLink>

          <KpiLink
            to="/funds/absorption"
            ariaLabel={t("funds_index_contracted") || "Funds contracted"}
          >
            <StatCard
              label={t("funds_index_contracted") || "Funds contracted"}
              hint={
                t("funds_index_contracted_hint") ||
                "Total value of signed EU-funds contracts (Договорени средства)."
              }
              className="h-full transition-shadow group-hover:shadow-md"
            >
              <div className="flex items-baseline gap-2">
                <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="break-words text-base font-bold tabular-nums md:text-lg">
                  {formatEur(totals.contractedEur)}
                </span>
              </div>
            </StatCard>
          </KpiLink>

          <KpiLink
            to="/funds/absorption"
            ariaLabel={t("funds_index_paid") || "Funds paid"}
          >
            <StatCard
              label={t("funds_index_paid") || "Funds paid"}
              hint={
                t("funds_index_paid_hint") ||
                "Total actually disbursed to beneficiaries (Реално изплатени суми)."
              }
              className="h-full transition-shadow group-hover:shadow-md"
            >
              <div className="flex items-baseline gap-2">
                <Banknote className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="break-words text-base font-bold tabular-nums md:text-lg">
                  {formatEur(totals.paidEur)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {absorption}% {t("funds_index_disbursed") || "of contracted"}
              </div>
            </StatCard>
          </KpiLink>

          <KpiLink
            to="/funds/political"
            ariaLabel={t("funds_index_mp_tied") || "MP-connected"}
          >
            <StatCard
              label={t("funds_index_mp_tied") || "MP-connected"}
              hint={
                t("funds_index_mp_hint") ||
                "MPs whose declared business interests intersect EU-funds beneficiaries."
              }
              className="h-full ring-1 ring-amber-200/60 transition-shadow dark:ring-amber-800/40 group-hover:shadow-md"
            >
              <div className="flex items-baseline gap-2">
                <Users className="h-5 w-5 shrink-0 text-amber-600" />
                <span className="text-2xl font-bold tabular-nums">
                  {cr ? numFmt.format(cr.mpCount) : "—"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("funds_index_mp_count") || "MPs"}
                </span>
              </div>
              {cr ? (
                <>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {numFmt.format(cr.beneficiaryCount)}{" "}
                    {t("funds_index_mp_companies") || "companies"}
                  </div>
                  <div className="text-xs font-medium tabular-nums">
                    {formatEur(cr.contractedEur)}
                  </div>
                </>
              ) : null}
            </StatCard>
          </KpiLink>
        </div>

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
