// /company/:eik — single company detail page. EIK-keyed (not slug),
// distinct from the existing /mp/company/:slug page which is built off the
// MP-declarations connection graph. The two cross-link.
//
// Unifies two public registers: the public-procurement (АОП) contracts
// awarded to the company AND its EU-funds (ИСУН) beneficiary record. A
// company present in only one of the two still gets a full page — a pure
// EU-funds beneficiary with no procurement contracts is no longer a
// dead-end "company not found".
//
// Layout mirrors the home / /procurement dashboard: <Title> + section + a
// top row of 4 stat cards, then stacked tiles (MP linkages, by-year, top
// awarders, contracts list, EU-funds).

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
  Euro,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useContractor } from "@/data/procurement/useContractor";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { useFundsBeneficiary } from "@/data/funds/useFundsBeneficiary";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";
import type { FundsBeneficiary } from "@/data/funds/types";
import { formatEur, formatEurWithOther } from "@/lib/currency";
import { orgTypeLabel } from "@/data/funds/orgLabels";
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

// EU-funds (ИСУН) beneficiary card. Rendered whenever the EIK appears in the
// ИСУН register — both as a section alongside the procurement view and, for
// a funds-only company, as the substantive content of the page. `standalone`
// adds the explanatory note for the latter case.
const EuFundsCard: FC<{ funds: FundsBeneficiary; standalone: boolean }> = ({
  funds,
  standalone,
}) => {
  const { t, i18n } = useTranslation();
  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Euro className="h-4 w-4 text-muted-foreground" />
          {t("company_funds_title") || "EU funds (ИСУН)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {standalone ? (
          <p className="text-sm text-muted-foreground">
            {t("company_funds_only_note") ||
              "No public-procurement (АОП) contracts are recorded for this EIK. The figures below are from the ИСУН 2020 EU-funds beneficiary register."}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">
              {t("funds_index_contracted") || "Contracted funds"}
            </div>
            <div className="font-semibold tabular-nums">
              {formatEur(funds.contractedEur)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("funds_index_paid") || "Paid funds"}
            </div>
            <div className="font-semibold tabular-nums">
              {formatEur(funds.paidEur)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("company_funds_contracts") || "EU-funds contracts"}
            </div>
            <div className="font-semibold tabular-nums">
              {numFmt.format(funds.contractCount)}
            </div>
          </div>
          {funds.orgType ? (
            <div>
              <div className="text-xs text-muted-foreground">
                {t("company_funds_org_type") || "Organisation type"}
              </div>
              <div className="font-semibold">
                {orgTypeLabel(funds.orgType, i18n.language)}
              </div>
            </div>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {t("funds_contracted_note") ||
            '"Contracted funds" is the total contracted project value per ИСУН — for some programmes it includes the beneficiary’s own co-financing, not only the EU grant.'}
        </p>
        <Link
          to="/funds"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("company_funds_view") || "Open the EU-funds explorer"}
        </Link>
      </CardContent>
    </Card>
  );
};

export const CompanyByEikScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data: c, isLoading: procLoading } = useContractor(eik);
  const { beneficiary: funds, isLoading: fundsLoading } =
    useFundsBeneficiary(eik);
  const { entries: mpLinks } = useMpConnectedForEik(eik);
  const isLoading = procLoading || fundsLoading;

  if (isLoading) {
    return (
      <>
        <Title description="Company public-register detail">
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
  if (!c && !funds) {
    return (
      <ErrorSection
        title={t("company_not_found_title") || "Company not found"}
        description={
          t("company_not_found_desc") ||
          "No public-procurement or EU-funds data is recorded for this EIK. The company may not have signed a contract during the ingested period, or the EIK is incorrect."
        }
      />
    );
  }

  const displayName = c?.name ?? funds?.name ?? `ЕИК ${eik ?? ""}`;

  return (
    <>
      <Title description={`Public-register detail for ${displayName}`}>
        {displayName}
      </Title>
      <section aria-label={displayName} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          EIK {eik}
          {mpLinks.length > 0 ? (
            <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {t("company_mp_tag") || "MP-tied"}
            </span>
          ) : null}
        </div>

        {c ? (
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={t("company_total_awarded") || "Total awarded"}>
                <div className="flex items-baseline gap-2">
                  <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
                  <span className="text-base md:text-lg font-bold tabular-nums break-words">
                    {formatEurWithOther(
                      c.totalEur,
                      c.totalOther,
                      i18n.language,
                    ) || "—"}
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
                  {t("company_awarders_hint") ||
                    "Distinct buyers in this corpus"}
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

            {c.byYear.length > 0 ? (
              <CompanyByYearChart rows={c.byYear} />
            ) : null}

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
          </>
        ) : null}

        {funds ? <EuFundsCard funds={funds} standalone={!c} /> : null}
      </section>
    </>
  );
};
