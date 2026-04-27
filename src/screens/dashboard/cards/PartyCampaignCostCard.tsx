import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { PartyFiling } from "@/data/dataTypes";
import {
  campaignCostFiling,
  campaignNonMonetaryCost,
  formatPct,
  formatThousands,
  pctChange,
  localDate,
} from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = {
  filing?: PartyFiling;
  priorFiling?: PartyFiling;
  priorElection?: string;
  partyNickName?: string;
};

export const PartyCampaignCostCard: FC<Props> = ({
  filing,
  priorFiling,
  priorElection,
  partyNickName,
}) => {
  const { t } = useTranslation();
  const total = campaignCostFiling(filing);
  const prior = campaignCostFiling(priorFiling);
  const delta = pctChange(total, prior);
  const nonMonetary = campaignNonMonetaryCost(filing);
  const nonMonetaryPct = total ? (100 * nonMonetary) / total : 0;

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
        ? "text-negative"
        : delta < 0
          ? "text-positive"
          : "text-muted-foreground";

  return (
    <StatCard
      label={t("campaign_cost")}
      hint={t("dashboard_party_campaign_cost_hint")}
    >
      <div className="flex items-baseline gap-2">
        <Banknote className="h-5 w-5 text-muted-foreground shrink-0" />
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
      {nonMonetary > 0 && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatThousands(nonMonetary)} {t("non_monetary").toLowerCase()} (
          {formatPct(nonMonetaryPct, 1)})
        </div>
      )}
      {partyNickName && total > 0 && (
        <Link
          to={`/party/${partyNickName}/expenses`}
          className="text-[10px] text-primary hover:underline mt-1"
          underline={false}
        >
          {t("dashboard_see_details")} →
        </Link>
      )}
    </StatCard>
  );
};
