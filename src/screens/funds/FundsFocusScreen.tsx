// /funds/focus/{slug} — themed lens on the EU-funds corpus. Each theme is a
// hand-curated keyword + programme-code filter; the shard carries the
// matching totals, top beneficiaries, top contracts, top municipalities,
// programme breakdown, and an investigative-journalism sidebar.

import { FC } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Newspaper } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useFundsTheme } from "@/data/funds/useFundsThemes";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

const SkeletonCard: FC = () => (
  <div className="h-[140px] animate-pulse rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 h-3 w-24 rounded bg-muted" />
    <div className="h-7 w-32 rounded bg-muted" />
  </div>
);

export const FundsFocusScreen: FC = () => {
  const { slug } = useParams();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useFundsTheme(slug);
  const lang = i18n.language;

  const label = data ? (lang === "bg" ? data.labelBg : data.labelEn) : "";
  const summary = data ? (lang === "bg" ? data.summaryBg : data.summaryEn) : "";

  if (isLoading) {
    return (
      <section className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="my-4 space-y-3">
        <Link
          to="/funds"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("funds_program_back") || "Back to EU funds"}
        </Link>
        <p className="text-sm text-muted-foreground">
          {t("focus_not_found") || "This focus theme is not defined."}
        </p>
      </section>
    );
  }

  const absorption =
    data.totals.totalEur > 0
      ? Math.round((data.totals.paidEur / data.totals.totalEur) * 100)
      : 0;

  return (
    <>
      <Title description={summary}>{label}</Title>
      <section className="my-4 space-y-4">
        <Link
          to="/funds"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("funds_program_back") || "Back to EU funds"}
        </Link>
        <p className="text-sm text-muted-foreground">{summary}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("funds_index_contracts") || "Contracts"}>
            <div className="text-2xl font-bold tabular-nums">
              {numFmt.format(data.totals.contractCount)}
            </div>
          </StatCard>
          <StatCard label={t("funds_index_beneficiaries") || "Beneficiaries"}>
            <div className="text-2xl font-bold tabular-nums">
              {numFmt.format(data.totals.beneficiaryCount)}
            </div>
          </StatCard>
          <StatCard label={t("funds_index_contracted") || "Funds contracted"}>
            <div className="break-words text-base font-bold tabular-nums md:text-lg">
              {formatEur(data.totals.totalEur)}
            </div>
          </StatCard>
          <StatCard label={t("funds_index_paid") || "Funds paid"}>
            <div className="break-words text-base font-bold tabular-nums md:text-lg">
              {formatEur(data.totals.paidEur)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {absorption}% {t("funds_index_disbursed") || "of contracted"}
            </div>
          </StatCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("focus_top_beneficiaries") || "Top beneficiaries"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="flex flex-col divide-y divide-border">
                {data.topBeneficiaries.map((b, i) => (
                  <li
                    key={b.eik ?? `${b.name}-${i}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    {b.eik ? (
                      <Link
                        to={`/company/${b.eik}`}
                        className="font-medium hover:underline"
                      >
                        {b.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{b.name}</span>
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
                {t("focus_programmes") || "Programmes"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="flex flex-col divide-y divide-border">
                {data.programmes.slice(0, 10).map((p) => (
                  <li
                    key={p.programCode}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <Link
                      to={`/funds/programme/${encodeURIComponent(p.programCode)}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {p.programName}
                    </Link>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {numFmt.format(p.contractCount)}
                    </span>
                    <span className="ml-2 text-sm font-medium tabular-nums">
                      {formatEur(p.totalEur)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {data.topMunis.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("focus_top_munis") || "Where the money went (municipality)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {data.topMunis.map((m) => (
                  <li
                    key={m.muni}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <Link
                      to={`/settlement/${m.muni}`}
                      className="truncate font-medium hover:underline"
                    >
                      {m.muni}
                    </Link>
                    <span className="tabular-nums">
                      {formatEur(m.totalEur)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("focus_top_contracts") || "Top contracts"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <ul className="flex flex-col divide-y divide-border">
              {data.topContracts.map((c) => (
                <li
                  key={c.contractNumber}
                  className="py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <Link
                      to={`/funds/contract/${encodeURIComponent(c.contractNumber)}`}
                      className="font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <span className="ml-auto text-sm font-medium tabular-nums">
                      {formatEur(c.totalEur)}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.beneficiaryName} · {c.programName} · {c.locationRaw}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {data.investigativeCards.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                {t("focus_investigations") || "Investigative journalism"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 md:p-4">
              <ul className="space-y-2 text-sm">
                {data.investigativeCards.map((card) => (
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
      </section>
    </>
  );
};
