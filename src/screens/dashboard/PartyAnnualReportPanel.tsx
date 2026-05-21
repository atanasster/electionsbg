// Party-page tile: a compact view of one party's Court-of-Audit annual
// financial-report filing record, with a deep link to the full per-party
// page. Rendered inside the "Годишни финансови отчети" DashboardSection, so
// the section supplies the heading; this card carries only the content.
// Slug is resolved by the caller via partyAliases. Renders nothing until the
// shard arrives.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
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

export const PartyAnnualReportPanel: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { data: party } = useFinancingPartyReport(slug);
  const { data: summary } = useFinancingReportsSummary();

  const years = useMemo(
    () => (summary?.years ?? []).map((y) => y.year).sort((a, b) => a - b),
    [summary],
  );
  const byYear = useMemo(() => {
    const m: Record<number, FilingStatus> = {};
    for (const f of party?.filings ?? []) m[f.year] = f.status;
    return m;
  }, [party]);

  if (!party) return null;

  const total = FILING_STATUSES.reduce((s, k) => s + party.counts[k], 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">
          {t("annual_reports_panel_entity", { name: party.name }) ||
            `Filed as: ${party.name}`}
        </div>
        <div className="mt-2 overflow-x-auto">
          <ComplianceStrip byYear={byYear} years={years} size="md" />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {FILING_STATUSES.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-sm ${FILING_STATUS_META[status].cell}`}
              />
              <span className="text-muted-foreground">
                {t(`annual_reports_status_${status}`) || status}
              </span>
              <span className="font-medium tabular-nums">
                {party.counts[status]}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2.5">
          <span className="text-[11px] text-muted-foreground">
            {t("annual_reports_panel_summary", {
              rate: Math.round(party.complianceRate * 100),
              total,
            }) || `On time in ${party.counts.on_time} of ${total} years.`}
          </span>
          <Link
            to={`/financing/annual-reports/${party.slug}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("annual_reports_panel_full_record") || "Full filing record"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
