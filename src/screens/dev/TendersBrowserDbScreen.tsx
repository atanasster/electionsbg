// Tender-stage procedures browser (/procurement/tenders), DB-fed. A server-side
// DbDataTable over the whole `tenders` corpus (ЦАИС ЕОП), replacing the per-year
// JSON shards. Values are ESTIMATED (forecast at announcement), never spend — the
// header says so. Curated topic deep-links (?topic=guardrails, the "мантинели за
// 1 млрд" case) prefilter the subject by the topic's keyword and show its label.
// See docs/plans/postgres-migration-v1.md.
//
// The analysis strip (reactive KPI cards + the clickable "Вид процедура" mix bar)
// mirrors the contracts browser via the shared useContractsAnalytics hook, but
// with tender-shaped metrics: forecast Σ + count (from the table's aggregates),
// direct-award % and EU-funded % (facet-based). Tenders have no bid data, so
// there's no single-bidder KPI.

import { FC, useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardList, ExternalLink, Coins, Gavel, Star } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { getSectorBrowsePack } from "@/screens/components/procurement/sectorPacks";
import { SectorBrowseSlot } from "@/screens/components/procurement/SectorBrowseSlot";
import { AppealChip } from "@/screens/components/procurement/AppealChip";
import { SignalPill } from "@/screens/components/procurement/SignalPill";
import { TenderRiskChips } from "@/screens/components/procurement/TenderRiskPanel";
import { ProcedureMixBar } from "@/screens/components/procurement/ProcedureMixBar";
import { ProcedureBucketSelect } from "@/screens/components/procurement/ProcedureBucketSelect";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { topicBySlug } from "@/lib/tenderTopics";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { procedureBucket, procedureLabel } from "@/lib/cpvSectors";
import { useUrlProcurementFilters } from "@/data/procurement/useUrlProcurementFilters";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  CpvFilterCombobox,
  CPV_ALL,
} from "@/screens/components/procurement/CpvFilterCombobox";
import { useCpvCatalog } from "@/data/procurement/useCpvCatalog";

interface TenderRow {
  unp: string;
  ocid: string | null;
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  procedureType: string | null;
  submissionDeadline: string | null;
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

export const TendersBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const topic = topicBySlug(params.get("topic"));
  const { from, to, all } = useScopeWindow();

  // The URL-backed filter dimensions (?proc / ?cpv / ?cancelled) — shared with the
  // contracts + company browsers so a filtered view stays shareable. ?cpv doubles
  // as the deep-link seed from the tender normalcy panel's "browse similar".
  const {
    procBucket,
    cpvSel,
    toggle: cancelled,
    setProcBucket,
    setCpvSel,
    setToggle: setCancelled,
    hasActiveFilters,
    clearFilters,
  } = useUrlProcurementFilters({ toggleParam: "cancelled" });

  // ?sector= → the sector browse pack (§4.3): restrict to its buyer EIK-set and
  // mount its enrichment strip. Tenders scope on buyer_eik (= awarder_eik). The
  // pack renders its own summary, so the generic KPI/mix block stands down there.
  const browsePack = useMemo(
    () => getSectorBrowsePack(params.get("sector")),
    [params],
  );
  const showAnalysis = !browsePack;

