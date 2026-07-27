// Global public-procurement contracts browser (/procurement/contracts), DB-fed.
// A server-side paginated/sorted/filtered DbDataTable over the whole `contracts`
// corpus (no entity scope) — replaces the client-side contract_index/{year}.json
// shards. Respects the section scope (?pscope): the selected parliament's window
// bounds the rows, "all" spans the corpus. Risk chips are scored client-side per
// page (risk isn't a Postgres column). See docs/plans/postgres-migration-v1.md.
//
// The analysis strip (reactive KPI cards + the clickable "Вид процедура" mix bar)
// mirrors CompanyContractsDbScreen, but scoped to the whole ?pscope window (+ any
// sector / ?awarder EIK-set) instead of one entity. The Σ€ / count cards ride the
// table's own aggregates via onData (free — the footer already computes them and
// they react to the free-text search); the single-bid % / direct % cards + the
// mix bar ride /api/db/facets and do NOT react to the search box (the facets omit
// the global term, same split as the company page).

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Receipt, ExternalLink, Coins, FileText, Users } from "lucide-react";
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
import { ContractAmount } from "@/screens/components/procurement/ContractAmount";
import { RiskBadges } from "@/screens/components/procurement/RiskBadges";
import { AppealChip } from "@/screens/components/procurement/AppealChip";
import { ProcedureMixBar } from "@/screens/components/procurement/ProcedureMixBar";
import { useContractRiskScorer } from "@/data/procurement/useContractRiskFlags";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { resolveContractSource } from "@/screens/components/candidates/procurement/sourceUrl";
import { useCpvCatalog } from "@/data/procurement/useCpvCatalog";
import {
  CpvFilterCombobox,
  CPV_ALL,
} from "@/screens/components/procurement/CpvFilterCombobox";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { facetShare, bucketShare } from "@/lib/facetStats";
import { groupMethodFacet, type ProcedureBucket } from "@/lib/cpvSectors";
import { decodeEntities } from "@/lib/decodeEntities";
import type { ProcurementContract } from "@/data/dataTypes";

type Facets = { facets: Record<string, { value: string; count: number }[]> };

