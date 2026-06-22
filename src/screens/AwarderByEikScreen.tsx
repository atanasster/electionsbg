// /awarder/:eik — single awarding-body detail page. Mirror of
// /company/:eik but from the awarder (buyer) side: total awarded, contracts
// they signed, top contractors they paid, and the MP-tied subset of those.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Building2,
  ExternalLink,
  Coins,
  Users,
  FileText,
  Receipt,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useAwarder } from "@/data/procurement/useAwarder";
import { dataUrl } from "@/data/dataUrl";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";
import { formatEurWithOther } from "@/lib/currency";
import { MpAvatar } from "./components/candidates/MpAvatar";
import { AwarderTopContractsTile } from "./components/procurement/AwarderTopContractsTile";
import { AwarderTopContractorsTile } from "./components/procurement/AwarderTopContractorsTile";
import { CompanyByYearChart } from "./components/procurement/CompanyByYearChart";
import { EntityFlowTile } from "./components/procurement/EntityFlowTile";
import { CompanyPortfolioTreemap } from "./components/procurement/CompanyPortfolioTreemap";
import { FollowButton } from "./components/procurement/FollowButton";
import { ErrorSection } from "./components/ErrorSection";

const numFmt = new Intl.NumberFormat("bg-BG");

// Institution-type labels for the awarder's `geo.tier` (from
// scripts/procurement/awarder_tier.ts). Mirrors SIGMA's institution-type
// dimension. "other" is the unclassified fallback — no badge. Only set when the
// awarder was geo-resolved (legacy-only / no-address buyers carry no tier).
const TIER_LABELS: Record<string, { bg: string; en: string }> = {
  central_ministry: { bg: "министерство", en: "ministry" },
  central_agency: { bg: "агенция", en: "agency" },
  national_state_co: { bg: "държавна компания", en: "state company" },
  municipal: { bg: "община", en: "municipality" },
  hospital: { bg: "болница", en: "hospital" },
  school: { bg: "училище", en: "school" },
  university: { bg: "университет", en: "university" },
  utility: { bg: "комунална услуга", en: "utility" },
  forestry: { bg: "горско стопанство", en: "forestry" },
  regional_gov: { bg: "областна структура", en: "regional authority" },
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[140px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

// Loads mp_connected.json (cached) so the awarder page can show the MP-tied
// contractors this buyer paid and the MPs behind them. Reused query key
// shares cache with other consumers.
const useMpConnected = () =>
  useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: async () => {
      const r = await fetch(dataUrl("/procurement/derived/mp_connected.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as ProcurementMpConnectedFile;
    },
    staleTime: Infinity,
  });

export const AwarderByEikScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data: a, isLoading } = useAwarder(eik);
  const { data: mpConnected } = useMpConnected();

  // Intersect this awarder's contractors with the MP-connected set →
  // {contractor, MPs, amount, contract count for this awarder}.
  const mpTiedContractors = useMemo(() => {
    if (!a || !mpConnected) return [];
    const eikToMps = new Map<string, Array<{ mpId: number; mpName: string }>>();
    for (const e of mpConnected.entries) {
      const arr = eikToMps.get(e.contractorEik) ?? [];
      if (!arr.some((m) => m.mpId === e.mpId)) {
        arr.push({ mpId: e.mpId, mpName: e.mpName });
      }
      eikToMps.set(e.contractorEik, arr);
    }
    return a.byContractor
      .filter((c) => eikToMps.has(c.eik))
      .map((c) => ({
        contractor: c,
        mps: eikToMps.get(c.eik) ?? [],
      }));
  }, [a, mpConnected]);

  // Distinct MP set across all tied contractors.
  const tiedMps = useMemo(() => {
    const seen = new Map<number, string>();
    for (const t of mpTiedContractors) {
      for (const m of t.mps) seen.set(m.mpId, m.mpName);
    }
    return [...seen.entries()].map(([mpId, mpName]) => ({ mpId, mpName }));
  }, [mpTiedContractors]);

  if (isLoading) {
    return (
      <>
        <Title description="Procurement awarder detail">
          {t("awarder_loading_title") || "Awarder"}
        </Title>
        <section aria-label="awarder" className="my-4">
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
  if (!a) {
    return (
      <ErrorSection
        title={t("awarder_not_found_title") || "Awarder not found"}
        description={
          t("awarder_not_found_desc") ||
          "No procurement-contract data is recorded for this EIK. The buyer may not have published contracts during the ingested period, or the EIK is incorrect."
        }
      />
    );
  }

  return (
    <>
      <Title description={`Public-procurement contracts awarded by ${a.name}`}>
        {a.name}
      </Title>
      <section aria-label={a.name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          EIK {a.eik}
          {a.region ? (
            <span className="text-xs text-muted-foreground">· {a.region}</span>
          ) : null}
          {a.geo?.tier && TIER_LABELS[a.geo.tier] ? (
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {i18n.language === "bg"
                ? TIER_LABELS[a.geo.tier].bg
                : TIER_LABELS[a.geo.tier].en}
            </span>
          ) : null}
          {mpTiedContractors.length > 0 ? (
            <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {t("awarder_has_mp_tied") || "Paid MP-tied"}
            </span>
          ) : null}
          <span className="ml-auto">
            <FollowButton kind="awarder" id={a.eik} label={a.name} />
          </span>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("awarder_total_awarded") || "Total awarded"}>
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-base md:text-lg font-bold tabular-nums break-words">
                {formatEurWithOther(a.totalEur, a.totalOther, i18n.language) ||
                  "—"}
              </span>
            </div>
            {a.contractCount > 0 ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                {i18n.language === "bg" ? "средно " : "avg "}
                {formatEurWithOther(
                  a.totalEur / a.contractCount,
                  {},
                  i18n.language,
                )}
                {i18n.language === "bg" ? " / договор" : " / contract"}
              </div>
            ) : null}
          </StatCard>
          <StatCard label={t("awarder_contracts") || "Contracts"}>
            <div className="flex items-baseline gap-2">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(a.contractCount)}
              </span>
            </div>
            {a.awardCount > 0 ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                + {numFmt.format(a.awardCount)}{" "}
                {t("company_awards") || "awards"}
              </div>
            ) : null}
          </StatCard>
          <StatCard label={t("awarder_contractors") || "Contractors paid"}>
            <div className="flex items-baseline gap-2">
              <Receipt className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(a.contractorCount ?? a.byContractor.length)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("awarder_contractors_hint") || "Distinct winning companies"}
            </div>
          </StatCard>
          <StatCard
            label={t("awarder_mp_tied") || "MP-tied paid"}
            className={
              mpTiedContractors.length > 0
                ? "ring-1 ring-amber-200/60 dark:ring-amber-800/40"
                : undefined
            }
          >
            <div className="flex items-baseline gap-2">
              <Users
                className={`h-5 w-5 shrink-0 ${mpTiedContractors.length > 0 ? "text-amber-600" : "text-muted-foreground"}`}
              />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(mpTiedContractors.length)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t("awarder_mp_companies") || "companies"}
              </span>
            </div>
            {tiedMps.length > 0 ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                {numFmt.format(tiedMps.length)}{" "}
                {t("procurement_index_mp_count") || "MPs"}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t("awarder_no_mp_tied") || "No MP-tied contractors"}
              </div>
            )}
          </StatCard>
        </div>

        {mpTiedContractors.length > 0 ? (
          <Card className="my-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-amber-600" />
                {t("awarder_mp_section") ||
                  "MP-tied contractors paid by this awarder"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <div className="rounded-md border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">
                        {t("procurement_col_contractor") || "Contractor"}
                      </th>
                      <th className="text-left px-3 py-2">
                        {t("procurement_col_mp") || "MP"}
                      </th>
                      <th className="text-right px-3 py-2">
                        {t("company_col_total") || "Total"}
                      </th>
                      <th className="text-right px-3 py-2 hidden md:table-cell">
                        {t("company_col_contracts") || "Contracts"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mpTiedContractors.map(({ contractor, mps }) => (
                      <tr key={contractor.eik}>
                        <td className="px-3 py-2">
                          <Link
                            to={`/company/${contractor.eik}`}
                            className="font-medium hover:underline"
                          >
                            {contractor.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {mps.map((m) => (
                              <Link
                                key={m.mpId}
                                to={`/candidate/mp-${m.mpId}/procurement`}
                                className="hover:underline inline-flex items-center gap-1.5"
                              >
                                <MpAvatar mpId={m.mpId} name={m.mpName} />
                                {m.mpName}
                              </Link>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatEurWithOther(
                            contractor.totalEur,
                            contractor.totalOther,
                            i18n.language,
                          ) || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                          {contractor.contractCount.toLocaleString("bg-BG")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* 2-col grid on xl: top contracts + top contractors side-by-side. */}
        <div className="grid gap-4 xl:grid-cols-2 my-4">
          <AwarderTopContractsTile eik={a.eik} />
          {a.byContractor.length > 0 ? (
            <AwarderTopContractorsTile
              eik={a.eik}
              rollup={a}
              mpTiedEiks={
                new Set(mpTiedContractors.map((m) => m.contractor.eik))
              }
            />
          ) : null}
        </div>

        <EntityFlowTile
          role="awarder"
          centerEik={a.eik}
          centerName={a.name}
          counterparties={a.byContractor.map((c) => ({
            eik: c.eik,
            name: c.name,
            totalEur: c.totalEur,
          }))}
          mpEdges={mpTiedContractors.flatMap(({ contractor, mps }) =>
            mps.map((m) => ({
              contractorEik: contractor.eik,
              mpId: m.mpId,
              mpName: m.mpName,
              valueEur: contractor.totalEur,
            })),
          )}
        />

        <CompanyPortfolioTreemap
          role="awarder"
          items={a.byContractor.map((c) => ({
            eik: c.eik,
            name: c.name,
            totalEur: c.totalEur,
          }))}
        />

        {a.byYear.length > 0 ? <CompanyByYearChart rows={a.byYear} /> : null}

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
