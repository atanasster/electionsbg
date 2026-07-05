import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LucideIcon, Users } from "lucide-react";
import { DonorPartyStat } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PartyChip } from "./financingShared";

// Donor concentration per party, sorted most-concentrated first (the
// whale-funded vs grassroots spectrum). Compact single-line rows. Reused for
// candidate-donation concentration via title/icon/hint/countKey props.
export const DonorConcentration: FC<{
  stats: DonorPartyStat[];
  bodyMaxHeight?: string;
  title?: string;
  icon?: LucideIcon;
  hint?: string;
  countKey?: string;
}> = ({
  stats,
  bodyMaxHeight,
  title,
  icon: Icon = Users,
  hint,
  countKey = "financing_n_donors",
}) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  // Sort by total raised (biggest first) — sorting by concentration % floats
  // trivial single-donor parties (100%) to the top, which reads as illogical.
  const rows = useMemo(
    () =>
      [...stats].sort(
        (a, b) => b.monetary + b.nonMonetary - (a.monetary + a.nonMonetary),
      ),
    [stats],
  );
  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span>{title ?? t("financing_donor_concentration")}</span>
        </div>
      }
      hint={hint ?? t("financing_donor_concentration_hint")}
      bodyMaxHeight={bodyMaxHeight}
    >
      <div className="mt-1 grid grid-cols-[minmax(0,auto)_auto] items-center gap-x-3 gap-y-2 text-sm sm:grid-cols-[minmax(0,auto)_minmax(60px,1fr)_auto]">
        {rows.map((s) => (
          <div key={s.party} className="contents">
            <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              <PartyChip party={findParty(s.party)} />
              <span className="text-[11px] text-muted-foreground">
                {t(countKey, { n: s.donors })} ·{" "}
                {formatEur(s.monetary + s.nonMonetary, i18n.language)}
              </span>
            </span>
            <div className="relative hidden h-2 overflow-hidden rounded-full bg-muted sm:block">
              {/* top-5 share fill, with the top-1 share as a darker inset */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/40"
                style={{ width: `${s.top5Pct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${s.top1Pct}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-right text-xs tabular-nums">
              {t("financing_top5_share", { pct: s.top5Pct })}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