  // Scope filters shared by the facets AND the table (window + buyer EIK-set +
  // curated topic CPV set) so the analysis strip matches the rows.
  const scopeFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    // Curated topic → filter by its precise CPV set (the discriminator the
    // offline builder used); catches the procedures however they're worded.
    if (topic?.cpv?.length) f.push({ id: "cpv", value: topic.cpv });
    // Section scope (?pscope) → bound the announcement date. Exclusive end ≈
    // inclusive max, off by ≤1 day — same convention as the contracts browser.
    if (!all && from)
      f.push({ id: "publication_date", min: from, max: to ?? undefined });
    if (browsePack) f.push({ id: "buyer_eik", value: [...browsePack.eiks] });
    return f;
  }, [topic, all, from, to, browsePack]);

  const cancelledFilter = useMemo<DbColumnFilter[]>(
    () => (cancelled ? [{ id: "is_cancelled", value: true }] : []),
    [cancelled],
  );
  const cpvFilter = useMemo<DbColumnFilter[]>(
    () => (cpvSel !== CPV_ALL ? [{ id: "cpv_prefix", value: cpvSel }] : []),
    [cpvSel],
  );

  // Facet-driven analysis, shared with the contracts browsers. Tender-shaped:
  // procedure_type as the mix column, NO bid column (no single-bid KPI), and an
  // EU-funded % share KPI. Static CPV facet (keep the combobox list stable).
  const { groupedMethods, cpvOptions, directPct, sharePct, methodF } =
    useContractsAnalytics({
      resource: "tenders",
      fixedFilters: scopeFilters,
      commonFilters: cancelledFilter,
      singleFilter: [],
      cpvFilter,
      procBucket,
      methodColumn: "procedure_type",
      bidColumn: null,
      // is_eu_funded is a PG bool → the facet value arrives as a JS boolean (via
      // JSON), so coerce before comparing (a bare v === "true" is always false).
      shareFacet: {
        column: "is_eu_funded",
        match: (v) => String(v) === "true",
      },
      enabled: showAnalysis,
      reactiveCpv: false,
      onBucketInvalid: () => setProcBucket(null),
    });
  // Named CPV-code catalogue powers the searchable CPV filter — search by sector
  // name or by any CPV code. Shared with the contracts browser.
  const { data: cpvCatalog } = useCpvCatalog();

  // Reactive headline aggregates (Σ estimated €, count) for the whole FILTERED
  // set — DbDataTable computes them server-side and hands them back via onData.
  const [agg, setAgg] = useState<{
    sumEstimatedValueEur?: number;
    count?: number;
  }>({});
  const handleData = useCallback((resp: DbTableResponse<TenderRow>) => {
    setAgg({
      sumEstimatedValueEur: resp.aggregates?.sumEstimatedValueEur,
      count: resp.aggregates?.count ?? resp.total,
    });
  }, []);

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...scopeFilters, ...cancelledFilter, ...methodF, ...cpvFilter],
    [scopeFilters, cancelledFilter, methodF, cpvFilter],
  );

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
        // Procedure type, bucketed + translated (same vocabulary as the mix bar +
        // filter). The raw procedure_type string stays on the hover title, since
        // bucketing folds several phrasings together. Not sortable.
        id: "procedure_type",
        accessorFn: (r) => r.procedureType,
        header: t("tender_procedure") || "Procedure",
        enableSorting: false,
        className: "hidden md:table-cell",
        cell: ({ row }) => (
          <span
            className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            title={row.original.procedureType || undefined}
          >
            {procedureLabel(
              procedureBucket(row.original.procedureType ?? undefined),
              i18n.language,
            )}
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
        // Lot count — sortable (indexed). The scale signal for a procedure split
        // into обособени позиции (lots).
        id: "lots_count",
        accessorFn: (r) => r.lotsCount ?? null,
        header: t("tender_lots") || "Позиции",
        meta: { align: "right" },
        className: "hidden sm:table-cell",
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums text-muted-foreground">
            {row.original.lotsCount == null
              ? "—"
              : row.original.lotsCount.toLocaleString("bg-BG")}
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
              <SignalPill tone="amber">
                {t("tender_status_cancelled") || "Cancelled"}
              </SignalPill>
            ) : null}
            {row.original.isFrameworkAgreement ? (
              <SignalPill tone="muted">
                {t("tender_framework") || "Framework"}
              </SignalPill>
            ) : null}
            {row.original.isEuFunded ? (
              <SignalPill tone="emerald">
                {t("signal_eu_short") || "EU"}
              </SignalPill>
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
      {
        id: "risk",
        header: t("company_contract_risk") || "Flags",
        enableSorting: false,
        // Ex-ante procedure-grain flags (non-open, tier-conditional rushed
        // window). Awards aren't loaded per browser row, so the decision-period
        // check is unavailable here — by design.
        cell: ({ row }) => <TenderRiskChips tender={row.original} />,
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

        {showAnalysis && (
          <>
            {/* Reactive headline KPIs (Σ estimated / count follow the filters AND
                the search) + integrity KPIs (direct-award / EU-funded share;
                facet-based, so they don't move with the free-text search). */}
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t("tenders_kpi_estimated") || "Прогнозна стойност"}
              >
                <div className="flex items-baseline gap-2">
                  <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span
                    className="text-lg font-bold tabular-nums md:text-xl"
                    title={formatEur(
                      agg.sumEstimatedValueEur ?? 0,
                      i18n.language,
                    )}
                  >
                    {formatEurCompact(
                      agg.sumEstimatedValueEur ?? 0,
                      i18n.language,
                    )}
                  </span>
                </div>
              </StatCard>
              <StatCard label={t("tenders_kpi_count") || "Процедури"}>
                <div className="flex items-baseline gap-2">
                  <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {(agg.count ?? 0).toLocaleString("bg-BG")}
                  </span>
                </div>
              </StatCard>
              <StatCard
                label={t("tenders_stat_direct") || "Пряко / без обявление"}
                hint={
                  t("tenders_stat_direct_hint") ||
                  "Дял от процедурите с посочен вид, обявени пряко / без обявление."
                }
              >
                <div className="flex items-baseline gap-2">
                  <Gavel className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {directPct == null ? "—" : `${directPct.toFixed(0)}%`}
                  </span>
                </div>
              </StatCard>
              <StatCard
                label={t("tenders_stat_eu") || "ЕС-финансирани"}
                hint={
                  t("tenders_stat_eu_hint") ||
                  "Дял от процедурите, финансирани със средства от ЕС."
                }
              >
                <div className="flex items-baseline gap-2">
                  <Star className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {sharePct == null ? "—" : `${sharePct.toFixed(0)}%`}
                  </span>
                </div>
              </StatCard>
            </div>

            {/* Procedure-mix overview — filter-scoped and clickable: a segment/chip
                toggles the same bucket filter that narrows the table. */}
            <div className="mb-4">
              <ProcedureMixBar
                buckets={groupedMethods}
                selected={procBucket}
                onSelect={setProcBucket}
                title={t("contracts_procedure_mix") || "Вид процедура"}
                note={
                  t("tenders_procedure_mix_note") ||
                  "Дял от процедурите с посочен вид."
                }
              />
            </div>
          </>
        )}

        <DbDataTable<TenderRow>
          resource="tenders"
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "estimated_value_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("tenders_search_ph") || "Търси по предмет или възложител…"
          }
          toolbar={
            <>
              {cpvOptions.length > 0 ? (
                <CpvFilterCombobox
                  value={cpvSel}
                  onChange={setCpvSel}
                  divisions={cpvOptions}
                  catalog={cpvCatalog ?? []}
                />
              ) : null}
              {/* Bucketed procedure dropdown — mirrors the mix bar's vocabulary
                  and drives the same ?proc filter. Self-hides until the facet has
                  buckets (so it's absent on ?sector pages). */}
              <ProcedureBucketSelect
                groupedMethods={groupedMethods}
                value={procBucket}
                onChange={setProcBucket}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cancelled}
                  onChange={(e) => setCancelled(e.target.checked)}
                />
                {t("tender_status_cancelled") || "Cancelled"}
              </label>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {t("contracts_clear_filters") || "Изчисти филтрите"}
                </button>
              ) : null}
            </>
          }
          renderAggregates={(footerAgg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEurCompact(
                  footerAgg.sumEstimatedValueEur ?? 0,
                  i18n.language,
                )}
              </span>{" "}
              {t("tenders_estimated_over") || "прогнозно по"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(footerAgg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {t("tenders_word") || "процедури"}
            </span>
          )}
        />
      </section>
    </>
  );
};
