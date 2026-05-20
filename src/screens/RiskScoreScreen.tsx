import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useRiskScore,
  type RiskBand,
  type RiskComponent,
  type RiskComponentId,
} from "@/data/riskScore/useRiskScore";
import { Template } from "@/screens/reports/sections/Template";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { SIGNAL_COLORS } from "@/screens/components/riskScore/signalColors";
import { Link } from "@/ux/Link";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ReportRow } from "@/data/dataTypes";
import type { ReportColumns } from "@/screens/reports/common/ReportTemplate";

// Order matches the weight ordering in the pipeline — recount + SUEMG
// (heavier weights) on the left, peer outlier (lightest) on the right.
const SIGNAL_ORDER: RiskComponentId[] = [
  "recount",
  "suemgMismatch",
  "invalidBallots",
  "additionalVoters",
  "concentrated",
  "peerOutlier",
  "swing",
];

// Overview screen — uses the standard section-report template (same
// look + filter UX as every other per-section report on the site).
// Adds two extra columns: the band badge and a "signals available"
// indicator. The detail decomposition is no longer a separate route —
// it lives on the section page itself as SectionRiskTile.

type RiskAugmentedRow = ReportRow & {
  band?: RiskBand;
  signalsAvailable?: number;
  signalsTotal?: number;
  components?: RiskComponent[];
};

export const RiskScoreScreen = () => {
  const { t } = useTranslation();
  const { data } = useRiskScore();

  const votes = useMemo<RiskAugmentedRow[]>(
    () =>
      (data?.rows ?? []).map((r) => ({
        oblast: r.oblast,
        obshtina: r.obshtina,
        ekatte: r.ekatte,
        section: r.section,
        // Winning party + its vote count surface in the standard
        // template's ПАРТИЯ + ГЛАСОВЕ columns.
        partyNum: r.partyNum,
        totalVotes: r.totalVotes,
        pctPartyVote: r.pctPartyVote,
        // `value` powers the threshold slider — 0–100 score range plays
        // cleanly with the existing 5/10/20/.../90 dropdown values.
        value: r.score,
        band: r.band,
        signalsAvailable: r.signalsAvailable,
        signalsTotal: r.signalsTotal,
        components: r.components,
      })),
    [data],
  );

  // Extra columns: band badge + signals-available count. Both surface
  // information the table needs but that ReportTemplate has no built-in
  // slot for.
  const extraColumns: ReportColumns = useMemo(
    () => [
      {
        accessorKey: "band",
        header: t("risk_col_band"),
        cell: ({ row }) => {
          const v = row.original as RiskAugmentedRow;
          if (!v.band) return null;
          return <RiskBandBadge band={v.band} score={v.value} size="sm" />;
        },
      },
      {
        accessorKey: "signalsAvailable",
        header: t("risk_col_signals"),
        cell: ({ row }) => {
          const v = row.original as RiskAugmentedRow;
          if (!v.components) return null;
          const byId = new Map(v.components.map((c) => [c.id, c]));
          return (
            <div className="flex items-center gap-1">
              {SIGNAL_ORDER.map((id) => {
                const c = byId.get(id);
                const isFired = !!c;
                const color = SIGNAL_COLORS[id];
                return (
                  // `disableHoverableContent` makes the tooltip close
                  // immediately when the cursor leaves the trigger — without
                  // it, Radix keeps the previous tooltip "alive" while the
                  // cursor crosses the small gap to the next dot, which
                  // looked like the tooltip was stuck on the wrong square.
                  <ShadcnTooltip
                    key={id}
                    delayDuration={0}
                    disableHoverableContent
                  >
                    <TooltipTrigger asChild>
                      <span
                        className="block w-2.5 h-2.5 rounded-sm border"
                        style={
                          isFired
                            ? { background: color, borderColor: color }
                            : { borderColor: "hsl(var(--border))" }
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      className="max-w-72 text-sm border-l-4 p-2.5"
                      style={{
                        // Color-coded accent only for firing signals.
                        // For non-firing signals the dot is an outline-
                        // only square; matching the tooltip with the
                        // signal color would be misleading (the dot is
                        // showing absence-of-signal, not the signal).
                        borderLeftColor: isFired ? color : "hsl(var(--border))",
                        opacity: isFired ? 1 : 0.85,
                      }}
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold flex items-center gap-2">
                          <span
                            className="inline-block w-2 h-2 rounded-sm shrink-0 border"
                            style={
                              isFired
                                ? { background: color, borderColor: color }
                                : { borderColor: "hsl(var(--border))" }
                            }
                          />
                          <span
                            className={isFired ? "" : "text-muted-foreground"}
                          >
                            {t(`risk_signal_${id}`)}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          {t(`risk_signal_${id}_caption`)}
                        </div>
                        {isFired ? (
                          <div className="text-[11px] tabular-nums">
                            +{c.contribution.toFixed(1)}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground italic">
                            {t("risk_signal_not_fired")}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </ShadcnTooltip>
                );
              })}
            </div>
          );
        },
      },
    ],
    [t],
  );

  return (
    <div data-og="risk-score-page" className="w-full">
      <div className="px-4 md:px-8 pt-4">
        <MethodologyCallout
          variant="disputed"
          title={t("risk_score_caveat_title")}
        >
          {t("risk_score_caveat_body")}{" "}
          <Link
            to="/risk-score/methodology"
            className="text-primary hover:underline"
            underline={false}
          >
            {t("risk_read_full_methodology")} →
          </Link>
        </MethodologyCallout>
      </div>
      <Template
        defaultThreshold={60}
        bigger={true}
        votes={votes}
        titleKey="risk_score_title"
        ruleKey="risk_score_rule"
        extraColumns={extraColumns}
      />
    </div>
  );
};
