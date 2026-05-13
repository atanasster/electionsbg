// /company/:eik — single contractor detail page. EIK-keyed (not slug),
// distinct from the existing /mp/company/:slug page which is built off the
// MP-declarations connection graph. The two cross-link.
//
// Layout mirrors the home / /procurement dashboard: <Title> + section + a
// top row of 4 stat cards, then stacked tiles (MP linkages, by-year, top
// awarders, contracts list).

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Receipt,
  ExternalLink,
  Coins,
  Building2,
  Users,
  FileText,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useContractor } from "@/data/procurement/useContractor";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";
import { formatTotalAsEur } from "./components/candidates/procurement/formatAmount";
import { summarizeRelations } from "./components/candidates/procurement/relationLabel";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { CompanyTopContractsTile } from "./components/procurement/CompanyTopContractsTile";
import { CompanyTopAwardersTile } from "./components/procurement/CompanyTopAwardersTile";
import { CompanyByYearChart } from "./components/procurement/CompanyByYearChart";
import { ErrorSection } from "./components/ErrorSection";

const numFmt = new Intl.NumberFormat("bg-BG");

// Reverse lookup for "is this EIK MP-tied, and which MPs?" — reuses the
// fetch that's already cached by useMpConnectedContracts on other screens.
const useMpConnectedForEik = (eik?: string) => {
  const q = useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: async () => {
      const r = await fetch(dataUrl("/procurement/derived/mp_connected.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as ProcurementMpConnectedFile;
    },
    staleTime: Infinity,
  });
  void useMpConnectedContracts; // import is intentional for cache sharing
  if (!eik || !q.data) return { entries: [], isLoading: q.isLoading };
  return {
    entries: q.data.entries.filter((e) => e.contractorEik === eik),
    isLoading: false,
  };
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[140px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

export const CompanyByEikScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t } = useTranslation();
  const { data: c, isLoading } = useContractor(eik);
  const { entries: mpLinks } = useMpConnectedForEik(eik);

  if (isLoading) {
    return (
      <>
        <Title description="Procurement contractor detail">
          {t("company_loading_title") || "Company"}
        </Title>
        <section aria-label="company" className="my-4">
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
  if (!c) {
    return (
      <ErrorSection
        title={t("company_not_found_title") || "Company not found"}
        description={
          t("company_not_found_desc") ||
          "No procurement-contract data is recorded for this EIK. The company may not have won a contract during the ingested period, or the EIK is incorrect."
        }
      />
    );
  }

  return (
    <>
      <Title description={`Public-procurement contracts awarded to ${c.name}`}>
        {c.name}
      </Title>
      <section aria-label={c.name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          EIK {c.eik}
          {mpLinks.length > 0 ? (
            <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {t("company_mp_tag") || "MP-tied"}
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("company_total_awarded") || "Total awarded"}>
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-base md:text-lg font-bold tabular-nums break-words">
                {formatTotalAsEur(c.totalByCurrency) || "—"}
              </span>
            </div>
          </StatCard>
          <StatCard label={t("company_contracts") || "Contracts"}>
            <div className="flex items-baseline gap-2">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(c.contractCount)}
              </span>
            </div>
            {c.awardCount > 0 ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                + {numFmt.format(c.awardCount)}{" "}
                {t("company_awards") || "awards"}
              </div>
            ) : null}
          </StatCard>
          <StatCard label={t("company_awarders_count") || "Awarders"}>
            <div className="flex items-baseline gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(c.byAwarder.length)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("company_awarders_hint") || "Distinct buyers in this corpus"}
            </div>
          </StatCard>
          <StatCard
            label={t("company_mp_linked") || "MP linked"}
            className={
              mpLinks.length > 0
                ? "ring-1 ring-amber-200/60 dark:ring-amber-800/40"
                : undefined
            }
          >
            <div className="flex items-baseline gap-2">
              <Users
                className={`h-5 w-5 shrink-0 ${mpLinks.length > 0 ? "text-amber-600" : "text-muted-foreground"}`}
              />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(mpLinks.length)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("procurement_index_mp_count") || "MPs"}
              </span>
            </div>
            {mpLinks.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                {t("company_no_mp_links") || "No MP linkages on record"}
              </div>
            ) : null}
          </StatCard>
        </div>

        {mpLinks.length > 0 ? (
          <Card className="my-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-amber-600" />
                {t("company_mp_links") || "MP linkages"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="text-sm space-y-1.5">
                {mpLinks.map((e) => (
                  <li
                    key={e.mpId}
                    className="flex items-center gap-2 flex-wrap"
                  >
                    <Link
                      to={`/candidate/mp-${e.mpId}`}
                      className="font-medium hover:underline inline-flex items-center gap-2"
                    >
                      <MpAvatar mpId={e.mpId} name={e.mpName} />
                      {e.mpName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      — {summarizeRelations(t, e.relations)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* 2-col grid on xl: top contracts + top awarders side-by-side. */}
        <div className="grid gap-4 xl:grid-cols-2 my-4">
          <CompanyTopContractsTile eik={c.eik} />
          {c.byAwarder.length > 0 ? (
            <CompanyTopAwardersTile eik={c.eik} rollup={c} />
          ) : null}
        </div>

        {c.byYear.length > 0 ? <CompanyByYearChart rows={c.byYear} /> : null}

        <p className="text-[11px] text-muted-foreground/80 mt-4">
          {t("company_source_hint") || "Source: data.egov.bg (АОП OCDS)."}{" "}
          <a
            href="https://data.egov.bg/organisation/about/aop"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            data.egov.bg <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>
    </>
  );
};
