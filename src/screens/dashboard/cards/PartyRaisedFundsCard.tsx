import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HandCoins, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { PartyFiling } from "@/data/dataTypes";
import {
  formatPct,
  formatThousands,
  pctChange,
  totalIncomeFiling,
} from "@/data/utils";
import { localDate } from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = {
  filing?: PartyFiling;
  priorFiling?: PartyFiling;
  priorElection?: string;
  partyNickName?: string;
};

export const PartyRaisedFundsCard: FC<Props> = ({
  filing,
  priorFiling,
  priorElection,
  partyNickName,
}) => {
  const { t } = useTranslation();
  const total = totalIncomeFiling(filing?.income);
  const prior = totalIncomeFiling(priorFiling?.income);
  const delta = pctChange(total, prior);

  const sign = (delta ?? 0) >= 0 ? "+" : "";
  const Icon =
    delta === undefined
      ? Minus
      : delta > 0
        ? TrendingUp
        : delta < 0
          ? TrendingDown
          : Minus;
  const accent =
    delta === undefined
      ? "text-muted-foreground"
      : delta > 0
        ? "text-positive"
        : delta < 0
          ? "text-negative"
          : "text-muted-foreground";

  return (
    <StatCard
      label={t("raised_funds")}
      hint={t("dashboard_party_raised_funds_hint")}
    >
      <div className="flex items-baseline gap-2">
        <HandCoins className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {formatThousands(total)}
        </span>
        <span className="text-xs text-muted-foreground">{t("lv")}</span>
      </div>
      {delta !== undefined && (
        <div className={`text-sm font-medium tabular-nums ${accent}`}>
          <Icon className="inline h-4 w-4 mr-1 -mt-0.5" />
          {sign}
          {formatPct(delta, 2)}
          {priorElection && (
            <span className="text-xs text-muted-foreground ml-1">
              {t("dashboard_vs")} {localDate(priorElection)}
            </span>
          )}
        </div>
      )}
      {prior > 0 && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatThousands(prior)} → {formatThousands(total)}
        </div>
      )}
      {partyNickName && total > 0 && (
        <Link
          to={`/party/${partyNickName}/income`}
          className="text-[10px] text-primary hover:underline mt-1"
          underline={false}
        >
          {t("dashboard_see_details")} →
        </Link>
      )}
    </StatCard>
  );
};
