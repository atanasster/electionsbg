// Dashboard tile: top public officials (non-MP political class — cabinet,
// governors, mayors, deputy-mayors, councillors, …) ranked by total
// procurement awarded to their connected companies. Per-NS by default
// (reflects the selected parliament's term). Sibling of TopMpsTile; "See all"
// links to the /procurement/people scanner where officials are searchable.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  ProcurementByNsFile,
  ProcurementByNsTopOfficial,
} from "@/data/dataTypes";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";

const TOP_ROWS = 10;

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

// Map a canonical role slug (e.g. "mayor", "agency_head", "councillor") to a
// localized label via the shared official_role_* key family; fall back to the
// de-slugged role when no translation exists. Same convention as
// CompanyOfficialsTile.
const roleLabel = (role: string, t: (k: string) => string): string => {
  if (!role) return "";
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

const renderOfficials = (
  rows: ProcurementByNsTopOfficial[],
  t: (k: string) => string,
) => (
  <div className="flex flex-col">
    {rows.map((e, idx) => (
      <div
        key={e.slug}
        className="text-sm flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0"
      >
        <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums text-xs">
          {idx + 1}
        </span>
        <Link
          to={`/officials/${e.slug}`}
          className="font-medium hover:underline inline-flex items-center gap-2 min-w-0 flex-1"
        >
          <Landmark className="h-4 w-4 text-teal-600 shrink-0" />
          <span className="min-w-0">
            <span className="truncate block">{e.name}</span>
            {e.topContractorNames.length > 0 ? (
              <span className="text-xs text-muted-foreground truncate block">
                {e.topContractorNames.join(", ")}
              </span>
            ) : null}
          </span>
        </Link>
        {e.role ? (
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
            {roleLabel(e.role, t)}
          </span>
        ) : null}
        <span className="tabular-nums shrink-0 min-w-[70px] text-right font-medium">
          €{formatEur.format(Math.round(e.totalEur))}
        </span>
        <span className="text-muted-foreground tabular-nums shrink-0 text-xs w-6 text-right hidden md:inline">
          {e.contractorCount}
        </span>
      </div>
    ))}
  </div>
);

export const TopOfficialsTile: FC<{
  data?: ProcurementByNsFile | null;
}> = ({ data: dataProp }) => {
  const { t } = useTranslation();
  const q = useProcurementByNs(dataProp === undefined);
  const data = dataProp !== undefined ? dataProp : q.data;
  const isLoading = dataProp !== undefined ? false : q.isLoading;

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[440px]" />
        </CardContent>
      </Card>
    );
  }
  if (!data || !data.topOfficials || data.topOfficials.length === 0)
    return null;
  const rows = data.topOfficials.slice(0, TOP_ROWS);

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Landmark className="h-4 w-4 text-teal-600" />
          {t("procurement_top_officials") ||
            "Top officials by connected procurement"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("procurement_top_officials_subtitle") ||
              "Public officials whose declared business interests received the most procurement in the period."}
          </span>
          <Link
            to="/procurement/people"
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("procurement_tile_see_all") || "See all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {renderOfficials(rows, t)}
      </CardContent>
    </Card>
  );
};
