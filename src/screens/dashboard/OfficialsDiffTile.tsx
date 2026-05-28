// Per-município reconciliation tile — surfaces whether the elected mayor
// + council from CIK still match the Сметна палата current-officials
// roster. Renders nothing for synthetic SOF and for municípios with no
// diff record.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { useMunicipalityOfficialsDiff } from "@/data/local/useOfficialsDiff";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

const STATUS_TONE: Record<
  string,
  { color: string; Icon: typeof CheckCircle2; labelKey: string }
> = {
  match: {
    color: "text-emerald-600",
    Icon: CheckCircle2,
    labelKey: "sverka_status_match",
  },
  partial_mismatch: {
    color: "text-amber-600",
    Icon: AlertTriangle,
    labelKey: "sverka_status_partial",
  },
  mismatch: {
    color: "text-red-600",
    Icon: AlertTriangle,
    labelKey: "sverka_status_mismatch",
  },
  missing: {
    color: "text-muted-foreground",
    Icon: Clock,
    labelKey: "sverka_status_missing",
  },
};

export const OfficialsDiffTile: FC<Props> = ({ obshtinaCode, className }) => {
  const { t } = useTranslation();
  const cycle = useLatestLocalCycle();
  const diff = useMunicipalityOfficialsDiff(obshtinaCode, cycle);

  if (!diff) return null;

  const tone = STATUS_TONE[diff.overallStatus] ?? STATUS_TONE.missing;
  const { Icon } = tone;

  const mayorMessage = (() => {
    switch (diff.mayor.status) {
      case "match":
        return t("diff_tile_mayor_match");
      case "replaced":
        return t("diff_tile_mayor_replaced", {
          cik: diff.mayor.cikName ?? "—",
          official: diff.mayor.officialName ?? "—",
        });
      case "missing_official":
        return t("diff_tile_mayor_missing_official", {
          cik: diff.mayor.cikName ?? "—",
        });
      case "missing_cik":
        return t("diff_tile_mayor_missing_cik", {
          official: diff.mayor.officialName ?? "—",
        });
    }
  })();

  const showCouncilSummary = diff.council.cikElectedCount > 0;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${tone.color}`} />
            <span className="truncate">{t("diff_tile_title")}</span>
          </div>
          <Link
            to="/sverka"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("diff_tile_view_full")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1 text-sm">{mayorMessage}</div>
      {showCouncilSummary ? (
        <div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
          {t("diff_tile_council_summary", {
            matched: diff.council.matched,
            total: diff.council.cikElectedCount,
          })}
        </div>
      ) : null}
    </StatCard>
  );
};
