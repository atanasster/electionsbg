import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const DeltaBadge: FC<{ delta: number }> = ({ delta }) => {
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0
      ? "text-positive"
      : delta < 0
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <span className={`tabular-nums text-xs font-medium ${color}`}>
      {sign}
      {formatPct(delta, 2)}
    </span>
  );
};

type Props = {
  parties: NationalPartyResult[];
  regionCode?: string;
  basePath?: string;
};

export const PartyResultsTile: FC<Props> = ({
  parties,
  regionCode,
  basePath,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();

  const rows = useMemo(() => {
    const qualifying = parties.filter((p) => p.passedThreshold);
    const maxPct = Math.max(1, ...qualifying.map((p) => p.pct));
    return qualifying.map((p) => ({
      party: p,
      barPct: (p.pct / maxPct) * 100,
      color: p.color || colorFor(p.nickName) || "#888",
    }));
  }, [parties, colorFor]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_parties_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              <span>{t("top_parties")}</span>
            </div>
          </Hint>
          <Link
            to={
              basePath
                ? `${basePath}/parties`
                : regionCode
                  ? `/municipality/${regionCode}/parties`
                  : "/parties"
            }
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-2.5 mt-1">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto_auto] gap-x-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("dashboard_party")}</span>
          <span className="text-right">{t("votes")}</span>
          <span>{t("dashboard_share")}</span>
          <span className="text-right">{t("dashboard_now")}</span>
          <span className="text-right">{t("dashboard_change")}</span>
        </div>
        {rows.map(({ party, barPct, color }) => (
          <Link
            key={party.partyNum}
            to={`/party/${party.nickName}`}
            underline={false}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto_auto] gap-x-3 items-center text-sm hover:bg-muted/40 rounded-md px-1 py-1 -mx-1 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="truncate font-medium">{party.nickName}</span>
            </div>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(party.totalVotes)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, barPct)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(party.pct, 2)}
            </span>
            <div className="text-right">
              {party.deltaPct !== undefined ? (
                <DeltaBadge delta={party.deltaPct} />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
