// Global public-procurement contracts browser (/procurement/contracts), DB-fed.
// A server-side paginated/sorted/filtered DbDataTable over the whole `contracts`
// corpus (no entity scope) — replaces the client-side contract_index/{year}.json
// shards. Respects the section scope (?pscope): the selected parliament's window
// bounds the rows, "all" spans the corpus. Risk chips are scored client-side per
// page from the server-computed risk masks (contract_risk_cache, migration 112).
// See docs/plans/postgres-migration-v1.md.
//
// The analysis strip (reactive KPI cards + the clickable "Вид процедура" mix bar)
// mirrors CompanyContractsDbScreen, but scoped to the whole ?pscope window (+ any
// sector / ?awarder EIK-set) instead of one entity. The Σ€ / count cards ride the
// table's own aggregates via onData (free — the footer already computes them and
// they react to the free-text search); the single-bid % / direct % cards + the
// mix bar ride /api/db/facets and do NOT react to the search box (the facets omit
// the global term, same split as the company page).

import { FC, useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt, ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
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
import { ContractsAnalysisStrip } from "@/screens/components/procurement/ContractsAnalysisStrip";
import { ProcedureBucketSelect } from "@/screens/components/procurement/ProcedureBucketSelect";
import { RiskGradeFilter } from "@/screens/components/procurement/RiskGradeFilter";
import { SingleBidderToggle } from "@/screens/components/procurement/SingleBidderToggle";
import { ContractsAggregatesFooter } from "@/screens/components/procurement/ContractsAggregatesFooter";
import {
  contractRiskFromMasks,
  withNgoDisclosure,
} from "@/lib/contractRiskMask";
import { useNgoForeignFundedByEik } from "@/data/procurement/usePepConnectedByEik";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { resolveContractSource } from "@/screens/components/candidates/procurement/sourceUrl";
import { useCpvCatalog } from "@/data/procurement/useCpvCatalog";
import {
  CpvFilterCombobox,
  CPV_ALL,
} from "@/screens/components/procurement/CpvFilterCombobox";
import { procedureBucket, procedureLabel } from "@/lib/cpvSectors";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import { useUrlProcurementFilters } from "@/data/procurement/useUrlProcurementFilters";
import { decodeEntities } from "@/lib/decodeEntities";
import type { ProcurementContract } from "@/data/dataTypes";

export const ContractsBrowserDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { from, to, all, year } = useScopeWindow();
  // ?q= deep link (combined-search "see all" footer) seeds the search box.
  // ?cpv= deep link (from /procurement/sectors) seeds the CPV division filter
  // below — the cpv column is registered with filter:"prefix", so this value
  // (a 2-digit division) matches every contract whose code starts with it.
  const [params] = useSearchParams();

  // The URL-backed filter dimensions (?proc / ?cpv / ?single) — shared with the
  // tenders + company browsers so a filtered view stays shareable. ?cpv doubles as
  // the deep-link seed from /procurement/sectors.
  const {
    procBucket,
    cpvSel: cpvDiv,
    toggle: singleBidder,
    setProcBucket,
    setCpvSel: setCpvDiv,
    setToggle: setSingleBidder,
    grades,
    setGrades,
    hasActiveFilters,
    clearFilters,
  } = useUrlProcurementFilters({ toggleParam: "single", withRisk: true });

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

  // Risk grade filters SERVER-side on the whole corpus (migration 112), not on
  // the loaded page — the point of moving the index into Postgres.
  const gradeF = useMemo<DbColumnFilter[]>(
    () => (grades.length ? [{ id: "risk_grade", value: grades }] : []),
    [grades],
  );

  // Named CPV-code catalogue (tenders' cpv_desc) powers the searchable CPV filter
  // — search by sector name or by any CPV code, beyond the 2-digit divisions.
  const { data: cpvCatalog, isError: cpvCatalogError } = useCpvCatalog();

  // Neutral foreign-funded-NGO disclosure — its own ~6 kB route, since it is the
  // one chip input the server masks cannot carry (no scored bit).
  const { byEik: ngoByEik } = useNgoForeignFundedByEik();

  // Facet-driven analysis (procedure mix, integrity KPIs, CPV options), shared
  // with the company/awarder screens. Scope = the whole ?pscope window + awarder
  // EIK-set (folded into fixedFilters); the CPV facet is kept STATIC so the
  // combobox's division list doesn't shift as you pick a procedure; the analysis
  // facets stand down on ?sector pages (showAnalysis=false).
  const { groupedMethods, cpvOptions, singleBidPct, directPct, methodF } =
    useContractsAnalytics({
      resource: "contracts",
      // gradeF belongs here, not just on the table: without it the KPI strip
      // would show a grade-filtered count and Σ€ beside single-bid/direct
      // percentages computed over the UNfiltered set.
      fixedFilters: [
        { id: "tag", value: ["contract"] },
        ...scopeBase,
        ...gradeF,
      ],
      singleFilter: singleF,
      cpvFilter: cpvF,
      procBucket,
      enabled: showAnalysis,
      reactiveCpv: false,
      onBucketInvalid: () => setProcBucket(null),
    });

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
    () => [...scopeBase, ...singleF, ...methodF, ...cpvF, ...gradeF],
    [scopeBase, singleF, methodF, cpvF, gradeF],
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
        // A €0 consortium member row (migration 087) keeps its real €0 here so a
        // sort on the amount stays honest; the full joint value has its own
        // "Обединение" column below (the value sits on the carrier — the member's
        // share isn't public).
        cell: ({ row }) => (
          <ContractAmount
            amountEur={row.original.amountEur}
            amount={row.original.amount}
            currency={row.original.currency}
          />
        ),
      },
      {
        // Procedure type, bucketed + translated (same vocabulary as the mix bar +
        // filter). Display-only — discovery is via the chart / filter instead.
        id: "procedure",
        header: t("company_contract_procedure") || "Procedure",
        enableSorting: false,
        className: "hidden md:table-cell",
        cell: ({ row }) => (
          <span className="inline-block whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {procedureLabel(
              procedureBucket(row.original.procurementMethod),
              i18n.language,
            )}
          </span>
        ),
      },
      {
        // Bid count — sortable competition signal. Coloured rose when the shared
        // scorer flags weak competition, the signal the СИГНАЛИ pill used to carry
        // (now hidden there via hideWeakCompetition, so it isn't shown twice).
        id: "number_of_tenderers",
        accessorFn: (r) => r.numberOfTenderers ?? null,
        header: t("company_contracts_bids") || "Bids",
        className: "hidden sm:table-cell",
        cell: ({ row }) => {
          const n = row.original.numberOfTenderers;
          if (n == null)
            return <span className="text-xs text-muted-foreground">—</span>;
          // Unscored (null) must not read as "competition was fine" — leave the
          // count unhighlighted rather than asserting the negative.
          const weak =
            contractRiskFromMasks(row.original)?.flags.weakCompetition ?? false;
          return (
            <span
              className={`block text-right text-sm tabular-nums ${
                weak ? "font-medium text-rose-600 dark:text-rose-400" : ""
              }`}
            >
              {n}
            </span>
          );
        },
      },
      {
        // Reference-only column (migration 087): a consortium MEMBER row's amount
        // is €0 (its real share isn't public), so the full joint-contract value is
        // shown HERE to avoid distorting a sort on the real amount. Empty otherwise.
        id: "consortium_full_eur",
        accessorFn: (r) => r.consortiumFullEur ?? null,
        header: t("company_contract_consortium_full", {
          defaultValue: "Обединение",
        }),
        meta: { align: "right" },
        className: "hidden lg:table-cell",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.consortiumRole === "member" ? (
            <span
              className="whitespace-nowrap text-xs text-muted-foreground"
              title={t("company_contract_consortium_full_tip", {
                defaultValue:
                  "Пълна стойност на договора на обединението — тази фирма е участник; реалният ѝ дял не е публичен.",
              })}
            >
              {row.original.consortiumEik ? (
                <Link
                  to={`/company/${row.original.consortiumEik}`}
                  className="text-primary hover:underline"
                >
                  <ContractAmount amountEur={row.original.consortiumFullEur} />
                </Link>
              ) : (
                <ContractAmount amountEur={row.original.consortiumFullEur} />
              )}
            </span>
          ) : null,
      },
      {
        // id MUST match the registry column, not a display name: buildOrder
        // silently drops an ORDER BY for an id it does not recognise, so a
        // column called "risk" would look sortable and quietly do nothing.
        id: "risk_cri",
        header: t("company_contract_risk") || "Flags",
        // Bid count moved to its own column, so drop the weak-competition chip
        // here to avoid showing the same signal twice.
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <RiskBadges
              result={withNgoDisclosure(
                contractRiskFromMasks(row.original),
                ngoByEik.get(row.original.contractorEik),
              )}
              contractKey={row.original.key}
              hideWeakCompetition
            />
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
    [t, i18n.language, ngoByEik],
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
          <ContractsAnalysisStrip
            sumAmountEur={agg.sumAmountEur}
            count={agg.count}
            singleBidPct={singleBidPct}
            directPct={directPct}
            groupedMethods={groupedMethods}
            procBucket={procBucket}
            onSelectBucket={setProcBucket}
            countLabel={t("company_contracts") || "Договори"}
          />
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
                  catalogError={cpvCatalogError}
                />
              ) : null}
              {/* Bucketed procedure dropdown — mirrors the mix bar's vocabulary
                  and drives the same ?proc filter. Travels with the analysis
                  block, so it's hidden on ?sector pages (no proc facet there). */}
              {showAnalysis ? (
                <ProcedureBucketSelect
                  groupedMethods={groupedMethods}
                  value={procBucket}
                  onChange={setProcBucket}
                />
              ) : null}
              <RiskGradeFilter value={grades} onChange={setGrades} />
              <SingleBidderToggle
                checked={singleBidder}
                onChange={setSingleBidder}
              />
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
            <ContractsAggregatesFooter
              agg={footerAgg}
              total={total}
              exact={exact}
              word={t("procurement_contracts_word") || "договора"}
            />
          )}
        />
      </section>
    </>
  );
};
