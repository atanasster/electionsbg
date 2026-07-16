// /funds/rrf — focused dashboard for the Recovery & Resilience Plan (ПВУ).
// Pulls the slim programme summary for 2021BG-RRP (already-built) and
// frames it with EC-scoreboard context: 2026 deadline, allocation envelope,
// 100-largest-recipients pointer, and investigative-journalism cards.
//
// Reads:
//   /funds/projects/by-program/2021BG-RRP-summary.json   # programme rollup
//   /funds/rrf_context.json                              # editorial framing
//
// Loads no per-contract data on the landing page — the programme drill-down
// already lives at /funds/programme/2021BG-RRP.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ExternalLink,
  Newspaper,
  Activity,
  Calendar,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsProgramSummary } from "@/data/funds/useFundsProgramSummary";
import { fetchFundPayload } from "@/data/funds/fetchFundPayload";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");
const RRP_CODE = "2021BG-RRP";

interface RrfContextFile {
  generatedAt: string;
  context: {
    totalAllocationEur: number;
    totalAllocationNote: { bg: string; en: string };
    deadline: string;
    deadlineNote: { bg: string; en: string };
    ecScoreboard: { url: string; label: string };
    ecLargestRecipients: { url: string; label: string };
    investigativeCards: Array<{ outlet: string; title: string; url: string }>;
  };
}

const fetchContext = (): Promise<RrfContextFile | null> =>
  fetchFundPayload<RrfContextFile>("rrf-context");

