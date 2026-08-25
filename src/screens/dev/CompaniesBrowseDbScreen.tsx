// General company registry browser (/companies) — a server-side paginated/sorted/filtered
// DbDataTable over company_browse_table (188), the FULL Commerce Registry corpus (~1.02M
// rows). Supersedes /governance/companies (OfficialCompaniesScreen, retired): "linked to a
// person in public life" is now one toggle (`?political=1`) on this wider browse instead of a
// separate page and a separate matview. Plan: docs/plans/company-browse-dashboard-v1.md.
//
// The `has_signal` default-view floor is applied CLIENT-SIDE (an explicit extraFilters entry),
// the same shape NgoBrowseDbScreen.tsx uses for its own has_signal column — the resource
// declares no server-side default, so "show all" is simply omitting the filter rather than
// overriding one.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatEurCompact } from "@/lib/currency";

const ALL = "__all__";

/** One row of the `companies` registry resource (functions/db_table.js). */
export type CompanyBrowseRow = {
  uic: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  entityClass: string | null;
  oblastName: string | null;
  obshtinaCode: string | null;
  publicMoneyEur: number | string | null;
  contractorTotalEur: number | string | null;
  contractCount: number | null;
  isMpTied: boolean;
  personCount: number;
  hasRegistryLink: boolean;
  hasDeclaredStake: boolean;
  hasCurrentRole: boolean;
  isOfficialLinked: boolean;
  hasSignal: boolean;
};

const STATUS_CLASSES: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  in_liquidation:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  bankrupt: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  ceased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  erased: "bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const Chip: FC<{ tone: string; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
  >
    {children}
  </span>
);

