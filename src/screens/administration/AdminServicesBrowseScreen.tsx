// /sector/administration/services — the Административен регистър (ИИСДА)
// services catalogue, DB-fed. A server-side paginated/sorted/filtered
// DbDataTable over the admin_services table (migration 068), searchable by
// service name and faceted by provider tier. Each row links out to the
// service's page in the official register.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

const TIER_LABEL: Record<string, { bg: string; en: string }> = {
  central: { bg: "Централни", en: "Central" },
  special_territorial: {
    bg: "Специализирани териториални",
    en: "Specialised territorial",
  },
  regional: { bg: "Областни", en: "Regional" },
  municipal: { bg: "Общински", en: "Municipal" },
};

interface ServiceRow {
  id: number;
  serviceId: string;
  name: string;
  tier: string;
}

export const AdminServicesBrowseScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [tier, setTier] = useState<string>(ALL);

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => (tier !== ALL ? [{ id: "tier", value: [tier] }] : []),
    [tier],
  );

  const columns = useMemo<DataTableColumnDef<ServiceRow, unknown>[]>(
    () => [
      {
        id: "service_id",
        accessorFn: (r) => r.serviceId,
        enableSorting: false, // opaque register id — lexicographic sort is meaningless
        header: bg ? "№" : "No.",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.serviceId}
          </span>
        ),
      },
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Услуга" : "Service",
        cell: ({ row }) => (
          <a
            href={`https://iisda.government.bg/adm_services/services/service/${row.original.serviceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm hover:text-primary hover:underline"
          >
            {row.original.name}
          </a>
        ),
      },
      {
        id: "tier",
        accessorFn: (r) => r.tier,
        header: bg ? "Ниво" : "Tier",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {TIER_LABEL[row.original.tier]?.[bg ? "bg" : "en"] ??
              row.original.tier}
          </span>
        ),
      },
    ],
    [bg],
  );

  const title = bg ? "Административни услуги" : "Administrative services";
  const description = bg
    ? "Пълният регистър на административните услуги (ИИСДА) — търси по име, филтрирай по вид на предоставящата администрация. Всеки ред води към услугата в официалния регистър."
    : "The full administrative-services register (IISDA) — search by name, filter by provider tier. Each row links to the service in the official register.";

  return (
    <div className="space-y-4">
      <Title description={description}>{title}</Title>
      <SectorBreadcrumb currentKey="sector_admin_title" />

      <DbDataTable<ServiceRow>
        resource="admin_services"
        columns={columns}
        extraFilters={extraFilters}
        defaultSort={[{ id: "name", desc: false }]}
        pageSize={25}
        searchPlaceholder={bg ? "Търси услуга…" : "Search service…"}
        renderAggregates={(_agg, total, exact) => (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ListChecks className="h-4 w-4" aria-hidden />
            {exact ? "" : "~"}
            {new Intl.NumberFormat(bg ? "bg-BG" : "en-US").format(total)}{" "}
            {bg ? "услуги" : "services"}
          </span>
        )}
        toolbar={
          <Select value={tier} onValueChange={setTier}>
            <SelectTrigger className="h-9 w-auto max-w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {bg ? "Всички нива" : "All tiers"}
              </SelectItem>
              {Object.entries(TIER_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {bg ? v.bg : v.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
};
