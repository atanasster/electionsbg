import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { FinancingAgency } from "@/data/dataTypes";
import { formatThousands } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Link } from "@/ux/Link";
import { useAgencyTypeLabel } from "./financingConstants";

// Compact per-party agencies tile for the party dashboard: count + type
// breakdown + a scrollable list of contracted agencies (EIK → company page).
export const PartyAgenciesTile: FC<{
  agencies: FinancingAgency[];
  bodyMaxHeight?: string;
}> = ({ agencies, bodyMaxHeight = "22rem" }) => {
  const { t } = useTranslation();
  const typeLabel = useAgencyTypeLabel();
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agencies)
      m.set(a.type ?? "", (m.get(a.type ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [agencies]);
  if (agencies.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span>{t("financing_agencies")}</span>
          </div>
          <span className="text-[10px] normal-case tabular-nums text-muted-foreground">
            {formatThousands(agencies.length)} ·{" "}
            {byType.map(([tp, n]) => `${typeLabel(tp)} ${n}`).join(" · ")}
          </span>
        </div>
      }
      hint={t("financing_agencies_hint")}
      bodyMaxHeight={bodyMaxHeight}
    >
      <div className="mt-1 flex flex-col gap-1.5 text-sm">
        {agencies.map((a, i) => (
          <div
            key={`${a.eik ?? a.name}-${i}`}
            className="flex items-center justify-between gap-3 border-b border-border/40 pb-1 last:border-0"
          >
            <span className="min-w-0 truncate font-medium" title={a.name}>
              {a.name}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {typeLabel(a.type)}
              </span>
              {a.eik ? (
                <Link
                  to={`/company/${a.eik}`}
                  className="text-xs tabular-nums"
                  underline={false}
                >
                  {a.eik}
                </Link>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
