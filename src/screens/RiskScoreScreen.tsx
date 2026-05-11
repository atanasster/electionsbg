import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRiskScore, type RiskBand } from "@/data/riskScore/useRiskScore";
import { Template } from "@/screens/reports/sections/Template";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { Link } from "@/ux/Link";
import type { ReportRow } from "@/data/dataTypes";
import type { ReportColumns } from "@/screens/reports/common/ReportTemplate";

// Overview screen — uses the standard section-report template (same
// look + filter UX as every other per-section report on the site).
// Adds two extra columns: the band badge and a "signals available"
// indicator. The detail decomposition is no longer a separate route —
// it lives on the section page itself as SectionRiskTile.

type RiskAugmentedRow = ReportRow & {
  band?: RiskBand;
  signalsAvailable?: number;
  signalsTotal?: number;
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
          if (v.signalsAvailable === undefined) return null;
          return (
            <span className="tabular-nums text-xs text-muted-foreground">
              {v.signalsAvailable} / {v.signalsTotal}
            </span>
          );
        },
      },
    ],
    [t],
  );

  return (
    <div className="w-full">
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
