import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { PartyFilingRecord } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useLastYearParties } from "@/data/parties/useLastYearParties";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import {
  formatPct,
  formatThousands,
  pctChange,
  totalIncomeFiling,
} from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PartyFilingRecord[]
> => {
  if (!queryKey[1]) return [];
  const response = await fetch(`/${queryKey[1]}/parties/financing.json`);
  return response.json();
};

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
};

export const TopFinancingTile: FC<Props> = ({ parties }) => {
  const { t } = useTranslation();
  const { selected, priorElections } = useElectionContext();
  const { colorFor } = useCanonicalParties();
  const { partyByNickName } = useLastYearParties();

  const { data: raw } = useQuery({
    queryKey: ["parties_financing", selected],
    queryFn,
  });
  const { data: rawPrior } = useQuery({
    queryKey: ["parties_prev_year_financing", priorElections?.name],
    queryFn,
    enabled: !!priorElections,
  });

  const rows = useMemo(() => {
    if (!raw) return [];
    const incomeByParty = new Map<number, number>();
    raw.forEach((r) =>
      incomeByParty.set(r.party, totalIncomeFiling(r.filing.income)),
    );

    const built = parties
      .filter((p) => p.passedThreshold)
      .map((p) => {
        const totalIncome = incomeByParty.get(p.partyNum) ?? 0;
        let priorIncome: number | undefined;
        if (rawPrior) {
          const ly = partyByNickName(p.nickName);
          if (ly) {
            const prior = rawPrior.find((pr) => pr.party === ly.number);
            if (prior) priorIncome = totalIncomeFiling(prior.filing.income);
          }
        }
        return {
          partyNum: p.partyNum,
          nickName: p.nickName,
          color: p.color || colorFor(p.nickName) || "#888",
          totalIncome,
          deltaPct: pctChange(totalIncome, priorIncome),
        };
      })
      .sort((a, b) => b.totalIncome - a.totalIncome);

    const totalAll = built.reduce((s, r) => s + r.totalIncome, 0);
    const maxIncome = Math.max(1, ...built.map((r) => r.totalIncome));
    return built.map((r) => ({
      ...r,
      pct: totalAll ? (100 * r.totalIncome) / totalAll : 0,
      barPct: (r.totalIncome / maxIncome) * 100,
    }));
  }, [raw, rawPrior, parties, partyByNickName, colorFor]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_financing_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              <span>{t("dashboard_top_financing")}</span>
            </div>
          </Hint>
          <Link
            to="/financing"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(80px,1.4fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_party")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("income")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_now")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("dashboard_change")}
        </span>
        {rows.map(
          ({
            partyNum,
            nickName,
            color,
            totalIncome,
            pct,
            barPct,
            deltaPct,
          }) => (
            <Link
              key={partyNum}
              to={`/party/${nickName}`}
              underline={false}
              className="contents"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate font-medium">{nickName}</span>
              </div>
              <span className="tabular-nums text-xs text-muted-foreground text-right">
                {formatThousands(totalIncome)}
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
              <span className="tabular-nums text-xs font-semibold justify-self-end">
                {formatPct(pct, 2)}
              </span>
              <span className="justify-self-end">
                {deltaPct !== undefined ? (
                  <DeltaBadge delta={deltaPct} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </span>
            </Link>
          ),
        )}
      </div>
    </StatCard>
  );
};
