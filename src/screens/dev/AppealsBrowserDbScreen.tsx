// КЗК (Комисия за защита на конкуренцията) procurement-appeals browser
// (/procurement/appeals), DB-fed. A server-side DbDataTable over the whole
// kzk_appeals corpus (schema 042), the paginated sibling of the dashboard's
// RecentAppealsTile. Scoped to the section window (?pscope) by complaint date,
// same convention as the tenders browser. An appeal is a review of a procedure,
// not proof of wrongdoing — the header says so.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Gavel, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { AppealChip } from "@/screens/components/procurement/AppealChip";
import { useProcurementWindow } from "@/data/procurement/useProcurementWindow";
import {
  kzkStatusLabel,
  kzkOutcomeLabel,
  isUpheldOutcome,
} from "@/lib/kzkLabels";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatDate } from "@/lib/formatDate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AppealRow {
  complaintNo: string;
  complaintDate: string | null;
  unp: string | null;
  buyerEik: string | null;
  buyerName: string | null;
  complainant: string | null;
  subject: string | null;
  status: string | null;
  outcome: string | null;
  decisionDate: string | null;
  suspension: boolean | null;
  vmRequested: boolean | null;
  resolved: boolean;
}

const ALL = "__all__";

export const AppealsBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const { from, to, all } = useProcurementWindow();
  const lang = i18n.language;

  const [outcome, setOutcome] = useState<string>(ALL);

  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "kzk_appeals"],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = { resource: "kzk_appeals", columns: ["outcome"], limit: 20 };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const outcomeOptions = facetData?.facets?.outcome ?? [];

  // ?buyer=<eik> scopes the whole table to one contracting authority — the
  // deep-link target of the awarder page's "see all appeals" link (buyer_eik is
  // a whitelisted eq filter in the kzk_appeals registry).
  const buyerEik = params.get("buyer");

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    // Section scope (?pscope) → bound the complaint date to the window. Exclusive
    // end ≈ inclusive max, off by ≤1 day — same convention as the tenders browser.
    if (!all && from)
      f.push({ id: "complaint_date", min: from, max: to ?? undefined });
    if (outcome !== ALL) f.push({ id: "outcome", value: [outcome] });
    if (buyerEik) f.push({ id: "buyer_eik", value: buyerEik });
    return f;
  }, [all, from, to, outcome, buyerEik]);

  const columns = useMemo<DataTableColumnDef<AppealRow, unknown>[]>(
    () => [
      {
        id: "complaint_date",
        accessorFn: (r) => r.complaintDate,
        header: t("appeals_col_date") || "Filed",
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            {row.original.complaintDate
              ? formatDate(row.original.complaintDate, lang)
              : "—"}
          </div>
        ),
      },
      {
        id: "buyer_name",
        accessorFn: (r) => r.buyerName,
        header: t("company_contract_awarder") || "Awarder",
        enableSorting: false,
        cell: ({ row }) => {
          const name = decodeEntities(row.original.buyerName || "");
          // Link the buyer to its awarder page when the EIK resolved (from the
          // tender join); otherwise show the КЗК-printed respondent as plain text.
          return row.original.buyerEik ? (
            <Link
              to={`/awarder/${row.original.buyerEik}`}
              className="text-sm hover:underline"
            >
              {name || row.original.buyerEik}
            </Link>
          ) : (
            <span className="text-sm">{name || "—"}</span>
          );
        },
      },
      {
        id: "complainant",
        accessorFn: (r) => r.complainant,
        header: t("appeals_col_complainant") || "Complainant",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {decodeEntities(row.original.complainant || "") || "—"}
          </span>
        ),
      },
      {
        id: "subject",
        accessorFn: (r) => r.subject,
        header: t("company_contract_subject") || "Subject",
        enableSorting: false,
        cell: ({ row }) =>
          // Link to the procedure when the appeal resolved to a known tender.
          row.original.resolved && row.original.unp ? (
            <Link
              to={`/tenders/${row.original.unp}`}
              className="text-sm line-clamp-2 max-w-sm inline-block hover:underline"
              title={row.original.subject ?? undefined}
            >
              {decodeEntities(row.original.subject || "") || row.original.unp}
            </Link>
          ) : (
            <span className="text-sm line-clamp-2 max-w-sm inline-block">
              {decodeEntities(row.original.subject || "") || "—"}
            </span>
          ),
      },
      {
        id: "status",
        header: t("appeals_col_status") || "Status",
        enableSorting: false,
        cell: ({ row }) => {
          const o = row.original.outcome;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {row.original.suspension ? <AppealChip suspended /> : null}
              {o ? (
                <AppealChip
                  tone={isUpheldOutcome(o) ? "red" : "muted"}
                  label={kzkOutcomeLabel(o, lang)}
                />
              ) : row.original.status ? (
                <span className="text-xs text-muted-foreground">
                  {kzkStatusLabel(row.original.status, lang)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
    ],
    [t, lang],
  );

  return (
    <>
      <Title
        description={
          t("appeals_desc") ||
          "КЗК (Комисия за защита на конкуренцията) public-procurement appeals, joined to the tender corpus by УНП"
        }
      >
        {t("appeals_title") || "Procurement appeals (КЗК)"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_appeals_nav"
        scopeMode="toggle"
      />
      {/* Literal slug (not localized) — the OG capture harness + sibling DB
          screens key on `aria-label="appeals"`; a t()'d label breaks capture. */}
      <section aria-label="appeals" className="my-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Gavel className="h-4 w-4 shrink-0 text-amber-600" />
          {t("appeals_feed_hint") ||
            "Appeals to the CPC (КЗК) — a review of the procedure, not proof of wrongdoing."}
          <a
            href="https://reg.cpc.bg/AllComplaints.aspx?dt=2"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            {t("appeals_feed_register") || "КЗК register"}
            <ExternalLink className="h-3 w-3" />
          </a>
          {/* A scoped date window excludes appeals with no filing date (SQL range
              predicates drop NULLs) — say so rather than silently hiding them. */}
          {!all && from ? (
            <span className="text-muted-foreground/70">
              {t("appeals_scope_note") ||
                'Scoped to the selected period; undated appeals appear only under "all years".'}
            </span>
          ) : null}
        </div>

        <DbDataTable<AppealRow>
          resource="kzk_appeals"
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "complaint_date", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("appeals_search_ph") ||
            "Търси по възложител, жалбоподател или предмет…"
          }
          toolbar={
            outcomeOptions.length > 0 ? (
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="w-auto h-9 max-w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("appeals_all_outcomes") || "Всички изходи"}
                  </SelectItem>
                  {outcomeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {kzkOutcomeLabel(o.value, lang)} ({o.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null
          }
          renderAggregates={(_agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {exact ? "" : "≈"}
                {total.toLocaleString("bg-BG")}
              </span>{" "}
              {t("appeals_word") || "жалби"}
            </span>
          )}
        />
      </section>
    </>
  );
};
