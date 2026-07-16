// /funds — EU-funds (ИСУН) landing dashboard. Reorganised to match the home
// page's section pattern: a hero strip (clickable KPIs + map), then themed
// sections that drill into the deeper /funds/{political,integrity,rrf,
// focus} pages. The map is promoted to the hero, the legacy
// "MP-connected" card is dropped (duplicated by /funds/political), and the
// breakdown table is collapsed into a single-row strip of chips.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Building2,
  Coins,
  ExternalLink,
  Gauge,
  Layers,
  Map,
  PiggyBank,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent } from "@/ux/Card";
import { useFundsIndex } from "@/data/funds/useFundsIndex";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { ProjectsStatusMixTile } from "./funds/ProjectsStatusMixTile";
import { TopProgramsTile } from "./funds/TopProgramsTile";
import { GeographyMixTile } from "./funds/GeographyMixTile";
import { FundsMuniMapTile } from "./funds/FundsMuniMapTile";
import { PoliticalConflictsTile } from "./funds/PoliticalConflictsTile";
import { AbsorptionByPeriodTile } from "./funds/AbsorptionByPeriodTile";
import { FundsSankeyTile } from "./funds/FundsSankeyTile";
import { IntegrityTeaserTile } from "./funds/IntegrityTeaserTile";
import { FundsFocusTile } from "./funds/FundsFocusTile";
import { RrfTeaserTile } from "./funds/RrfTeaserTile";
import { DualCorpusLeaderboardTile } from "./funds/DualCorpusLeaderboardTile";
import { DashboardSection } from "./dashboard/DashboardSection";
import { orgFormLabel, orgTypeLabel } from "@/data/funds/orgLabels";
import { formatEur } from "@/lib/currency";
import type { FundsBreakdownRow, FundsTopRow } from "@/data/funds/types";

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
const BreakdownStrip: FC<{
  byOrgType: FundsBreakdownRow[];
  byOrgForm: FundsBreakdownRow[];
}> = ({ byOrgType, byOrgForm }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const topTypes = byOrgType.slice(0, 4);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-2 p-3 text-xs md:p-4">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {t("funds_breakdown_by_type") || "By organisation type"}
        </span>
        {topTypes.map((r) => (
          <span
            key={r.key}
            className="inline-flex items-baseline gap-1 rounded-full border bg-muted/40 px-2 py-0.5"
          >
            <span className="font-medium">{orgTypeLabel(r.key, lang)}</span>
            <span className="tabular-nums">{formatEur(r.contractedEur)}</span>
            <span className="text-muted-foreground tabular-nums">
              ({numFmt.format(r.beneficiaries)})
            </span>
          </span>
        ))}
        <span className="ml-auto text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">
            {t("funds_breakdown_by_form") || "By legal form"}
          </span>{" "}
          {byOrgForm
            .map(
              (r) =>
                `${orgFormLabel(r.key, lang)} ${formatEur(r.contractedEur)}`,
            )
            .join(" · ")}
        </span>
      </CardContent>
    </Card>
  );
};

const TopBeneficiariesCard: FC<{ rows: FundsTopRow[] }> = ({ rows }) => {
  const { t, i18n } = useTranslation();
  const visible = rows.slice(0, 15);
  return (
    <Card>
      <CardContent className="p-3 md:p-4 text-sm">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((r, i) => (
            <li
              key={r.eik ?? `${r.name}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              {r.eik ? (
                <Link
                  to={`/company/${r.eik}`}
                  className="font-medium hover:underline"
                >
                  {r.name}
                </Link>
              ) : (
                <span className="font-medium">{r.name}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {orgTypeLabel(r.orgType, i18n.language)}
              </span>
              {r.mpTied ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {t("funds_mp_badge") || "MP-connected"}
                </span>
              ) : null}
              <span className="ml-auto text-sm font-medium tabular-nums">
                {formatEur(r.contractedEur)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

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

export const FundsScreen: FC = () => {
  const { t } = useTranslation();
  const { data: index, isLoading } = useFundsIndex();
  const { data: projectsIndex } = useFundsProjectsIndex();

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
      <section aria-label={title} className="my-4">
        <p className="mb-4 text-sm text-muted-foreground">
          {t("funds_index_intro") ||
            "Every organisation that has signed an EU-funds contract recorded in ИСУН 2020 — the 2014-2020 and 2021-2027 programmes plus the Recovery Plan."}
        </p>

        {/* HERO: 4 clickable KPI cards then the choropleth map. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiLink
            to="#top-beneficiaries"
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
            to="#money-flow"
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
            to="#absorption"
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

        {/* Map — promoted to hero position right under the KPI strip. */}
        {projectsIndex ? (
          <div className="mt-4">
            <FundsMuniMapTile />
          </div>
        ) : null}

        {/* Compact by-type / by-form strip. */}
        <div className="mt-4">
          <BreakdownStrip
            byOrgType={index.byOrgType}
            byOrgForm={index.byOrgForm}
          />
        </div>

        {/* Spending: absorption + money flow. */}
        {projectsIndex ? (
          <DashboardSection
            id="funds"
            title={t("funds_section_spending") || "Spending over time"}
            icon={Gauge}
          >
            <div id="absorption" className="scroll-mt-20">
              <AbsorptionByPeriodTile />
            </div>
            <div id="money-flow" className="scroll-mt-20">
              <FundsSankeyTile />
            </div>
          </DashboardSection>
        ) : null}

        {/* Recovery Plan — its own section because it's a separate envelope. */}
        <DashboardSection
          id="finances"
          title={t("funds_section_rrf") || "Recovery & Resilience Plan"}
          icon={PiggyBank}
        >
          <RrfTeaserTile />
        </DashboardSection>

        {/* Red flags — political-economy + concentration. */}
        <DashboardSection
          id="funds"
          title={t("funds_section_red_flags") || "Red flags"}
          icon={ShieldAlert}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <PoliticalConflictsTile />
            <IntegrityTeaserTile />
          </div>
        </DashboardSection>

        {/* Editorial focus stories. */}
        <DashboardSection
          id="funds"
          title={t("funds_section_focus") || "Focus stories"}
          icon={AlertTriangle}
        >
          <FundsFocusTile />
        </DashboardSection>

        {/* Cross-corpus: firms that both won ЗОП contracts and drew EU grants.
            Independent of projectsIndex (its own DB hook), so it renders even if
            the projects index is still loading. */}
        <DashboardSection
          id="funds"
          title={t("dual_corpus_title") || "Договори и грантове"}
          subtitle={
            t("dual_corpus_subtitle") ||
            "Фирми, спечелили обществени поръчки и получили европейски средства."
          }
          icon={Layers}
        >
          <DualCorpusLeaderboardTile />
        </DashboardSection>

        {/* Leaderboards — top beneficiaries + top programmes side by side. */}
        {projectsIndex ? (
          <DashboardSection
            id="funds"
            title={t("funds_section_leaderboards") || "Leaderboards"}
            icon={Layers}
          >
            <div id="top-beneficiaries" className="scroll-mt-20">
              <TopBeneficiariesCard rows={index.topByContracted} />
            </div>
            <TopProgramsTile index={projectsIndex} />
          </DashboardSection>
        ) : null}

        {/* Details: status + geography mix (kept low because they're niche). */}
        {projectsIndex ? (
          <DashboardSection
            id="funds"
            title={t("funds_section_details") || "Details"}
            icon={Map}
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <ProjectsStatusMixTile index={projectsIndex} />
              <GeographyMixTile index={projectsIndex} />
            </div>
          </DashboardSection>
        ) : null}

        <SourceFooter />
      </section>
    </>
  );
};