export const FundsRrfScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: summary, isLoading: summaryLoading } =
    useFundsProgramSummary(RRP_CODE);
  const ctxQuery = useQuery({
    queryKey: ["funds", "rrf_context"] as const,
    queryFn: fetchContext,
    staleTime: Infinity,
    retry: false,
  });

  const title = t("rrf_page_title") || "Recovery & Resilience Plan (ПВУ)";
  const description =
    t("rrf_page_description") ||
    "Bulgaria's National Recovery and Resilience Plan — allocation, contracted, paid, and the 2026 disbursement deadline.";

  if (summaryLoading) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
        </section>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <Title description={description}>{title}</Title>
        <section className="my-4 space-y-3">
          <Link
            to="/funds"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            {t("funds_program_back") || "Back to EU funds"}
          </Link>
          <p className="text-sm text-muted-foreground">
            {t("rrf_no_data") ||
              "RRF data is unavailable. Run the funds:ingest-projects pipeline."}
          </p>
        </section>
      </>
    );
  }

  const ctx = ctxQuery.data?.context;
  const contracted = summary.rollup.totalEur;
  const paid = summary.rollup.paidEur;
  const absorption = contracted > 0 ? Math.round((paid / contracted) * 100) : 0;
  const allocation = ctx?.totalAllocationEur;
  // % vs the EC allocation envelope — the more politically meaningful number.
  const absorptionVsAllocation =
    allocation && allocation > 0 ? Math.round((paid / allocation) * 100) : null;

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="funds_index_title"
        sectionTo="/funds"
        currentKey="rrf_page_title"
        className="mt-5"
      />
      <section className="my-4 space-y-4">
        <Link
          to="/funds"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("funds_program_back") || "Back to EU funds"}
        </Link>

        <p className="text-sm text-muted-foreground">
          {t("rrf_page_intro") ||
            "The Recovery and Resilience Plan (ПВУ) is Bulgaria's slice of NextGenerationEU, with a hard August 2026 disbursement deadline. The figures below combine the ИСУН public register (contracted + paid) with the EC scoreboard envelope."}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {allocation ? (
            <StatCard
              label={t("rrf_allocation") || "EC envelope"}
              hint={
                t("rrf_allocation_hint") ||
                "Total RRF allocation after the 2024 amendment (grants + loans)"
              }
            >
              <div className="break-words text-base font-bold tabular-nums md:text-lg">
                {formatEur(allocation)}
              </div>
            </StatCard>
          ) : null}
          <StatCard
            label={t("rrf_contracted") || "Contracted in ИСУН"}
            hint={
              t("rrf_contracted_hint") ||
              "Sum of all ПВУ contract values registered in the public register"
            }
          >
            <div className="break-words text-base font-bold tabular-nums md:text-lg">
              {formatEur(contracted)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {numFmt.format(summary.rollup.contractCount)}{" "}
              {t("funds_index_contracts") || "contracts"}
            </div>
          </StatCard>
          <StatCard
            label={t("rrf_paid") || "Paid out"}
            hint={
              t("rrf_paid_hint") ||
              "Actually disbursed to beneficiaries per ИСУН"
            }
          >
            <div className="break-words text-base font-bold tabular-nums md:text-lg">
              {formatEur(paid)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {absorption}% {t("funds_index_disbursed") || "of contracted"}
            </div>
          </StatCard>
          {absorptionVsAllocation != null ? (
            <StatCard
              label={t("rrf_paid_vs_allocation") || "Paid vs envelope"}
              hint={
                t("rrf_paid_vs_allocation_hint") ||
                "What share of the EC envelope has actually been paid out — the EU benchmark metric"
              }
              className={
                absorptionVsAllocation < 30
                  ? "ring-1 ring-rose-200/60 dark:ring-rose-800/40"
                  : undefined
              }
            >
              <div className="flex items-baseline gap-2">
                <Activity
                  className={`h-5 w-5 shrink-0 ${absorptionVsAllocation < 30 ? "text-rose-600" : "text-muted-foreground"}`}
                />
                <span className="text-2xl font-bold tabular-nums">
                  {absorptionVsAllocation}%
                </span>
              </div>
            </StatCard>
          ) : null}
        </div>

        {ctx?.deadline ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4 text-rose-600" />
                {t("rrf_deadline_title") || "2026 disbursement deadline"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4 space-y-2">
              <div className="text-sm tabular-nums">{ctx.deadline}</div>
              <p className="text-xs text-muted-foreground">
                {lang === "bg" ? ctx.deadlineNote.bg : ctx.deadlineNote.en}
              </p>
              {ctx.totalAllocationNote ? (
                <p className="text-[11px] text-muted-foreground/80">
                  {lang === "bg"
                    ? ctx.totalAllocationNote.bg
                    : ctx.totalAllocationNote.en}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("rrf_top_beneficiaries") || "Top beneficiaries (ИСУН)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="flex flex-col divide-y divide-border">
                {summary.topBeneficiaries.slice(0, 10).map((b, i) => (
                  <li
                    key={b.beneficiaryEik ?? `${b.beneficiaryName}-${i}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    {b.beneficiaryEik ? (
                      <Link
                        to={`/company/${b.beneficiaryEik}`}
                        className="font-medium hover:underline"
                      >
                        {b.beneficiaryName}
                      </Link>
                    ) : (
                      <span className="font-medium">{b.beneficiaryName}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {numFmt.format(b.contractCount)}{" "}
                      {t("funds_index_contracts") || "contracts"}
                    </span>
                    <span className="ml-auto text-sm font-medium tabular-nums">
                      {formatEur(b.totalEur)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("rrf_top_munis") || "Top municipalities (ИСУН)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="flex flex-col divide-y divide-border">
                {summary.topMunis.slice(0, 10).map((m, i) => (
                  <li
                    key={m.muni}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Link
                      to={`/settlement/${m.muni}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {m.muni}
                    </Link>
                    <span className="text-[11px] text-muted-foreground">
                      {numFmt.format(m.contractCount)}
                    </span>
                    <span className="ml-2 text-sm font-medium tabular-nums">
                      {formatEur(m.totalEur)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {ctx ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                {t("rrf_ec_sources") || "European Commission sources"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <p className="mb-2 text-xs text-muted-foreground">
                {t("rrf_ec_intro") ||
                  "For cross-country comparison (BG vs the EU average) and the official 100-largest-recipients list per Member State, use the EC's Recovery and Resilience Scoreboard."}
              </p>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <a
                    href={ctx.ecScoreboard.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {ctx.ecScoreboard.label}{" "}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </li>
                <li>
                  <a
                    href={ctx.ecLargestRecipients.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {ctx.ecLargestRecipients.label}{" "}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </li>
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {ctx?.investigativeCards.length ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                {t("rrf_investigations") || "Investigative journalism"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="space-y-2 text-sm">
                {ctx.investigativeCards.map((card) => (
                  <li key={card.url}>
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <span className="font-medium">{card.outlet}</span> —{" "}
                      {card.title}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Link
          to={`/funds/programme/${RRP_CODE}`}
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("rrf_view_programme") ||
            "Open the full ПВУ programme drill-down →"}
        </Link>
      </section>
    </>
  );
};
