// Tender-stage procedures browser (/procurement/tenders), DB-fed. A server-side
// DbDataTable over the whole `tenders` corpus (ЦАИС ЕОП), replacing the per-year
// JSON shards. Values are ESTIMATED (forecast at announcement), never spend — the
// header says so. Curated topic deep-links (?topic=guardrails, the "мантинели за
// 1 млрд" case) prefilter the subject by the topic's keyword and show its label.
// See docs/plans/postgres-migration-v1.md.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { getSectorBrowsePack } from "@/screens/components/procurement/sectorPacks";
import { SectorBrowseSlot } from "@/screens/components/procurement/SectorBrowseSlot";
import { AppealChip } from "@/screens/components/procurement/AppealChip";
import { useProcurementWindow } from "@/data/procurement/useProcurementWindow";
import { topicBySlug } from "@/lib/tenderTopics";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TenderRow {
  unp: string;
  ocid: string | null;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  procedureType: string | null;
  estimatedValueEur: number | null;
  currency: string | null;
  lotsCount: number | null;
  isCancelled: boolean;
  isFrameworkAgreement: boolean;
  isEuFunded: boolean;
  linkToOjEu: string | null;
  hasAppeal: boolean | null;
  appealSuspended: boolean | null;
}

const ALL = "__all__";

export const TendersBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const topic = topicBySlug(params.get("topic"));
  const { from, to, all } = useProcurementWindow();

  // ?sector= → the sector browse pack (§4.3): restrict to its buyer EIK-set and
  // mount its enrichment strip. Tenders scope on buyer_eik (= awarder_eik).
  const browsePack = useMemo(
    () => getSectorBrowsePack(params.get("sector")),
    [params],
  );

  const [procedure, setProcedure] = useState<string>(ALL);
  const [cancelled, setCancelled] = useState(false);

  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "tenders"],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "tenders",
        columns: ["procedure_type"],
        limit: 40,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const procedureOptions = facetData?.facets?.procedure_type ?? [];

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    // Curated topic → filter by its precise CPV set (the discriminator the
    // offline builder used); catches the procedures however they're worded.
    if (topic?.cpv?.length) f.push({ id: "cpv", value: topic.cpv });
    // Section scope (?pscope) → bound the announcement date. Exclusive end ≈
    // inclusive max, off by ≤1 day — same convention as the contracts browser.
    if (!all && from)
      f.push({ id: "publication_date", min: from, max: to ?? undefined });
    if (procedure !== ALL) f.push({ id: "procedure_type", value: [procedure] });
    if (cancelled) f.push({ id: "is_cancelled", value: true });
    if (browsePack) f.push({ id: "buyer_eik", value: [...browsePack.eiks] });
    return f;
  }, [topic, all, from, to, procedure, cancelled, browsePack]);

  const columns = useMemo<DataTableColumnDef<TenderRow, unknown>[]>(
    () => [
      {
        id: "publication_date",
        accessorFn: (r) => r.publicationDate,
        header: t("tender_announced") || "Announced",
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            {row.original.publicationDate}
          </div>
        ),
      },
      {
        id: "buyer_name",
        accessorFn: (r) => r.buyerName,
        header: t("company_contract_awarder") || "Awarder",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.buyerEik}`}
            className="text-sm hover:underline"
          >
            {decodeEntities(row.original.buyerName)}
          </Link>
        ),
      },
      {
        id: "subject",
        accessorFn: (r) => r.subject,
        header: t("company_contract_subject") || "Subject",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm line-clamp-2 max-w-sm inline-block">
            {row.original.subject || "—"}
          </span>
        ),
      },
      {
        id: "procedure_type",
        accessorFn: (r) => r.procedureType,
        header: t("tender_procedure") || "Procedure",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.procedureType || "—"}
          </span>
        ),
      },
      {
        id: "estimated_value_eur",
        accessorFn: (r) => r.estimatedValueEur,
        header: t("tender_estimated_value_short") || "Est. value",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span
            className="tabular-nums whitespace-nowrap"
            title={
              row.original.estimatedValueEur != null
                ? String(row.original.estimatedValueEur)
                : undefined
            }
          >
            {row.original.estimatedValueEur != null
              ? formatEurCompact(row.original.estimatedValueEur, i18n.language)
              : "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: t("tender_status") || "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.appealSuspended ? (
              <AppealChip suspended />
            ) : row.original.hasAppeal ? (
              <AppealChip />
            ) : null}
            {row.original.isCancelled ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                {t("tender_status_cancelled") || "Cancelled"}
              </span>
            ) : null}
            {row.original.isFrameworkAgreement ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t("tender_framework") || "Framework"}
              </span>
            ) : null}
            {row.original.isEuFunded ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                {t("contract_eu_funding") || "EU"}
              </span>
            ) : null}
            {row.original.linkToOjEu ? (
              <a
                href={row.original.linkToOjEu}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-primary"
                title="TED"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ),
      },
    ],
    [t, i18n.language],
  );

  const bg = i18n.language === "bg";
  return (
    <>
      <Title description="Tender-stage public-procurement procedures (estimated value, lots, status) from the ЦАИС ЕОП open-data feed">
        {t("tenders_title") || "Tenders"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_tenders_nav"
        scopeMode="toggle"
      />
      <section aria-label="tenders" className="my-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4 shrink-0 text-indigo-600" />
          {bg
            ? "Обявени процедури — прогнозна (не разходвана) стойност."
            : "Announced procedures — estimated (not spent) value."}
          {topic ? (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
              {topic.label[bg ? "bg" : "en"]}
            </span>
          ) : null}
        </div>

        {browsePack && (
          <SectorBrowseSlot pack={browsePack} scope={{ from, to }} />
        )}

        <DbDataTable<TenderRow>
          resource="tenders"
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "estimated_value_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("tenders_search_ph") || "Търси по предмет или възложител…"
          }
          toolbar={
            <>
              {procedureOptions.length > 0 ? (
                <Select value={procedure} onValueChange={setProcedure}>
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("company_contracts_all_methods") || "Всички процедури"}
                    </SelectItem>
                    {procedureOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.value} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cancelled}
                  onChange={(e) => setCancelled(e.target.checked)}
                />
                {t("tender_status_cancelled") || "Cancelled"}
              </label>
            </>
          }
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEurCompact(agg.sumEstimatedValueEur ?? 0, i18n.language)}
              </span>{" "}
              {t("tenders_estimated_over") || "прогнозно по"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {t("tenders_word") || "процедури"}
            </span>
          )}
        />
      </section>
    </>
  );
};
