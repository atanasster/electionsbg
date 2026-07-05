import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LucideIcon, Trophy } from "lucide-react";
import { TopDonor } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Link } from "@/ux/Link";
import { PartyChip } from "./financingShared";

// National top-donor leaderboard. Compact single-line rows matching the
// per-party PartyTopDonorsTile: rank · name · amount · share bar · party chip.
// Reused for candidate-donors via title/icon/hint props.
export const TopDonorsLeaderboard: FC<{
  donors: TopDonor[];
  limit?: number;
  totalDonors?: number;
  totalAmount?: number;
  bodyMaxHeight?: string;
  title?: string;
  icon?: LucideIcon;
  hint?: string;
  // When provided, the name links to this URL (e.g. a candidate's page). Return
  // undefined for a row to leave it plain text.
  nameHref?: (d: TopDonor) => string | undefined;
}> = ({
  donors,
  limit = 20,
  totalDonors,
  totalAmount,
  bodyMaxHeight,
  title,
  icon: Icon = Trophy,
  hint,
  nameHref,
}) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const rows = useMemo(() => {
    const top = donors.slice(0, limit);
    const max = top[0] ? top[0].monetary + top[0].nonMonetary : 1;
    return top.map((d) => {
      const total = d.monetary + d.nonMonetary;
      return { ...d, total, barPct: max > 0 ? (100 * total) / max : 0 };
    });
  }, [donors, limit]);
  if (rows.length === 0) return null;

  const headCls =
    "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <StatCard
      label={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span>{title ?? t("financing_top_donors")}</span>
          </div>
          {totalDonors !== undefined ? (
            <span className="text-[10px] normal-case tabular-nums text-muted-foreground">
              {t("financing_n_donors", { n: totalDonors })}
              {totalAmount !== undefined
                ? ` · ${formatEur(totalAmount, i18n.language)}`
                : ""}
            </span>
          ) : null}
        </div>
      }
      hint={hint ?? t("financing_top_donors_hint")}
      bodyMaxHeight={bodyMaxHeight}
    >
      <div className="mt-1 grid grid-cols-[auto_minmax(0,1.4fr)_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(70px,1.3fr)_auto]">
        <span />
        <span className={headCls}>{t("name")}</span>
        <span className={`${headCls} text-right`}>{t("amount")}</span>
        <span className={`hidden sm:inline ${headCls}`}>
          {t("dashboard_share_of_donors")}
        </span>
        <span className={`${headCls} text-right`}>{t("party")}</span>
        {rows.map((d, i) => {
          const barColor = findParty(d.parties[0])?.color ?? "#888";
          const href = nameHref?.(d);
          return (
            <div key={`${d.name}-${i}`} className="contents">
              <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              {href ? (
                <Link
                  to={href}
                  className="block truncate font-medium hover:underline"
                  underline={false}
                >
                  {d.name}
                </Link>
              ) : (
                <span className="truncate font-medium">{d.name}</span>
              )}
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {formatEur(d.total, i18n.language)}
              </span>
              <div className="hidden h-2 overflow-hidden rounded-full bg-muted sm:block">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, d.barPct)}%`,
                    backgroundColor: barColor,
                  }}
                />
              </div>
              <span className="flex justify-end gap-1">
                {d.parties.map((p) => (
                  <PartyChip key={p} party={findParty(p)} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
