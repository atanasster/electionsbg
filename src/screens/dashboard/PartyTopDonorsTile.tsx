import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import { PartyFinancing } from "@/data/dataTypes";
import { formatPct, formatThousands } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { StatCard } from "./StatCard";

const TOP_N = 10;

type Props = {
  financing?: PartyFinancing | null;
  partyNickName?: string;
  color?: string;
};

export const PartyTopDonorsTile: FC<Props> = ({
  financing,
  partyNickName,
  color,
}) => {
  const { t } = useTranslation();

  const { rows, totalDonors, sumAll } = useMemo(() => {
    const donors = financing?.data.fromDonors ?? [];
    const enriched = donors.map((d) => ({
      name: d.name,
      date: d.date,
      goal: d.goal,
      total: (d.monetary || 0) + (d.nonMonetary || 0),
    }));
    const sum = enriched.reduce((s, d) => s + d.total, 0);
    const sorted = enriched.sort((a, b) => b.total - a.total).slice(0, TOP_N);
    const max = sorted[0]?.total ?? 1;
    return {
      rows: sorted.map((d) => ({
        ...d,
        pctOfAll: sum ? (100 * d.total) / sum : 0,
        barPct: (d.total / max) * 100,
      })),
      totalDonors: donors.length,
      sumAll: sum,
    };
  }, [financing]);

  if (rows.length === 0) return null;
  const barColor = color ?? "#888";

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_party_top_donors_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4" />
              <span>{t("dashboard_party_top_donors")}</span>
            </div>
          </Hint>
          <div className="flex items-center gap-3">
            <span className="text-[10px] normal-case text-muted-foreground tabular-nums">
              {formatThousands(totalDonors)} {t("donors").toLowerCase()} ·{" "}
              {formatThousands(sumAll)} {t("lv")}
            </span>
            {partyNickName && totalDonors > TOP_N ? (
              <Link
                to={`/party/${partyNickName}/donors/list`}
                className="text-[10px] normal-case text-primary hover:underline"
                underline={false}
              >
                {t("dashboard_see_details")} →
              </Link>
            ) : null}
          </div>
        </div>
      }
      className="overflow-hidden"
    >
      <div className="grid grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(100px,1.5fr)_auto] gap-x-3 gap-y-1.5 items-center mt-1 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("name")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("date")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("amount")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share_of_donors")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("share")}
        </span>
        {rows.map((r, i) => (
          <div key={`${r.name}-${i}`} className="contents">
            <span className="truncate font-medium" title={r.goal}>
              {r.name}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {r.date ?? "—"}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(r.total)}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, r.barPct)}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatPct(r.pctOfAll, 2)}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
