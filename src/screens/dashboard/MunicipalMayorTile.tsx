// Single-stat tile: shows the obshtina's mayor (if declared), with the
// count of deputy mayors and the council chair name below. Pulls the
// per-obshtina shard via useMunicipalOfficials — shared queryKey with the
// Composition and Roster tiles on the same page, so React Query dedupes
// the three tiles to one fetch.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Crown, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

export const MunicipalMayorTile: FC<Props> = ({ obshtinaCode, className }) => {
  const { t } = useTranslation();
  const { roster } = useMunicipalOfficials(obshtinaCode);

  // For obshtini that aggregate districts into a single shard (Plovdiv PDV22,
  // Varna VAR06), each район also has a mayor — pick the city-wide one (no
  // `district` tag) when available, fall back to whichever the sort placed
  // first. Same logic for the council chair.
  const mayor = useMemo(() => {
    if (!roster) return null;
    const mayors = roster.entries.filter((e) => e.role === "mayor");
    return mayors.find((e) => !e.district) ?? mayors[0] ?? null;
  }, [roster]);
  const chair = useMemo(() => {
    if (!roster) return null;
    const chairs = roster.entries.filter((e) => e.role === "council_chair");
    return chairs.find((e) => !e.district) ?? chairs[0] ?? null;
  }, [roster]);

  // Deputy count, ditto — the city-wide deputies are the ones without a
  // район tag. Falls back to the byRole total for single-район-free shards
  // where the filter would needlessly zero out the count.
  const deputies = useMemo(() => {
    if (!roster) return 0;
    const cityWide = roster.entries.filter(
      (e) => e.role === "deputy_mayor" && !e.district,
    ).length;
    return cityWide > 0 ? cityWide : roster.byRole.deputy_mayor;
  }, [roster]);

  if (!roster) return null;
  const year = roster.years[0];

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Crown className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("dashboard_municipal_mayor_title") || "Mayor"}
            </span>
          </div>
          {mayor ? (
            <Link
              to={`/officials/${mayor.slug}?from=${obshtinaCode}`}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
            >
              {t("dashboard_see_details") || "See details"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      }
    >
      {mayor ? (
        <div className="mt-1">
          <Link
            to={`/officials/${mayor.slug}?from=${obshtinaCode}`}
            className="text-base font-semibold leading-tight hover:underline"
          >
            {mayor.name}
          </Link>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("dashboard_municipal_mayor_caption", {
              deputies,
              year,
              defaultValue: "{{deputies}} deputy mayor(s), declared {{year}}",
            })}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted-foreground">
          {t("dashboard_municipal_mayor_missing") ||
            "Mayor not in the current declaration year"}
        </div>
      )}
      {chair ? (
        <div className="mt-3 pt-2 border-t text-[11px] text-muted-foreground">
          <div className="uppercase tracking-wide">
            {t("municipal_role_council_chair") || "Council chair"}
          </div>
          <Link
            to={`/officials/${chair.slug}?from=${obshtinaCode}`}
            className="text-sm text-foreground hover:underline"
          >
            {chair.name}
          </Link>
        </div>
      ) : null}
    </StatCard>
  );
};
