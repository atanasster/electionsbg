// Composition strip: five role counts (mayor / deputy mayor / council chair
// / councillor / chief architect) read straight from shard.byRole — no
// iteration over the entries array.
//
// Shares the queryKey with the Mayor and Roster tiles; the React Query
// cache returns the same shard without a second network fetch.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import type { MunicipalOfficialRole } from "@/data/dataTypes";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

const ROLE_KEYS: readonly {
  role: Exclude<MunicipalOfficialRole, "other">;
  i18n: string;
  fallback: string;
}[] = [
  { role: "mayor", i18n: "municipal_role_mayor", fallback: "Mayor" },
  {
    role: "deputy_mayor",
    i18n: "municipal_role_deputy_mayor",
    fallback: "Deputy mayors",
  },
  {
    role: "council_chair",
    i18n: "municipal_role_council_chair",
    fallback: "Council chair",
  },
  {
    role: "councillor",
    i18n: "municipal_role_councillor",
    fallback: "Councillors",
  },
  {
    role: "chief_architect",
    i18n: "municipal_role_chief_architect",
    fallback: "Chief architect",
  },
] as const;

export const MunicipalCouncilCompositionTile: FC<Props> = ({
  obshtinaCode,
  className,
}) => {
  const { t } = useTranslation();
  const { roster } = useMunicipalOfficials(obshtinaCode);

  // For obshtini that aggregate districts into a single shard (Plovdiv PDV22,
  // Varna VAR06), the Composition tile shows the city-wide counts only —
  // an aggregate "7 mayors" reads wrong for a municipality. A footnote
  // surfaces the cross-район total so the data isn't hidden.
  const { cityCounts, districtTotal, hasDistricts } = useMemo(() => {
    const empty: Record<Exclude<MunicipalOfficialRole, "other">, number> = {
      mayor: 0,
      deputy_mayor: 0,
      council_chair: 0,
      councillor: 0,
      chief_architect: 0,
    };
    if (!roster) {
      return { cityCounts: empty, districtTotal: 0, hasDistricts: false };
    }
    const cw = { ...empty };
    let districts = 0;
    for (const e of roster.entries) {
      if (e.district) {
        districts++;
        continue;
      }
      if (e.role === "other") continue;
      cw[e.role]++;
    }
    return {
      cityCounts: cw,
      districtTotal: districts,
      hasDistricts: districts > 0,
    };
  }, [roster]);

  if (!roster) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {t("dashboard_municipal_composition_title") ||
              "Local government composition"}
          </span>
        </div>
      }
    >
      <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ROLE_KEYS.map(({ role, i18n, fallback }) => {
          const count = cityCounts[role];
          if (count === 0) return null;
          return (
            <div key={role} className="flex flex-col">
              <span className="text-2xl font-semibold tabular-nums leading-tight">
                {count}
              </span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                {t(i18n) || fallback}
              </span>
            </div>
          );
        })}
      </div>
      {hasDistricts ? (
        <div className="mt-3 pt-2 border-t text-[11px] text-muted-foreground">
          {t("dashboard_municipal_composition_districts_note", {
            count: districtTotal,
            defaultValue:
              "+ {{count}} officials across district administrations",
          })}
        </div>
      ) : null}
    </StatCard>
  );
};
