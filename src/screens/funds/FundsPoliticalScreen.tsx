// /funds/political — full leaderboard of politically-tied EU-funds
// beneficiaries. Same data source as the /funds tile (political_links.json),
// but renders the full top-50 with category breakdown, procurement overlap,
// and per-EIK drill-down link to /company/{eik}.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Users, Building, Coins, Ban } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { usePoliticalIndex } from "@/data/funds/usePoliticalLinks";
import { formatEur } from "@/lib/currency";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import { officialCategoryLabel } from "@/data/funds/officialLabels";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

export const FundsPoliticalScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = usePoliticalIndex();

  const title = t("funds_political_page_title") || "Politically-tied EU-funds";
  const description =
    t("funds_political_page_description") ||
    "EU-funds beneficiaries whose declared owners or managers are politically-exposed persons.";

  if (isLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </section>
      </>
    );
  }

  if (!data || data.totals.flaggedEiks === 0) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4">
          <p className="text-sm text-muted-foreground">
            {t("funds_political_none") ||
              "No politically-tied beneficiaries are currently flagged."}
          </p>
        </section>
      </>
    );
  }

  const t1 = data.totals;

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        currentKey="funds_political_page_title"
        className="mt-5"
      />
      <section className="my-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("funds_political_page_intro") ||
            "Every EU-funds beneficiary whose declared owners or managers include a sitting MP, cabinet member, regional governor, mayor, deputy mayor, council chair, councillor, or chief architect. Source: Сметна палата declarations and the Commerce Registry."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t("funds_political_total_label") || "Flagged beneficiaries"}
            hint={
              t("funds_political_total_hint") ||
              "Companies with a declared MP or officials linkage in ИСУН"
            }
          >
            <div className="flex items-baseline gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.flaggedEiks)}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("funds_political_contracted") || "Funds contracted"}
            hint={t("funds_political_contracted_hint") || "Total EU-funds"}
          >
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="break-words text-base font-bold tabular-nums md:text-lg">
                {formatEur(t1.contractedEur)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatEur(t1.paidEur)} {t("funds_index_paid") || "paid"}
            </div>
          </StatCard>
          <StatCard
            label={t("funds_political_proc_label") || "АОП overlap"}
            hint={
              t("funds_political_proc_hint") ||
              "Same beneficiaries' public-procurement award totals"
            }
          >
            <div className="flex items-baseline gap-2">
              <Building className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="break-words text-base font-bold tabular-nums md:text-lg">
                {formatEur(t1.procurementEur)}
              </span>
            </div>
          </StatCard>
          <StatCard
            label={t("funds_political_debarred_label") || "Debarred"}
            hint={
              t("funds_political_debarred_hint") ||
              "Currently on the АОП debarred-suppliers register"
            }
          >
            <div className="flex items-baseline gap-2">
              <Ban className="h-5 w-5 shrink-0 text-rose-600" />
              <span className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.debarredFlagged)}
              </span>
            </div>
          </StatCard>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-rose-600" />
              {t("funds_political_breakdown") || "Type of linkage"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 p-3 md:p-4">
            <div className="rounded bg-amber-100/50 p-3 dark:bg-amber-900/20">
              <div className="text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
                {t("funds_political_mp_only") || "MP only"}
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.mpOnly)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("funds_political_mp_only_hint") ||
                  "Sitting or former MP business connection"}
              </div>
            </div>
            <div className="rounded bg-purple-100/50 p-3 dark:bg-purple-900/20">
              <div className="text-[10px] font-medium uppercase tracking-wide text-purple-800 dark:text-purple-300">
                {t("funds_political_official_only") || "Official only"}
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.officialOnly)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("funds_political_official_only_hint") ||
                  "Cabinet, governor, mayor, councillor or agency head"}
              </div>
            </div>
            <div className="rounded bg-rose-100/50 p-3 dark:bg-rose-900/20">
              <div className="text-[10px] font-medium uppercase tracking-wide text-rose-800 dark:text-rose-300">
                {t("funds_political_both") || "Multiple"}
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {numFmt.format(t1.both)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("funds_political_both_hint") ||
                  "Both an MP and a non-MP official"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("funds_political_top50") || "Top flagged beneficiaries"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="flex flex-col divide-y divide-border">
              {data.top.map((e, i) => {
                const peopleLabels: string[] = [];
                for (const m of e.mps.slice(0, 2)) {
                  peopleLabels.push(
                    `${t("funds_political_mp_chip") || "MP"} ${m.mpName}`,
                  );
                }
                for (const o of e.officials.slice(0, 2)) {
                  peopleLabels.push(
                    `${officialCategoryLabel(t, o.category)} — ${o.name}`,
                  );
                }
                const extra =
                  e.mps.length + e.officials.length - peopleLabels.length;
                return (
                  <li
                    key={e.eik}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/company/${e.eik}`}
                        className="font-medium hover:underline"
                      >
                        {e.name}
                      </Link>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{orgTypeLabel(e.orgType, i18n.language)}</span>
                        {peopleLabels.map((p, idx) => (
                          <span key={`${e.eik}-${idx}`}>· {p}</span>
                        ))}
                        {extra > 0 ? (
                          <span>
                            {" "}
                            ·{" "}
                            {t("funds_political_extra_count", {
                              count: extra,
                            }) || `+${extra}`}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-col items-end">
                      <span className="text-sm font-medium tabular-nums">
                        {formatEur(e.contractedEur)}
                      </span>
                      {e.procurementEur > 0 ? (
                        <span className="text-[10px] text-sky-700 dark:text-sky-400 tabular-nums">
                          +{formatEur(e.procurementEur)}{" "}
                          {t("funds_political_proc_short") || "АОП"}
                        </span>
                      ) : null}
                      {e.debarred ? (
                        <span className="text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300">
                          {t("funds_political_debarred") || "debarred"}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <p className="text-[11px] text-muted-foreground/80">
          {t("funds_political_disclaimer") ||
            "A connection describes what the official is on record for — not in itself an accusation of wrongdoing."}
        </p>
      </section>
    </>
  );
};
