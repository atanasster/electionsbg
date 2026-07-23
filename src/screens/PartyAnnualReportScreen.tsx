// /financing/annual-reports/:slug — one party's annual-financial-report
// filing history. Party-page layout idiom: a centred Title + Caption header
// over Card-wrapped sections (scorecard, then a reverse-chronological history
// table). Data: the per-party shard from scripts/financing/scrape_reports.ts.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { Caption } from "@/ux/Caption";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  FILING_STATUSES,
  useFinancingPartyReport,
  useFinancingReportsSummary,
  type FilingStatus,
} from "@/data/financing/useFinancingReports";
import {
  ComplianceStrip,
  FILING_STATUS_META,
} from "@/screens/components/financing/ComplianceStrip";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { CANONICAL_ID_BY_GFOPP_SLUG } from "@/data/financing/partyAliases";
import { ElectionsBreadcrumb } from "@/screens/components/ElectionsBreadcrumb";

const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const PartyAnnualReportScreen: FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-GB";
  const { data: party, isLoading } = useFinancingPartyReport(slug);
  const { data: summary } = useFinancingReportsSummary();

  // When the gfopp party maps to a site canonical party, badge the page with
  // its brand colour + short name — same idiom as a /party page header.
  const { byId, displayNameForId } = useCanonicalParties();
  const canonicalId = slug ? CANONICAL_ID_BY_GFOPP_SLUG[slug] : undefined;
  const canonical = canonicalId ? byId.get(canonicalId) : undefined;

  // Full catalogue year range — keeps the strip aligned with the index.
  const years = useMemo(
    () => (summary?.years ?? []).map((y) => y.year).sort((a, b) => a - b),
    [summary],
  );
  const byYear = useMemo(() => {
    const map: Record<number, FilingStatus> = {};
    for (const f of party?.filings ?? []) map[f.year] = f.status;
    return map;
  }, [party]);

  const indexTitle =
    t("annual_reports_title") || "Party annual financial reports";

  if (isLoading) {
    return (
      <div className="w-full">
        <Title>{indexTitle}</Title>
        <div className="text-sm text-muted-foreground">
          {t("annual_reports_loading") || "Loading…"}
        </div>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="w-full">
        <Title>{indexTitle}</Title>
        <div className="text-sm text-muted-foreground">
          {t("annual_reports_party_not_found") || "Party not found."}{" "}
          <Link
            to="/financing/annual-reports"
            className="text-primary hover:underline"
          >
            {t("annual_reports_back_to_index") || "Back to all parties"}
          </Link>
        </div>
      </div>
    );
  }

  const total = FILING_STATUSES.reduce((s, k) => s + party.counts[k], 0);
  const ratePct = Math.round(party.complianceRate * 100);
  const missingYears = party.filings
    .filter((f) => f.status === "not_filed")
    .map((f) => f.year)
    .sort((a, b) => a - b);

  return (
    <div className="w-full pb-12">
      <ElectionsBreadcrumb
        hub="analysis"
        section={{
          labelKey: "annual_reports_title",
          to: "/financing/annual-reports",
        }}
        current={party.name}
        className="mt-4 mb-1"
      />

      <Title
        className="w-auto flex justify-center pt-2 pb-1 md:pt-4 md:pb-2"
        title={party.name}
        description={
          t("annual_reports_party_seo", { party: party.name }) ||
          `Annual financial-report filing record for ${party.name} — Court of Audit register.`
        }
      >
        {canonical ? (
          <span className="inline-flex border-2 border-primary">
            <span
              className="bg-primary px-5 py-2 text-xl font-bold text-white md:text-2xl"
              style={{ backgroundColor: canonical.color }}
            >
              {(canonicalId && displayNameForId(canonicalId)) || party.name}
            </span>
          </span>
        ) : (
          party.name
        )}
      </Title>
      <Caption>
        {t("annual_reports_panel_title") || "Annual financial reports"}
      </Caption>

      {/* Scorecard */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("annual_reports_col_record") || "15-year record"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <ComplianceStrip byYear={byYear} years={years} size="lg" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("annual_reports_compliance_rate") || "On-time rate"}
              </div>
              <div className="text-xl font-bold tabular-nums">{ratePct}%</div>
            </div>
            {FILING_STATUSES.map((status) => (
              <div
                key={status}
                className="rounded-lg border bg-background px-3 py-2"
              >
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-sm ${FILING_STATUS_META[status].cell}`}
                  />
                  {t(`annual_reports_status_${status}`) || status}
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {party.counts[status]}
                </div>
              </div>
            ))}
          </div>
          {party.counts.on_time === total && total > 0 ? (
            <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">
              {t("annual_reports_trend_perfect") ||
                "Filed on time and compliant every tracked year."}
            </p>
          ) : missingYears.length > 0 ? (
            <p className="mt-3 text-xs text-red-700 dark:text-red-400">
              {t("annual_reports_trend_missing", {
                years: missingYears.join(", "),
              }) || `No annual report filed for: ${missingYears.join(", ")}.`}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* History table */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("annual_reports_history_heading") || "Filing history"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left font-normal">
                    {t("annual_reports_col_year") || "Reporting year"}
                  </th>
                  <th className="px-3 py-2 text-left font-normal">
                    {t("annual_reports_col_deadline") || "Statutory deadline"}
                  </th>
                  <th className="px-3 py-2 text-left font-normal">
                    {t("annual_reports_col_status") || "Filing status"}
                  </th>
                  <th className="px-3 py-2 text-right font-normal">
                    {t("annual_reports_col_report") || "Report"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {party.filings.map((f, i) => (
                  <tr key={f.year} className={i % 2 === 0 ? "" : "bg-muted/10"}>
                    <td className="px-3 py-2 font-medium tabular-nums">
                      {f.year}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDate(f.deadline, locale)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${FILING_STATUS_META[f.status].badge}`}
                      >
                        {t(`annual_reports_status_${f.status}`) || f.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {f.reportUrl ? (
                        <a
                          href={f.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {t("annual_reports_view_report") || "View report"}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <FileCheck2 className="h-3.5 w-3.5" />
        <span>
          {t("annual_reports_party_source") ||
            "Source: Court of Audit annual party-report register."}
        </span>
        <a
          href="https://gfopp.bulnao.government.bg/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          gfopp.bulnao.government.bg
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};
