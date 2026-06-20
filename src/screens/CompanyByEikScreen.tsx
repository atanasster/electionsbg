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
  Newspaper,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useContractor } from "@/data/procurement/useContractor";
import { useAwarder } from "@/data/procurement/useAwarder";
import { useProcurementMpConnectedByEik } from "@/data/procurement/useMpConnectedByEik";
import { useFundsBeneficiary } from "@/data/funds/useFundsBeneficiary";
import { useFundsMpConnectedByEik } from "@/data/funds/useFundsMpConnectedByEik";
import { useFundsConfirmedCase } from "@/data/funds/useFundsConfirmed";
import { useCompanyConnections } from "@/data/parliament/useCompanyConnections";
import type {
  FundsBeneficiary,
  FundsMpConnected,
  FundsConfirmedCase,
} from "@/data/funds/types";
import { formatEur, formatEurWithOther } from "@/lib/currency";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import { summarizeRelations } from "./components/candidates/procurement/relationLabel";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { CompanyTopContractsTile } from "./components/procurement/CompanyTopContractsTile";
import { CompanyTopAwardersTile } from "./components/procurement/CompanyTopAwardersTile";
import { CompanyByYearChart } from "./components/procurement/CompanyByYearChart";
import { EntityFlowTile } from "./components/procurement/EntityFlowTile";
import { CompanyPortfolioTreemap } from "./components/procurement/CompanyPortfolioTreemap";
import { CompanyOfficialsTile } from "./components/procurement/CompanyOfficialsTile";
import { FollowButton } from "./components/procurement/FollowButton";
import { ErrorSection } from "./components/ErrorSection";
import { CompanyConnectionsSection } from "./components/connections/CompanyConnectionsSection";
import { PoliticalLinksCard } from "./components/funds/PoliticalLinksCard";

const numFmt = new Intl.NumberFormat("bg-BG");

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
const EuFundsCard: FC<{
  funds: FundsBeneficiary;
  standalone: boolean;
  mpLinks: FundsMpConnected[];
}> = ({ funds, standalone, mpLinks }) => {
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
        {mpLinks.length > 0 ? (
          <div className="space-y-1.5 rounded-md bg-amber-100/50 dark:bg-amber-900/20 p-2.5">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-500">
              {t("company_funds_mp_linked") || "Connected to an MP"}
            </div>
            <ul className="space-y-1.5">
              {mpLinks.map((e) => (
                <li
                  key={e.mpId}
                  className="flex items-center gap-2 flex-wrap text-sm"
                >
                  <Link
                    to={`/candidate/mp-${e.mpId}`}
                    className="font-medium hover:underline inline-flex items-center gap-2"
                  >
                    <MpAvatar mpId={e.mpId} name={e.mpName} />
                    {e.mpName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    — {summarizeFundsRelations(t, e.relations)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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

// Journalism cross-reference card. Shown when this company is one of the
// hand-curated cases in funds/confirmed.json — an investigation named it and
// the ИСУН register corroborates the grant. Narrative text is sourced
// verbatim from the (Bulgarian) journalism; the labels are translated.
const JournalismCard: FC<{ data: FundsConfirmedCase }> = ({ data }) => {
  const { t } = useTranslation();
  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          {t("company_journalism_title") || "In investigative journalism"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <p>
          <span className="font-medium">
            {t("company_journalism_connection") || "Reported connection"}:
          </span>{" "}
          {data.person}
        </p>
        <p className="text-muted-foreground">{data.claim.summary}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">
            {t("company_journalism_check") || "Our cross-check"}:
          </span>{" "}
          {data.verification}
        </p>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {t("company_journalism_sources") || "Sources"}
          </div>
          <ul className="space-y-1">
            {data.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {s.outlet} — {s.title}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export const CompanyByEikScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data: c, isLoading: procLoading } = useContractor(eik);
  // Awarder hook is here only for the display-name fallback chain — most
  // public institutions (Plovdiv municipality, etc) appear in the buyer
  // file rather than the supplier file, so without this an EIK that's
  // primarily an awarder would display under its noisy contractor name.
  const { data: aw } = useAwarder(eik);
  const { beneficiary: funds, isLoading: fundsLoading } =
    useFundsBeneficiary(eik);
  const { entries: mpLinks } = useProcurementMpConnectedByEik(eik);
  const { entries: fundsMpLinks } = useFundsMpConnectedByEik(eik);
  const { caseData: confirmedCase } = useFundsConfirmedCase(eik);
  const { connections, isLoading: connLoading } = useCompanyConnections(eik);
  const isLoading = procLoading || fundsLoading || connLoading;

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
  if (!c && !funds && !connections) {
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

  // Display-name fallback chain. We prefer the awarder name when the EIK
  // is primarily a buyer (state institutions) — those names come from
  // hundreds of contracts and are the most stable. The funds beneficiary
  // name is next (curated registry, sentence-cased). The procurement
  // contractor name lands last because the OCDS feed has occasional self-
  // deal rows that put a stray supplier name on a public-institution EIK
  // (see scripts/procurement/normalize.ts self-deal guard).
  const awarderIsPrimary = aw && c ? aw.contractCount >= c.contractCount : !!aw;
  const displayName =
    (awarderIsPrimary ? aw?.name : null) ??
    funds?.name ??
    c?.name ??
    aw?.name ??
    connections?.name ??
    `ЕИК ${eik ?? ""}`;

  return (
    <>
      <Title description={`Public-register detail for ${displayName}`}>
        {displayName}
      </Title>
      <section aria-label={displayName} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          EIK {eik}
          {mpLinks.length > 0 || fundsMpLinks.length > 0 ? (
            <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {t("company_mp_tag") || "MP-tied"}
            </span>
          ) : null}
          <span className="ml-auto">
            <FollowButton kind="company" id={eik ?? ""} label={displayName} />
          </span>
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

            <CompanyOfficialsTile eik={c.eik} />

            {/* 2-col grid on xl: top contracts + top awarders side-by-side. */}
            <div className="grid gap-4 xl:grid-cols-2 my-4">
              <CompanyTopContractsTile eik={c.eik} />
              {c.byAwarder.length > 0 ? (
                <CompanyTopAwardersTile eik={c.eik} rollup={c} />
              ) : null}
            </div>

            <EntityFlowTile
              role="contractor"
              centerEik={c.eik}
              centerName={c.name}
              counterparties={c.byAwarder.map((aw) => ({
                eik: aw.eik,
                name: aw.name,
                totalEur: aw.totalEur,
              }))}
              mpEdges={mpLinks.map((m) => ({
                contractorEik: c.eik,
                mpId: m.mpId,
                mpName: m.mpName,
                valueEur: c.totalEur,
              }))}
            />

            <CompanyPortfolioTreemap
              role="contractor"
              items={c.byAwarder.map((aw) => ({
                eik: aw.eik,
                name: aw.name,
                totalEur: aw.totalEur,
              }))}
            />

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

        <CompanyConnectionsSection eik={eik} />

        <PoliticalLinksCard eik={eik} />

        {funds ? (
          <EuFundsCard funds={funds} standalone={!c} mpLinks={fundsMpLinks} />
        ) : null}

        {confirmedCase ? <JournalismCard data={confirmedCase} /> : null}
      </section>
    </>
  );
};