export const ContractsBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { scoreRow } = useContractRiskScorer();
  const { from, to, all, year } = useScopeWindow();
  // ?q= deep link (combined-search "see all" footer) seeds the search box.
  // ?cpv= deep link (from /procurement/sectors) seeds the CPV division filter
  // below — the cpv column is registered with filter:"prefix", so this value
  // (a 2-digit division) matches every contract whose code starts with it.
  const [params] = useSearchParams();

  // Procedure filter is a bucketed selection (same vocabulary as the mix bar);
  // its raw source-method strings are re-derived from the facet below.
  const [procBucket, setProcBucket] = useState<ProcedureBucket | null>(null);
  const [cpvDiv, setCpvDiv] = useState<string>(
    () => params.get("cpv") ?? CPV_ALL,
  );
  const [singleBidder, setSingleBidder] = useState(false);

  // ?sector=water|roads|noi|nzok|agri|judiciary — the sector browse pack (§4.3):
  // restrict the table to that sector's awarder EIK-set and mount its enrichment
  // strip above the table. Null when the param is absent or unknown.
  const browsePack = useMemo(
    () => getSectorBrowsePack(params.get("sector")),
    [params],
  );
  // ?awarder=<eik,eik> — an explicit buyer scope (e.g. the project-file "see all"
  // banner carries its thread's buyerEik so the browser matches the count shown).
  const awarderParam = params.get("awarder");

  // The sector browse pack renders its own summary strip (SectorBrowseSlot), so
  // suppress the generic KPI/mix block — and stand down its facet queries — there.
  const showAnalysis = !browsePack;

  // The parliament window is the base temporal bound (exclusive end ≈ inclusive
  // max, off by ≤1 day — fine for a browser). "All years" drops it.
  const windowFilter = useMemo<DbColumnFilter[]>(
    () =>
      !all && from ? [{ id: "date", min: from, max: to ?? undefined }] : [],
    [all, from, to],
  );

  // Awarder-EIK scope (sector pack or ?awarder=), applied to the table AND every
  // facet/KPI query so the analysis strip matches the rows. (The old window-only
  // facet ignored this scope, so its dropdowns disagreed with the sector table.)
  const awarderScope = useMemo<DbColumnFilter[]>(() => {
    if (browsePack) return [{ id: "awarder_eik", value: [...browsePack.eiks] }];
    if (awarderParam) {
      const eiks = awarderParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (eiks.length) return [{ id: "awarder_eik", value: eiks }];
    }
    return [];
  }, [browsePack, awarderParam]);

  // Base scope every facet request shares (fixed, not user-editable): the window +
  // the awarder-EIK set. The `tag` fixed filter is added at request-build time.
  const scopeBase = useMemo<DbColumnFilter[]>(
    () => [...windowFilter, ...awarderScope],
    [windowFilter, awarderScope],
  );

  // A sector category can span several CPV divisions (?cpv=72,48,32,30) — pass
  // them as an array so the prefix filter ORs them for an exact category match.
  const cpvF = useMemo<DbColumnFilter[]>(
    () =>
      cpvDiv !== CPV_ALL
        ? [
            {
              id: "cpv",
              value: cpvDiv.includes(",") ? cpvDiv.split(",") : cpvDiv,
            },
          ]
        : [],
    [cpvDiv],
  );
  const singleF = useMemo<DbColumnFilter[]>(
    () => (singleBidder ? [{ id: "number_of_tenderers", min: 1, max: 1 }] : []),
    [singleBidder],
  );

  const fetchFacets = useCallback(
    async (columns: string[], filters: DbColumnFilter[]): Promise<Facets> => {
      const req = {
        resource: "contracts",
        fixedFilters: [{ id: "tag", value: ["contract"] }, ...scopeBase],
        filters,
        columns,
        // 100 distinct values/column — enough to cover the whole-corpus method
        // vocabulary + every CPV division without truncating the mix denominator.
        limit: 100,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    [scopeBase],
  );

  // CPV-division facet — kept STATIC (scope-base only, not reactive to the
  // method/single filters) so the combobox's division list doesn't shift as you
  // pick a procedure. Powers the searchable CPV filter.
  const { data: cpvFacet } = useQuery({
    queryKey: ["db-facets", "contracts-global", "cpv", scopeBase],
    queryFn: () => fetchFacets(["cpv"], []),
    staleTime: Infinity,
  });
  const cpvOptions = cpvFacet?.facets?.cpv ?? [];
  // Named CPV-code catalogue (tenders' cpv_desc) powers the searchable CPV filter
  // — search by sector name or by any CPV code, beyond the 2-digit divisions.
  const { data: cpvCatalog } = useCpvCatalog();

  // Facet cost control: while no procedure/single filter is active the proc-mix
  // and bid-count facets share one filter set (scope + cpv), so fetch them in ONE
  // request. Once either is set the two facets must each EXCLUDE their own
  // dimension (so every bucket / bid-count stays visible), which needs two.
  const bothUnfiltered = !procBucket && !singleBidder;

  const { data: combinedFacet } = useQuery({
    queryKey: ["db-facets", "contracts-global", "combined", scopeBase, cpvF],
    enabled: showAnalysis && bothUnfiltered,
    queryFn: () =>
      fetchFacets(["procurement_method", "number_of_tenderers"], [...cpvF]),
    staleTime: Infinity,
  });
  // Procedure-mix facet — every filter EXCEPT the procedure one.
  const { data: procFacet } = useQuery({
    queryKey: [
      "db-facets",
      "contracts-global",
      "proc",
      scopeBase,
      singleF,
      cpvF,
    ],
    enabled: showAnalysis && !bothUnfiltered,
    queryFn: () => fetchFacets(["procurement_method"], [...singleF, ...cpvF]),
    staleTime: Infinity,
  });
  const methodRows = bothUnfiltered
    ? combinedFacet?.facets?.procurement_method
    : procFacet?.facets?.procurement_method;
  const groupedMethods = useMemo(
    () => groupMethodFacet(methodRows ?? []),
    [methodRows],
  );
  // Raw method strings behind the selected bucket → the `in` filter payload.
  const selectedMethods = useMemo<string[]>(
    () =>
      procBucket
        ? (groupedMethods.find((g) => g.bucket === procBucket)?.methods ?? [])
        : [],
    [procBucket, groupedMethods],
  );
  const methodF = useMemo<DbColumnFilter[]>(
    () =>
      selectedMethods.length
        ? [{ id: "procurement_method", value: selectedMethods }]
        : [],
    [selectedMethods],
  );
  // If another filter (CPV / single-bid) narrows the scoped facet so the selected
  // bucket no longer exists, selectedMethods would silently become [] and the
  // procedure filter would drop while the mix bar still reads "selected". Clear the
  // stale selection once the facet has loaded so the state stays honest.
  useEffect(() => {
    if (
      procBucket &&
      groupedMethods.length &&
      !groupedMethods.some((g) => g.bucket === procBucket)
    ) {
      setProcBucket(null);
    }
  }, [procBucket, groupedMethods]);

  // Bid-count facet — every filter EXCEPT single-bid, for the single-bidder % KPI.
  // The facet's limit bounds distinct bidder-counts, not rows — real counts are
  // tiny (~1–30) and `value === 1` is always present, so the denominator is safe.
  const { data: bidFacet } = useQuery({
    queryKey: [
      "db-facets",
      "contracts-global",
      "bid",
      scopeBase,
      methodF,
      cpvF,
    ],
    enabled: showAnalysis && !bothUnfiltered,
    queryFn: () => fetchFacets(["number_of_tenderers"], [...methodF, ...cpvF]),
    staleTime: Infinity,
  });
  const bidRows = bothUnfiltered
    ? combinedFacet?.facets?.number_of_tenderers
    : bidFacet?.facets?.number_of_tenderers;

  // Integrity KPIs over the facet's own scope: single-bidder share + direct-award
  // share. Null when there's no denominator (render "—" not a misleading 0%).
  const singleBidPct = useMemo<number | null>(
    () => facetShare(bidRows ?? [], (v) => Number(v) === 1),
    [bidRows],
  );
  const directPct = useMemo<number | null>(
    () => bucketShare(groupedMethods, "direct"),
    [groupedMethods],
  );

  // Reactive headline aggregates (Σ €, count) for the whole FILTERED set —
  // DbDataTable computes them server-side (exact, since the resource declares
  // aggregates) and hands them back via onData. No extra request.
  const [agg, setAgg] = useState<{ sumAmountEur?: number; count?: number }>({});
  const handleData = useCallback(
    (resp: DbTableResponse<ProcurementContract>) => {
      setAgg({
        sumAmountEur: resp.aggregates?.sumAmountEur,
        count: resp.aggregates?.count ?? resp.total,
      });
    },
    [],
  );

  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [...scopeBase, ...singleF, ...methodF, ...cpvF],
    [scopeBase, singleF, methodF, cpvF],
  );

  const columns = useMemo<DataTableColumnDef<ProcurementContract, unknown>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r.date,
        header: t("company_contract_date") || "Date",
        cell: ({ row }) => (
          <div className="tabular-nums whitespace-nowrap">
            {row.original.date}
          </div>
        ),
      },
      {
        id: "awarder_name",
        accessorFn: (r) => r.awarderName,
        header: t("company_contract_awarder") || "Awarder",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.awarderEik}`}
            className="text-sm hover:underline"
          >
            {decodeEntities(row.original.awarderName)}
          </Link>
        ),
      },
      {
        id: "contractor_name",
        accessorFn: (r) => r.contractorName,
        header: t("company_contract_contractor") || "Contractor",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.contractorEik}`}
            className="text-sm font-medium hover:underline"
          >
            {decodeEntities(row.original.contractorName)}
          </Link>
        ),
      },
      {
        id: "title",
        accessorFn: (r) => r.title,
        header: t("company_contract_subject") || "Subject",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/procurement/contract/${row.original.key}`}
            className="text-sm line-clamp-2 max-w-sm inline-block hover:text-primary hover:underline"
          >
            {row.original.title || "—"}
          </Link>
        ),
      },
      {
        id: "amount_eur",
        accessorFn: (r) => r.amountEur,
        header: t("company_contract_amount") || "Amount",
        meta: { align: "right" },
        cell: ({ row }) =>
          // A €0 consortium member row (migration 087) keeps its real €0 here so a
          // sort on the amount stays honest; the full joint value is on the "обед."
          // chip's tooltip (the value sits on the carrier — its share isn't public).
          row.original.consortiumRole === "member" ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <ContractAmount amountEur={row.original.amountEur} />
              <span
                className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                title={`Договор на обединение — пълна стойност ${formatEur(
                  row.original.consortiumFullEur ?? 0,
                  i18n.language,
                )}; дялът на всеки член не е публичен.`}
              >
                обед.
              </span>
            </span>
          ) : (
            <ContractAmount
              amountEur={row.original.amountEur}
              amount={row.original.amount}
              currency={row.original.currency}
            />
          ),
      },
      {
        id: "risk",
        header: t("company_contract_risk") || "Flags",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <RiskBadges result={scoreRow(row.original)} />
            {row.original.hasAppeal && !row.original.appealUpheld ? (
              <AppealChip />
            ) : null}
          </div>
        ),
      },
      {
        id: "source",
        header: t("company_contract_source") || "Source",
        enableSorting: false,
        cell: ({ row }) => {
          const src = resolveContractSource(row.original);
          return (
            <a
              href={src.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              {src.label === "egov" ? "egov" : "ЕОП"}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        },
      },
    ],
    [t, scoreRow, i18n.language],
  );

  return (
    <>
      <Title description="Public-procurement contracts, searchable across the whole corpus.">
        {t("procurement_contracts_title") || "Contracts"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_index_contracts"
        scopeMode="toggle"
      />
      <section aria-label="contracts" className="my-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4 shrink-0" />
          {all
            ? t("procurement_scope_all") || "Full corpus, all years."
            : year != null
              ? t("procurement_scope_year", { year }) ||
                `Showing contracts signed in ${year}.`
              : `${from ?? ""}${to ? ` → ${to}` : " → …"}`}
        </div>

        {browsePack && (
          <SectorBrowseSlot pack={browsePack} scope={{ from, to }} />
        )}

        {showAnalysis && (
          <>
            {/* Reactive headline KPIs (Σ€/count follow the filters AND the search)
                + integrity KPIs (single-bidder / direct-award share; facet-based,
                so they don't move with the free-text search). */}
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={t("contracts_kpi_total") || "Обща стойност"}>
                <div className="flex items-baseline gap-2">
                  <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span
                    className="text-lg font-bold tabular-nums md:text-xl"
                    title={formatEur(agg.sumAmountEur ?? 0, i18n.language)}
                  >
                    {formatEurCompact(agg.sumAmountEur ?? 0, i18n.language)}
                  </span>
                </div>
              </StatCard>
              <StatCard label={t("company_contracts") || "Договори"}>
                <div className="flex items-baseline gap-2">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {(agg.count ?? 0).toLocaleString("bg-BG")}
                  </span>
                </div>
              </StatCard>
              <StatCard
                label={t("contracts_stat_single_bid") || "1 оферта"}
                hint={
                  t("contracts_stat_single_bid_hint") ||
                  "Дял от договорите с известен брой оферти, спечелени с една оферта."
                }
              >
                <div className="flex items-baseline gap-2">
                  <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {singleBidPct == null ? "—" : `${singleBidPct.toFixed(0)}%`}
                  </span>
                </div>
              </StatCard>
              <StatCard
                label={t("contracts_stat_direct") || "Пряко възлагане"}
                hint={
                  t("contracts_stat_direct_hint") ||
                  "Дял от договорите с посочена процедура, възложени пряко / без обявление."
                }
              >
                <div className="flex items-baseline gap-2">
                  <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-lg font-bold tabular-nums md:text-xl">
                    {directPct == null ? "—" : `${directPct.toFixed(0)}%`}
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
                  t("contracts_procedure_mix_note") ||
                  "Дял от договорите с посочена процедура."
                }
              />
            </div>
          </>
        )}

        <DbDataTable<ProcurementContract>
          resource="contracts"
          fixedFilters={[{ id: "tag", value: ["contract"] }]}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "amount_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={
            t("procurement_contracts_search") ||
            "Търси възложител / изпълнител / предмет…"
          }
          toolbar={
            <>
              {cpvOptions.length > 0 ? (
                <CpvFilterCombobox
                  value={cpvDiv}
                  onChange={setCpvDiv}
                  divisions={cpvOptions}
                  catalog={cpvCatalog ?? []}
                />
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={singleBidder}
                  onChange={(e) => setSingleBidder(e.target.checked)}
                />
                {t("company_contracts_single_bidder") || "само 1 оферта"}
              </label>
            </>
          }
          renderAggregates={(footerAgg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEur(footerAgg.sumAmountEur ?? 0)}
              </span>{" "}
              {t("company_contracts_total_over") || "по"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(footerAgg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {t("procurement_contracts_word") || "договора"}
            </span>
          )}
        />
      </section>
    </>
  );
};
