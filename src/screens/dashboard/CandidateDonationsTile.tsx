import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { FinancingFromCandidates } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

const TOP_N = 10;

type CandidateDonation = Omit<FinancingFromCandidates, "name">;

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | undefined]
>): Promise<CandidateDonation[] | null> => {
  if (!queryKey[1] || !queryKey[2]) return null;
  const response = await fetch(
    `/${queryKey[1]}/candidates/${queryKey[2]}/donations.json`,
  );
  if (!response.ok) return null;
  return response.json();
};

type Props = { name: string; linkSlug?: string };

export const CandidateDonationsTile: FC<Props> = ({ name, linkSlug }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["candidate_donations_tile", selected, name],
    queryFn,
  });

  const summary = useMemo(() => {
    if (!data?.length) return undefined;
    const monetary = data.reduce((s, d) => s + (d.monetary ?? 0), 0);
    const nonMonetary = data.reduce((s, d) => s + (d.nonMonetary ?? 0), 0);
    const total = monetary + nonMonetary;
    const sorted = [...data]
      .map((d) => ({
        ...d,
        amount: (d.monetary ?? 0) + (d.nonMonetary ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_N);
    const maxAmount = sorted[0]?.amount ?? 1;
    return {
      monetary,
      nonMonetary,
      total,
      count: data.length,
      rows: sorted.map((d) => ({
        ...d,
        barPct: (d.amount / maxAmount) * 100,
      })),
    };
  }, [data]);

  if (!summary) return null;
  const candidateSlug = linkSlug ?? encodeURIComponent(name);

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_candidate_donations_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              <span>{t("donations")}</span>
            </div>
          </Hint>
          {summary.count > TOP_N ? (
            <Link
              to={`/candidate/${candidateSlug}/donations`}
              className="text-[10px] normal-case text-primary hover:underline"
              underline={false}
            >
              {t("dashboard_see_details")} →
            </Link>
          ) : null}
        </div>
      }
      className="overflow-hidden"
    >
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-2xl font-bold tabular-nums">
          {formatThousands(summary.total)} {t("lv")}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {summary.count} {t("donations").toLowerCase()}
        </span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatThousands(summary.monetary)} {t("monetary").toLowerCase()} ·{" "}
        {formatThousands(summary.nonMonetary)} {t("non_monetary").toLowerCase()}
      </div>
      <div className="grid grid-cols-[auto_minmax(80px,1.5fr)_auto_auto] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("date")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("monetary")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
          {t("non_monetary")}
        </span>
        {summary.rows.map((d, i) => (
          <div key={`don_${i}`} className="contents">
            <span className="text-xs tabular-nums text-muted-foreground">
              {d.date ?? "—"}
            </span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, d.barPct)}%` }}
              />
            </div>
            <span className="tabular-nums text-xs font-semibold text-right">
              {formatThousands(d.monetary)}
            </span>
            <span className="tabular-nums text-xs text-muted-foreground text-right">
              {formatThousands(d.nonMonetary)}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