export const CompaniesBrowseDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [params, setParams] = useSearchParams();

  // `?political=1` is the redirect target /governance/companies retired to — read it once on
  // mount as the initial toggle state, same as `initialSearch` below reads `?q` once.
  const [political, setPolitical] = useState(params.get("political") === "1");
  const [entityClass, setEntityClass] = useState<string>(ALL);
  const [showAll, setShowAll] = useState(false);

  const togglePolitical = (v: boolean) => {
    setPolitical(v);
    const next = new URLSearchParams(params);
    if (v) next.set("political", "1");
    else next.delete("political");
    setParams(next, { replace: true });
  };

  const fixedFilters = useMemo<DbColumnFilter[]>(() => [], []);
  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    // The default-view floor (money/political-link/contractor/NGO) — omitted entirely, never
    // sent as `false`, when the reader asks to see every company. Same shape `ngos`' showAll
    // toggle uses.
    if (!showAll) f.push({ id: "has_signal", value: true });
    if (political) f.push({ id: "is_official_linked", value: true });
    if (entityClass !== ALL)
      f.push({ id: "entity_class", value: [entityClass] });
    return f;
  }, [showAll, political, entityClass]);

  const columns = useMemo<DataTableColumnDef<CompanyBrowseRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("oc_col_company") || "Фирма",
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0">
              <Link
                to={`/company/${c.uic}`}
                className="font-medium hover:text-primary hover:underline"
              >
                {decodeEntities(c.name ?? c.uic)}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{c.uic}</span>
                {/* Projected, not merely filterable: ~3% of the corpus are сдружения,
                    читалища, фондации, кооперации or държавни предприятия, and calling
                    them all „фирми" makes a different and wrong claim about each. */}
                {c.entityClass && c.entityClass !== "company" && (
                  <span>{t(`oc_kind_${c.entityClass}`, c.entityClass)}</span>
                )}
                {c.legalForm && <span>{c.legalForm}</span>}
                {c.status && (
                  <Chip
                    tone={STATUS_CLASSES[c.status] ?? STATUS_CLASSES.active}
                  >
                    {t(`tr_status_${c.status}`, c.status)}
                  </Chip>
                )}
                {c.seat && <span className="truncate">{c.seat}</span>}
              </div>
            </div>
          );
        },
      },
      {
        id: "evidence",
        enableSorting: false,
        header: t("oc_col_evidence") || "Основание",
        cell: ({ row }) => {
          const c = row.original;
          if (!c.isOfficialLinked)
            return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {c.hasRegistryLink && (
                <Chip tone="bg-primary/10 text-primary">
                  {t("oc_evidence_registry")}
                </Chip>
              )}
              {c.hasDeclaredStake && (
                <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                  {t("oc_evidence_declared")}
                </Chip>
              )}
              {/* The one chip that is a NEGATIVE: without it a company whose every
                  registry filing has been withdrawn reads as a current attachment. */}
              {c.hasRegistryLink && !c.hasCurrentRole && (
                <Chip tone="bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  {t("oc_evidence_former")}
                </Chip>
              )}
            </div>
          );
        },
      },
      {
        id: "oblast_name",
        accessorFn: (r) => r.oblastName,
        enableSorting: false,
        header: t("oc_col_oblast") || "Област",
        cell: ({ row }) => row.original.oblastName ?? "—",
      },
      {
        id: "contract_count",
        accessorFn: (r) => r.contractCount,
        header: t("companies_col_contracts") || "Поръчки",
        meta: { align: "right" },
        cell: ({ row }) => {
          const c = row.original;
          if (!c.contractCount) return <span>—</span>;
          return (
            <span className="tabular-nums">
              {c.contractCount.toLocaleString("bg-BG")}
              {Number(c.contractorTotalEur ?? 0) > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  (
                  {formatEurCompact(
                    Number(c.contractorTotalEur),
                    i18n.language,
                  )}
                  )
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "public_money_eur",
        accessorFn: (r) => r.publicMoneyEur,
        header: t("oc_col_money") || "Публични средства",
        meta: { align: "right" },
        cell: ({ row }) =>
          Number(row.original.publicMoneyEur ?? 0) > 0
            ? formatEurCompact(
                Number(row.original.publicMoneyEur),
                i18n.language,
              )
            : "—",
      },
    ],
    [t, i18n.language],
  );

  return (
    /* data-og is the anchor scripts/og/capture-screens.ts screenshots (slug
       "official-companies", carried over from the retired /governance/companies page — same
       share-card identity, wider scope). Without it the capture times out on its waitFor and
       silently keeps serving the old card. */
    <div className="w-full px-4 md:px-8 pb-12" data-og="official-companies-og">
      <Title description={t("companies_browse_subtitle") || undefined}>
        {t("companies_browse_title") || "Фирми"}
      </Title>
      <GovernanceBreadcrumb
        sectionKey="companies_browse_title"
        sectionTo="/companies"
      />

      <p className="my-3 flex items-start gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{t("companies_browse_intro")}</span>
      </p>

      <DbDataTable<CompanyBrowseRow>
        resource="companies"
        fixedFilters={fixedFilters}
        extraFilters={extraFilters}
        columns={columns}
        defaultSort={[{ id: "public_money_eur", desc: true }]}
        pageSize={25}
        initialSearch={params.get("q") ?? ""}
        searchPlaceholder={
          t("companies_browse_search") || "Търси фирма или ЕИК…"
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={entityClass} onValueChange={setEntityClass}>
              <SelectTrigger className="h-9 w-auto max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  {bg ? "Всички видове" : "All entity types"}
                </SelectItem>
                {[
                  "company",
                  "ngo_assoc",
                  "ngo_found",
                  "chitalishte",
                  "coop",
                  "state_enterprise",
                  "foreign_branch",
                ].map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`oc_kind_${c}`, c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={political}
                onChange={(e) => togglePolitical(e.target.checked)}
              />
              {t("companies_filter_political") || "Свързана с публично лице"}
            </label>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="h-9 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              {showAll
                ? bg
                  ? "Само със значение"
                  : "Only with a signal"
                : bg
                  ? "Покажи всички"
                  : "Show all"}
            </button>
          </div>
        }
        renderAggregates={(footerAgg, total) => (
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {formatEurCompact(
                Number(footerAgg.sumPublicMoneyEur ?? 0),
                i18n.language,
              )}
            </span>{" "}
            {t("oc_agg_over") || "за"}{" "}
            <span className="tabular-nums">
              {Number(total ?? 0).toLocaleString("bg-BG")}
            </span>{" "}
            {t("oc_agg_companies") || "фирми"}
          </span>
        )}
      />
    </div>
  );
};

export default CompaniesBrowseDbScreen;
