// /procurement — public-procurement landing page. By default scoped to the
// selected election (NS): stats + top contractors/awarders/MPs reflect just
// that parliament's term. A "Покажи всички години" toggle pivots to the
// full-corpus view (every year 2011-2026).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Receipt, Users, Building2, Coins } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { useProcurementOverview } from "@/data/procurement/useProcurementOverview";
import { ProcurementFlowTile } from "./components/procurement/ProcurementFlowTile";
import { WatchlistDigestTile } from "./components/procurement/WatchlistDigestTile";
import { ProcurementSectionHeader } from "./components/procurement/ProcurementSectionHeader";
import { CompanySearchTile } from "./components/procurement/CompanySearchTile";
import { TopContractorsTile } from "./components/procurement/TopContractorsTile";
import { TopAwardersTile } from "./components/procurement/TopAwardersTile";
import { TopMpsTile } from "./components/procurement/TopMpsTile";
import { TopOfficialsTile } from "./components/procurement/TopOfficialsTile";
import { ProcurementTreemapTile } from "./components/procurement/ProcurementTreemapTile";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[140px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const ProcurementScreen: FC = () => {
  const { t } = useTranslation();
  // Scope is section-wide and URL-encoded (?pscope) so it's shareable and
  // survives navigation to the sub-pages. Default "ns" → scoped to the selected
  // election window; "all" pivots to the full corpus. Both are one DB query.
  const { data, isLoading, all } = useProcurementOverview();
  const title = t("procurement_index_title") || "Public procurement";

  if (isLoading) {
    return (
      <>
        <Title description="Aggregated public-procurement contracts from data.egov.bg">
          {title}
        </Title>
        <section aria-label={title} className="my-4">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </>
    );
  }

  // No contracts fall in this election's window (e.g. an election with an empty
  // contract range) — hint + the scope toggle to pivot to the full corpus.
  if (!data || data.totals.contracts === 0) {
    return (
      <>
        <Title description="Aggregated public-procurement contracts from data.egov.bg">
          {title}
        </Title>
        <ProcurementSectionHeader scopeMode="toggle" />
        <section aria-label={title} className="my-4">
          <p className="text-sm text-muted-foreground mt-4">
            {t("procurement_index_no_ns_data") ||
              "No procurement data falls within this election's date range."}
          </p>
        </section>
      </>
    );
  }

  const totals = data.totals;
  return (
    <>
      <Title description="Aggregated public-procurement contracts from data.egov.bg">
        {title}
      </Title>
      <ProcurementSectionHeader scopeMode="toggle" />
      <section aria-label={title} className="my-4">
        <p className="text-xs text-muted-foreground mb-1">
          {all ? (
            t("procurement_scope_all") || "Showing the full corpus, all years."
          ) : (
            <>
              {t("procurement_scope_ns") ||
                "Showing contracts during the selected parliament:"}{" "}
              <strong className="text-foreground tabular-nums">
                {data.start}
                {data.end ? ` → ${data.end}` : " → …"}
              </strong>
            </>
          )}
        </p>

        <CompanySearchTile />

        <div
          className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-4"
          data-og="procurement-stats"
        >
          <StatCard
            label={t("procurement_index_contracts") || "Contracts"}
            hint={
              t("procurement_index_contracts_hint") ||
              "Signed contracts + amendments within this election's period."
            }
          >
            <div className="flex items-baseline gap-2">
              <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(totals.contracts + totals.amendments)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {numFmt.format(totals.contracts)}{" "}
              {t("procurement_index_contracts_main") || "primary contracts"} +{" "}
              {numFmt.format(totals.amendments)}{" "}
              {t("procurement_index_amendments_full") ||
                "supplementary agreements (amendments)"}
            </div>
          </StatCard>

          <StatCard
            label={t("procurement_index_total_awarded") || "Total awarded"}
            hint={t("procurement_index_total_hint") || ""}
          >
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl lg:text-xl xl:text-2xl font-bold tabular-nums break-words">
                {formatEur(totals.totalEur)}
              </span>
            </div>
          </StatCard>

          <StatCard
            label={t("procurement_index_contractors") || "Contractors"}
            hint={
              t("procurement_index_contractors_hint") ||
              "Distinct companies that won at least one contract in the period."
            }
          >
            <div className="flex items-baseline gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(totals.contractorCount)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {t("procurement_index_contractors_from") || "from"}{" "}
              {numFmt.format(totals.awarderCount)}{" "}
              {t("procurement_index_state_awarders") || "state awarders"}
            </div>
          </StatCard>

          <StatCard
            label={t("procurement_index_connected") || "Connected people"}
            hint={
              t("procurement_index_connected_hint") ||
              "MPs and public officials (cabinet, regional governors, mayors, councillors…) whose declared business interests intersect with contract winners during this period."
            }
            className="ring-1 ring-amber-200/60 dark:ring-amber-800/40"
          >
            <div className="flex items-baseline gap-2">
              <Users className="h-5 w-5 text-amber-600 shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(
                  (totals.mpCount ?? 0) + (totals.officialCount ?? 0),
                )}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("procurement_index_connected_people") || "people"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {numFmt.format(totals.mpCount ?? 0)}{" "}
              {t("procurement_index_mp_count_short") || "MPs"} ·{" "}
              {numFmt.format(totals.officialCount ?? 0)}{" "}
              {t("procurement_index_officials_count") || "officials"}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {numFmt.format(totals.connectedContractorCount ?? 0)}{" "}
              {t("procurement_index_mp_companies") || "companies"}
            </div>
            <div className="text-xs font-medium tabular-nums">
              {formatEur(totals.connectedTotalEur ?? 0)}
            </div>
          </StatCard>
        </div>

        <WatchlistDigestTile />
        <ProcurementFlowTile />
        {/* Treemap overview: largest contractors / largest awarders, each
            tile sized by total euro value. Sits above the ranked tables. */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ProcurementTreemapTile
            entity="contractor"
            items={data.topContractors}
          />
          <ProcurementTreemapTile entity="awarder" items={data.topAwarders} />
        </div>
        {/* 2-col grid on xl+ screens so top contractors / awarders / MPs
            sit side-by-side. On narrower viewports they stack. */}
        <div className="grid gap-4 xl:grid-cols-2">
          <TopContractorsTile byNs={data} />
          <TopAwardersTile data={data} />
          <div className="xl:col-span-2">
            <TopMpsTile data={data} />
          </div>
          <div className="xl:col-span-2">
            <TopOfficialsTile data={data} />
          </div>
        </div>

        <SourceFooter t={t} />
      </section>
    </>
  );
};

const SourceFooter: FC<{ t: (k: string) => string }> = ({ t }) => (
  <p className="text-[11px] text-muted-foreground/80 mt-4">
    {t("procurement_index_source_hint") ||
      "Source: data.egov.bg (АОП OCDS, fortnightly bundles)."}{" "}
    <a
      href="https://data.egov.bg/organisation/about/aop"
      target="_blank"
      rel="noreferrer"
      className="text-primary hover:underline inline-flex items-center gap-0.5"
    >
      data.egov.bg <ExternalLink className="h-3 w-3" />
    </a>
  </p>
);
