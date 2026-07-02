// DB-driven company officers/partners drill-down (/db/company/:eik/officers).
// Server-side paginated/sorted/filtered via DbDataTable → /api/db/table (the
// deduped `company_person_roles` matview, scoped to uic). A mass-membership
// company (743 partners) is a full page, so it gets its own table instead of
// being dumped on the company dashboard. All DB-only.

import { FC, useCallback, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { trRoleLabel } from "@/lib/trRole";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Keys are camelCased by the table engine's projection (added_at → addedAt);
// the column `id`s below stay snake_case (the server sort keys).
interface OfficerRow {
  key: string;
  uic: string;
  name: string;
  role: string | null;
  share: number | null;
  shareAmount: number | null;
  shareCurrency: string | null;
  addedAt: string | null;
  erasedAt: string | null;
  active: number;
}

const ALL = "__all__";
const num = new Intl.NumberFormat("bg-BG");
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: number | null): string =>
  s === null || s === undefined ? "—" : `${Math.round(Number(s))}%`;

export const CompanyOfficersDbScreen: FC = () => {
  const { eik = "" } = useParams();
  const { t } = useTranslation();

  const [role, setRole] = useState<string>(ALL);
  const [onlyActive, setOnlyActive] = useState(false);

  // Company name isn't on the officer rows; the breadcrumb links by EIK.
  const handleData = useCallback(() => {}, []);

  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "company_person_roles", eik],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "company_person_roles",
        scope: { col: "uic", val: eik },
        columns: ["role"],
        limit: 100,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const roleOptions = facetData?.facets?.role ?? [];

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (role !== ALL) f.push({ id: "role", value: [role] });
    if (onlyActive) f.push({ id: "active", value: 1 });
    return f;
  }, [role, onlyActive]);

  const columns = useMemo<DataTableColumnDef<OfficerRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: "Лице",
        cell: ({ row }) => (
          <Link
            to={`/person/${encodeURIComponent(row.original.name)}`}
            className="text-accent hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "role",
        accessorFn: (r) => r.role,
        header: "Роля",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {trRoleLabel(row.original.role, t)}
          </span>
        ),
      },
      {
        id: "share",
        accessorFn: (r) => r.share,
        header: "Дял",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {row.original.role === "sole_owner" && row.original.share == null
              ? "100%"
              : pct(row.original.share)}
            {row.original.shareAmount != null && (
              <span className="ml-1 text-xs text-muted-foreground/70">
                ({num.format(Number(row.original.shareAmount))}
                {row.original.shareCurrency
                  ? ` ${row.original.shareCurrency}`
                  : ""}
                )
              </span>
            )}
          </span>
        ),
      },
      {
        id: "added_at",
        accessorFn: (r) => r.addedAt,
        header: "От",
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {day(row.original.addedAt)}
          </span>
        ),
      },
      {
        id: "active",
        accessorFn: (r) => r.active,
        header: "Статус",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.active ? (
            <span className="text-emerald-600">активен</span>
          ) : (
            <span className="text-muted-foreground">
              бивш · {day(row.original.erasedAt)}
            </span>
          ),
      },
    ],
    [t],
  );

  return (
    <>
      <Title description={`Лица — ЕИК ${eik}`}>Лица (Търговски регистър)</Title>
      <section aria-label="Лица" className="w-full px-4 py-6 md:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 shrink-0" />
          <Link
            to={`/db/company/${eik}`}
            className="font-medium text-foreground hover:underline"
          >
            {`ЕИК ${eik}`}
          </Link>
        </div>

        <DbDataTable<OfficerRow>
          resource="company_person_roles"
          scope={{ col: "uic", val: eik }}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[
            { id: "active", desc: true },
            { id: "share", desc: true },
          ]}
          pageSize={50}
          searchPlaceholder="Търси лице…"
          toolbar={
            <>
              {roleOptions.length > 0 ? (
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-auto h-9 max-w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Всички роли</SelectItem>
                    {roleOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {trRoleLabel(o.value, t)} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.target.checked)}
                />
                само активни
              </label>
            </>
          }
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {t("company_officers_people") || "лица"}
            </span>
          )}
        />
      </section>
    </>
  );
};
