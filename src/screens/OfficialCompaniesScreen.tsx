// /governance/companies — companies a person in public life is attached to.
//
// Replaces /mp/companies, and changes two things at once:
//
//   • THE POPULATION. 17,608 companies against the retired page's 2,969, because it is no
//     longer MPs-only: ministers, deputy ministers, mayors, councillors, magistrates and
//     regulators are in it, and MPs are a minority. Nothing here may say „депутати".
//   • WHERE THE ROWS COME FROM. The retired page fetched a 4.16 MB JSON index and filtered it
//     in the browser. This is a server-side DbDataTable over `official_companies` (178), on
//     the gated person layer — a name the Commerce Registry says belongs to more than one
//     human is REFUSED rather than graded, the same set /person and /company already publish.
//
// Plan: docs/plans/company-page-consolidation-v1.md (Tier 3).
//
// ⚠️ THE EVIDENCE COLUMN IS NOT DECORATION. A company reaches this list two ways and they are
// different claims: the registry records the person there, or their own Court-of-Audit filing
// says so and 096 confirmed it. And 2,342 of them rest ENTIRELY on WITHDRAWN registry
// filings — a former directorship, which is a real fact and must not be printed in the
// present tense. `has_current_role` is what keeps that honest, so the chips are load-bearing.

import { FC, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatEur } from "@/lib/currency";

/** One row of the `official_companies` registry resource (functions/db_table.js). */
export type OfficialCompanyRow = {
  uic: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string | null;
  /** company | ngo_assoc | ngo_found | chitalishte | coop | state_enterprise. */
  entityClass: string | null;
  oblastName: string | null;
  personCount: number;
  hasRegistryLink: boolean;
  hasDeclaredStake: boolean;
  hasCurrentRole: boolean;
  moneyEur: number;
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

export const OfficialCompaniesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const [declaredOnly, setDeclaredOnly] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(false);
  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (declaredOnly) f.push({ id: "has_declared_stake", value: true });
    if (currentOnly) f.push({ id: "has_current_role", value: true });
    return f;
  }, [declaredOnly, currentOnly]);

  const columns = useMemo<DataTableColumnDef<OfficialCompanyRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("oc_col_company") || "Фирма",
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="min-w-0">
              <CompanyLink eik={c.uic} className="font-medium">
                {decodeEntities(c.name ?? c.uic)}
              </CompanyLink>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{c.uic}</span>
                {/* ⚠️ 5,200 of 17,608 rows are NOT companies — 3,269 сдружения, 1,551
                    читалища, 348 фондации, 17 държавни предприятия (€1.07bn) and 15
                    кооперации. „Сдружение Български Червен кръст" rendered as an
                    office-holder's ФИРМА is a different and wrong claim, so the kind is
                    printed rather than assumed. */}
                {c.entityClass && c.entityClass !== "company" && (
                  <span>{t(`oc_kind_${c.entityClass}`)}</span>
                )}
                {c.legalForm && <span>{c.legalForm}</span>}
                {c.status && (
                  <Chip
                    tone={STATUS_CLASSES[c.status] ?? STATUS_CLASSES.active}
                  >
                    {t(`tr_status_${c.status}`)}
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
              {/* ⚠️ The one chip that is a NEGATIVE, and the reason it exists: without it
                  2,342 companies whose every registry filing has been withdrawn would read
                  as current attachments. /person already renders the same pair as former. */}
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
        id: "person_count",
        accessorFn: (r) => r.personCount,
        header: t("oc_col_people") || "Лица",
        meta: { align: "right" },
        cell: ({ row }) => row.original.personCount.toLocaleString("bg-BG"),
      },
      {
        id: "oblast_name",
        accessorFn: (r) => r.oblastName,
        enableSorting: false,
        header: t("oc_col_oblast") || "Област",
        cell: ({ row }) => row.original.oblastName ?? "—",
      },
      {
        id: "money_eur",
        accessorFn: (r) => r.moneyEur,
        header: t("oc_col_money") || "Публични средства",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.moneyEur > 0
            ? formatEur(row.original.moneyEur, i18n.language)
            : "—",
      },
    ],
    [t, i18n.language],
  );

  return (
    /* data-og is the anchor scripts/og/capture-screens.ts screenshots. The retired screen
       carried it; without it the capture times out on its waitFor and SILENTLY keeps serving
       the old MP-avatar share card. The slug is renamed alongside the URL in Tier 3.4 — both
       ends move together or the capture breaks the other way. */
    <div className="w-full px-4 md:px-8 pb-12" data-og="mp-companies-og">
      <Title description="Companies in which a Bulgarian public office-holder is an owner, officer, or declared stakeholder.">
        {t("oc_title") || "Фирми, свързани с лица на публична длъжност"}
      </Title>
      {/* currentKey, not current: `current` is an already-resolved LABEL, so passing an
          i18n key there prints the key. */}
      <DeclarationsBreadcrumb currentKey="oc_title" />

      <p className="my-3 flex items-start gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{t("oc_intro")}</span>
      </p>

      <DbDataTable<OfficialCompanyRow>
        resource="official_companies"
        extraFilters={extraFilters}
        columns={columns}
        defaultSort={[{ id: "money_eur", desc: true }]}
        pageSize={25}
        initialSearch={params.get("q") ?? ""}
        searchPlaceholder={t("oc_search") || "Търси фирма или ЕИК…"}
        toolbar={
          <>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={declaredOnly}
                onChange={(e) => setDeclaredOnly(e.target.checked)}
              />
              {t("oc_filter_declared")}
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={currentOnly}
                onChange={(e) => setCurrentOnly(e.target.checked)}
              />
              {t("oc_filter_current")}
            </label>
          </>
        }
        /* ⚠️ THE VALUES COME FROM THE ARGUMENTS, NOT FROM STATE. buildAggSelect aliases
           every aggregate in camelCase (`sum${Camel}`), so the snake_case
           `aggregates.sum_money_eur` this first read was ALWAYS undefined and the footer
           reported €0 against a true €12.18bn. Mirroring it into useState via onData also
           put a one-frame „€0 в 0 фирми" on every load. */
        renderAggregates={(footerAgg, total) => (
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {formatEur(Number(footerAgg.sumMoneyEur ?? 0), i18n.language)}
            </span>{" "}
            {t("oc_agg_over")}{" "}
            <span className="tabular-nums">
              {Number(total ?? 0).toLocaleString("bg-BG")}
            </span>{" "}
            {t("oc_agg_companies")}
          </span>
        )}
      />

      <p className="mt-4 text-xs text-muted-foreground">{t("oc_footnote")}</p>
    </div>
  );
};
