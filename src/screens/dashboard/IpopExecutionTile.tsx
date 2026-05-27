// IPOP execution tile — surfaces the МРРБ "Инвестиционна програма за
// общински проекти" payment status for the município. Data comes from
// the per-município shard file at /budget/ipop/municipalities/{obshtinaCode}.json.
//
// The tile shows:
//   • Per-project total agreement value (the headline);
//   • Paid amount + execution percent (with a paid-progress bar);
//   • Submitted-in-review + approved-awaiting amounts (the pending pipe);
//   • Stalled-project count (agreement >= €100k AND paid < 5%);
//   • Top-5 projects by agreement value with per-project execution bars.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, AlertOctagon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useIpopMunicipality } from "@/data/budget/useBudget";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${Math.round(v).toLocaleString("en-US")}`;
};

export const IpopExecutionTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t } = useTranslation();
  const { data, isLoading } = useIpopMunicipality(obshtinaCode);

  if (isLoading || !data) return null;

  const r = data.rollup;
  if (r.projectCount === 0) return null;

  const topProjects = data.projects.slice(0, 5);
  const pipelineEur = r.submittedEur + r.awaitingEur;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-4 w-4" />
          {t("ipop_tile_title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("ipop_tile_intro")}</p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(r.agreementEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("ipop_project_count", { count: r.projectCount })}
          </span>
        </div>

        {/* Paid progress bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1 text-xs">
            <span className="font-medium">{t("ipop_paid_label")}</span>
            <span className="tabular-nums">
              {compactEur(r.paidEur)} ·{" "}
              <span className="text-muted-foreground">
                {r.paidPct.toFixed(1)}%
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${Math.min(100, r.paidPct)}%` }}
            />
          </div>
        </div>

        {/* Pending pipeline */}
        {pipelineEur > 0 && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">
                {t("ipop_submitted_label")}
              </div>
              <div className="tabular-nums font-medium">
                {compactEur(r.submittedEur)}
              </div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">
                {t("ipop_awaiting_label")}
              </div>
              <div className="tabular-nums font-medium">
                {compactEur(r.awaitingEur)}
              </div>
            </div>
          </div>
        )}

        {/* Stalled projects flag */}
        {r.stalledCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5">
            <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
            <span>{t("ipop_stalled_warning", { count: r.stalledCount })}</span>
          </div>
        )}

        {/* Top projects */}
        <div>
          <div className="text-xs font-medium mb-1">
            {t("ipop_top_projects")}
          </div>
          <div className="space-y-1.5">
            {topProjects.map((p) => (
              <div
                key={p.id}
                className="rounded px-2 py-1 text-xs hover:bg-muted/40"
              >
                <div className="grid grid-cols-[1fr_auto] items-baseline gap-3">
                  <span className="line-clamp-2">{p.description}</span>
                  <span className="tabular-nums font-medium shrink-0">
                    {compactEur(p.agreementEur)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-0.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${p.stalled ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.min(100, p.paidPct)}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-muted-foreground text-[10px] w-12 text-right shrink-0">
                    {p.paidPct.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t("ipop_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
