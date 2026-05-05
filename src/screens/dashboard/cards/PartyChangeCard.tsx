import { FC } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown } from "lucide-react";
import { PartyChange } from "@/data/dashboard/dashboardTypes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatPct } from "@/data/utils";
import { Link } from "@/ux/Link";
import { StatCard } from "../StatCard";

type Props = {
  variant: "gainer" | "loser";
  change?: PartyChange;
};

// utils.formatThousands returns "" for 0; we want "0".
// bg-BG uses U+00A0 (NBSP) as the thousands separator; \s matches it.
const fmtCount = (n: number) => n.toLocaleString("bg-BG").replace(/\s/g, ",");

export const PartyChangeCard: FC<Props> = ({ variant, change }) => {
  const { t } = useTranslation();
  const { displayNameFor } = useCanonicalParties();
  const isGainer = variant === "gainer";
  const Icon = isGainer ? TrendingUp : TrendingDown;
  const accent = isGainer ? "text-positive" : "text-negative";
  const label = isGainer ? t("dashboard_top_gainer") : t("dashboard_top_loser");
  const hint = isGainer
    ? t("dashboard_top_gainer_hint")
    : t("dashboard_top_loser_hint");

  if (!change) {
    return (
      <StatCard label={label} hint={hint}>
        <div className="text-sm text-muted-foreground">
          {t("dashboard_no_prior_data")}
        </div>
      </StatCard>
    );
  }

  const sign = change.deltaPct >= 0 ? "+" : "";
  return (
    <StatCard label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: change.color || "#888" }}
        />
        <Link
          to={`/party/${change.nickName}`}
          className="text-lg font-semibold truncate hover:underline"
          underline={false}
        >
          {displayNameFor(change.nickName) ?? change.nickName}
        </Link>
      </div>
      <div className={`flex items-baseline gap-2 ${accent}`}>
        <Icon className="h-5 w-5 shrink-0" />
        <span className="text-2xl font-bold tabular-nums">
          {sign}
          {formatPct(change.deltaPct, 2)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("dashboard_pct_points")}
        </span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatPct(change.priorPct, 2)} → {formatPct(change.currentPct, 2)} (
        {sign}
        {fmtCount(change.deltaVotes)} {t("votes").toLowerCase()})
      </div>
    </StatCard>
  );
};
