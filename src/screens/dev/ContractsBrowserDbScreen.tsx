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
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { Title } from "@/ux/Title";
import {
  DbDataTable,
  type DbColumnFilter,
  type DbTableResponse,
} from "@/ux/data_table/DbDataTable";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { getSectorBrowsePack } from "@/screens/components/procurement/sectorPacks";
import { SectorBrowseSlot } from "@/screens/components/procurement/SectorBrowseSlot";
import { ContractsAnalysisStrip } from "@/screens/components/procurement/ContractsAnalysisStrip";
import { ProcedureBucketSelect } from "@/screens/components/procurement/ProcedureBucketSelect";
import { RiskGradeFilter } from "@/screens/components/procurement/RiskGradeFilter";
import { SingleBidderToggle } from "@/screens/components/procurement/SingleBidderToggle";
import { ContractsAggregatesFooter } from "@/screens/components/procurement/ContractsAggregatesFooter";
import { useContractColumns } from "@/screens/components/procurement/contractColumns";
import { useNgoForeignFundedByEik } from "@/data/procurement/usePepConnectedByEik";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  CpvFilterCombobox,
  CPV_ALL,
} from "@/screens/components/procurement/CpvFilterCombobox";
import { useContractsAnalytics } from "@/data/procurement/useContractsAnalytics";
import { useUrlProcurementFilters } from "@/data/procurement/useUrlProcurementFilters";
import { ContractsDossierRoute } from "@/screens/procurement/DossierContractsView";
import type { ProcurementContract } from "@/data/dataTypes";

// The full-corpus contracts browse (server-paginated over the whole `contracts`
// table). Rendered when NOT in dossier mode — see ContractsBrowserDbScreen.
const CorpusContractsBrowse: FC = () => {
  const { t } = useTranslation();
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

  // Shared definitions (contractColumns.tsx). The global browser shows BOTH parties
  // and the source link, and leaves the name columns unsortable: over the whole
  // corpus a name sort cannot use an index, so search is the discovery path instead.
  const columns = useContractColumns({
    show: [
      "date",
      "awarder_name",
      "contractor_name",
      "title",
      "amount_eur",
      "procedure",
      "number_of_tenderers",
      "consortium_full_eur",
      "risk_cri",
      "source",
    ],
    ngoByEik,
    showAppealChip: true,
    titleClamp: "sm",
  });

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

// Route entry for /procurement/contracts. Dossier mode (?dossier=<slug> curated |
// ?dspec=<ProcurementQuery> DIY) shows ONE dossier's contracts — the exact member
// set for a bounded dossier, or the seed reproduction for a truncated/program one
// (see DossierContractsView). Otherwise the full-corpus browse.
export const ContractsBrowserDbScreen: FC = () => {
  const [params] = useSearchParams();
  const slug = params.get("dossier");
  const dspec = params.get("dspec");
  if (slug || dspec) return <ContractsDossierRoute slug={slug} dspec={dspec} />;
  return <CorpusContractsBrowse />;
};
