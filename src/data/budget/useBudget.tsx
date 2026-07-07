// React Query hooks for the budget pillar. The offline pipeline writes three
// small committed files to data/budget/; the SPA fetches them whole (each is
// well under 100 KB) and filters client-side. Same pattern as the procurement
// hooks: dataUrl() seam, staleTime Infinity, 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { rayonFromObshtina } from "./sofiaRayons";
import type {
  BudgetIndex,
  BudgetDocumentsFile,
  CustomsBreakdownFile,
  KfpFile,
  MinistryProcurementFile,
  MinistryRollup,
  MunicipalTransfersByOblastFile,
  MunicipalTransfersIndexFile,
  MunicipalTransfersOblastShard,
  MunicipalTransfersTotalsFile,
  InvestmentProgramFile,
  InvestmentProgramIndexFile,
  AsenovgradCapitalProgramFile,
  BurgasCapitalProgramFile,
  DobrichCapitalProgramFile,
  NoiFundsFile,
  NzokBudgetFile,
  NzokExecutionFile,
  NzokHospitalPaymentsFile,
  NzokHospitalReimbursement,
  NzokDrugReimbursementFile,
  PersonnelFile,
  PitBreakdownFile,
  PlevenCapitalProgramFile,
  PlovdivCapitalProgramFile,
  RuseCapitalProgramFile,
  ShumenCapitalProgramFile,
  SlivenCapitalProgramFile,
  SofiaCapitalProgramFile,
  StaraZagoraCapitalProgramFile,
  DupnitsaCapitalProgramFile,
  GabrovoCapitalProgramFile,
  SamokovCapitalProgramFile,
  VelingradCapitalProgramFile,
  HaskovoCapitalProgramFile,
  KardzhaliCapitalProgramFile,
  LovechCapitalProgramFile,
  YambolCapitalProgramFile,
  PernikCapitalProgramFile,
  VarnaCapitalProgramFile,
  VelikoTarnovoCapitalProgramFile,
  KarlovoCapitalProgramFile,
  KazanlakCapitalProgramFile,
  KyustendilCapitalProgramFile,
  MontanaCapitalProgramFile,
  IpopNationalFile,
  IpopMunicipalityFile,
  VidinCapitalProgramFile,
  VatBreakdownFile,
  MunicipalExecutionFile,
  MunicipalExecutionIndexFile,
  PolicyBaselineFile,
} from "./types";

const fetchJson = async <T,>(path: string): Promise<T | null> => {
  const r = await fetch(dataUrl(path));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T;
};

// /api/db endpoints (DB-served via the Cloud Function / dev plugin) — a relative
// URL, NOT the GCS static bucket, so no dataUrl(). The endpoint returns a JSON
// `null` body when there is no record (e.g. a non-hospital EIK), passed through.
const fetchDb = async <T,>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`db fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T | null;
};

export const useBudgetIndex = () =>
  useQuery({
    queryKey: ["budget", "index"] as const,
    queryFn: () => fetchJson<BudgetIndex>("/budget/index.json"),
    staleTime: Infinity,
  });

export const useKfp = () =>
  useQuery({
    queryKey: ["budget", "kfp"] as const,
    queryFn: () => fetchJson<KfpFile>("/budget/kfp.json"),
    staleTime: Infinity,
  });

export const useBudgetDocuments = () =>
  useQuery({
    queryKey: ["budget", "documents"] as const,
    queryFn: () => fetchJson<BudgetDocumentsFile>("/budget/documents.json"),
    staleTime: Infinity,
  });

// Phase 4 — the per-ministry procurement cross-link (budget admin unit → its
// public-procurement awarder + footprint).
export const useMinistryProcurement = () =>
  useQuery({
    queryKey: ["budget", "ministry-procurement"] as const,
    queryFn: () =>
      fetchJson<MinistryProcurementFile>(
        "/budget/derived/ministry_procurement.json",
      ),
    staleTime: Infinity,
  });

// One spending unit's self-contained rollup — the single small file the
// ministry detail screen fetches (years of figures + programs + procurement),
// instead of every year's whole-corpus reconciliation. 404 → null.
export const useBudgetMinistryRollup = (nodeId: string | undefined) =>
  useQuery({
    queryKey: ["budget", "ministry", nodeId] as const,
    queryFn: () =>
      fetchJson<MinistryRollup>(`/budget/ministries/${nodeId}.json`),
    enabled: !!nodeId,
    staleTime: Infinity,
  });

// Personnel — per-programme headcount × Персонал spend (from each ministry's
// program-budget execution report) plus the annual Доклад за състоянието на
// администрацията aggregates. Single committed file (~80 KB across 9 years).
export const usePersonnel = () =>
  useQuery({
    queryKey: ["budget", "personnel"] as const,
    queryFn: () => fetchJson<PersonnelFile>("/budget/personnel.json"),
    staleTime: Infinity,
  });

// Revenue-side breakdowns — itemise each Sankey LEFT-side wedge into its
// sub-flows. Coverage is per-fiscal-year-file; pickers fall back to the most
// recent available year when the selected one isn't ingested yet (mirrors
// `usePersonnel`'s pattern).

export const useCustomsBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "customs", fiscalYear] as const,
    queryFn: () =>
      fetchJson<CustomsBreakdownFile>(
        `/budget/revenue_breakdown/customs/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const useVatBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "vat", fiscalYear] as const,
    queryFn: () =>
      fetchJson<VatBreakdownFile>(
        `/budget/revenue_breakdown/vat/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const usePitBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "pit", fiscalYear] as const,
    queryFn: () =>
      fetchJson<PitBreakdownFile>(
        `/budget/revenue_breakdown/pit/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Municipal transfers — itemise the Sankey RIGHT-side "Общини" wedge into the
// five transfer-type sub-envelopes and the 265 per-община rows. Coverage is
// per-fiscal-year; the index lists the years on disk so consumers can fall
// back to the latest available year when the selected one isn't ingested.

export const useMunicipalTransfersIndex = () =>
  useQuery({
    queryKey: ["budget", "municipal-transfers", "index"] as const,
    queryFn: () =>
      fetchJson<MunicipalTransfersIndexFile>(
        "/budget/municipal_transfers/index.json",
      ),
    staleTime: Infinity,
  });

export const useMunicipalTransfersTotals = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "municipal-transfers", "totals", fiscalYear] as const,
    queryFn: () =>
      fetchJson<MunicipalTransfersTotalsFile>(
        `/budget/municipal_transfers/${fiscalYear}/totals.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const useMunicipalTransfersByOblast = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: [
      "budget",
      "municipal-transfers",
      "by-oblast",
      fiscalYear,
    ] as const,
    queryFn: () =>
      fetchJson<MunicipalTransfersByOblastFile>(
        `/budget/municipal_transfers/${fiscalYear}/by_oblast.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// `useMunicipalTransfersByMunicipality` removed in audit pass — the
// per-year 265-row by_municipality.json was 220 KB raw / 25 KB gz per year
// but no UI consumed it. The per-oblast shards
// (/budget/municipal_transfers/oblasts/{code}.json) carry the same per-муни
// rows sliced by region, which is the only access pattern pages use.

// Per-oblast shard with full multi-year history — the unit a region or
// municipality dashboard fetches. One file per oblast (~5-50 KB) carrying
// every year × every municipality in that oblast, so the per-page tile reads
// ONE small file regardless of how many years it surfaces.
export const useMunicipalTransfersForOblast = (
  oblastCode: string | undefined,
) =>
  useQuery({
    queryKey: [
      "budget",
      "municipal-transfers",
      "oblast-shard",
      oblastCode,
    ] as const,
    queryFn: () =>
      fetchJson<MunicipalTransfersOblastShard>(
        `/budget/municipal_transfers/oblasts/${oblastCode}.json`,
      ),
    enabled: !!oblastCode,
    staleTime: Infinity,
  });

// NOI fund-level execution — drives the drilldown on the Sankey's
// "Социалноосигурителни фондове" leaf. Single committed file (~16 KB across
// the available fiscal years).
export const useNoiFunds = () =>
  useQuery({
    queryKey: ["budget", "noi", "funds"] as const,
    queryFn: () => fetchJson<NoiFundsFile>("/budget/noi/funds.json"),
    staleTime: Infinity,
  });

// НЗОК budget-law breakdown — drives the health sector pack's "Къде отиват
// €5,5 млрд." bridge tile. Single committed file (~4 KB across the ingested
// fiscal years). Written by scripts/budget/nzok/__write_budget.ts.
export const useNzokBudget = () =>
  useQuery({
    queryKey: ["budget", "nzok", "budget"] as const,
    queryFn: () => fetchJson<NzokBudgetFile>("/budget/nzok/budget.json"),
    staleTime: Infinity,
  });

// НЗОК cash-execution (form B1) — cumulative revenue + expenditure YTD, paired
// with the budget-law plan for the execution gauge on the budget-bridge tile.
export const useNzokExecution = () =>
  useQuery({
    queryKey: ["budget", "nzok", "execution"] as const,
    queryFn: () => fetchJson<NzokExecutionFile>("/budget/nzok/execution.json"),
    staleTime: Infinity,
  });

// НЗОК per-hospital БМП payments — the latest-period snapshot of what the fund
// pays hospitals (the biggest non-ЗОП line), now DB-served from the
// nzok_hospital_payments corpus (/api/db, migration 045) instead of the static
// snapshot: the table is multi-period so the tile can grow momentum/history.
// Drives the health pack's hospital-ranking tile.
export const useNzokHospitalPayments = () =>
  useQuery({
    queryKey: ["nzok", "hospital-payments"] as const,
    queryFn: () =>
      fetchDb<NzokHospitalPaymentsFile>("/api/db/nzok-hospital-payments"),
    staleTime: Infinity,
  });

// НЗОК hospital-care reimbursement for ONE company (its ЛЗ facilities summed) —
// DB-served per-EIK (/api/db/nzok-hospital-by-eik) so a hospital's /company/:eik
// page fetches only its own figure, not the whole crosswalk. null when the EIK
// has no matched НЗОК payment.
export const useNzokHospitalByEik = (eik?: string | null) =>
  useQuery({
    queryKey: ["nzok", "hospital-by-eik", eik ?? ""] as const,
    queryFn: () =>
      fetchDb<NzokHospitalReimbursement>(
        `/api/db/nzok-hospital-by-eik?eik=${encodeURIComponent(eik!)}`,
      ),
    enabled: !!eik,
    staleTime: Infinity,
  });

// НЗОК annual drug reimbursement by INN — the second-largest non-ЗОП line.
// Small (~7 KB: top-25 INN + ATC-group rollup). Drives the health pack's
// top-reimbursed-medicines tile.
export const useNzokDrugReimbursement = () =>
  useQuery({
    queryKey: ["budget", "nzok", "drug-reimbursement"] as const,
    queryFn: () =>
      fetchJson<NzokDrugReimbursementFile>(
        "/budget/nzok/drug_reimbursement.json",
      ),
    staleTime: Infinity,
  });

// Investment program — per-year per-project list parsed from the budget law's
// Приложение III. Drives the drilldown on the Sankey's "Капиталови разходи"
// leaf and per-region investment tiles.
export const useInvestmentProgramIndex = () =>
  useQuery({
    queryKey: ["budget", "investment-program", "index"] as const,
    queryFn: () =>
      fetchJson<InvestmentProgramIndexFile>(
        "/budget/investment_program/index.json",
      ),
    staleTime: Infinity,
  });

export const useInvestmentProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "investment-program", fiscalYear] as const,
    queryFn: () =>
      fetchJson<InvestmentProgramFile>(
        `/budget/investment_program/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Sofia's annual капиталова програма — per-project capital-spending list
// extracted from Приложение №3 to the city's budget law. The Capital
// Projects tile on a Sofia settlement page filters this down to the
// settlement's parent район and shows the top items + a total. ~440 KB
// uncompressed; gzip on the GCS bucket brings it well under 50 KB.
//
// Known recap-vs-sum gap: ~18% of the headline figure is unattributed
// at project grain — the recap is the published city-wide ОБЩО (which
// includes some city-wide commitments not enumerated as individual
// objects). The tile shows the recap as the headline and the per-район
// breakdown from the attributed projects; both are honest views.
export const useSofiaCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "sofia", fiscalYear] as const,
    queryFn: () =>
      fetchJson<SofiaCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/sofia-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Varna's annual Капиталова програма (Приложение №4) — OCR'd via Gemini
// Vision from the rasterized varnacouncil.bg PDF, then rolled up into
// the same shape as Plovdiv. Five райони (Одесос, Приморски, Младост,
// Аспарухово, Владислав Варненчик) rendered stacked on the city's
// settlement / município page. Tile headline is the itemised sum
// (Ruse/SZ convention); the OCR'd "ОБЩО" figure is preserved on
// `publishedRecap` for reference.
export const useVarnaCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "varna", fiscalYear] as const,
    queryFn: () =>
      fetchJson<VarnaCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/varna-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Pleven's annual Капиталова програма (Приложения №4 + №10А) — OCR'd via
// Gemini Vision from the budget docket PDF. Single município, no райони.
// The structural dimension we expose is per-settlement (city + outlying
// villages) + per-funding-source (преходни остатъци / целеви субсидии /
// EU projects). Itemised sum 9.5M EUR matches published combined recap
// (Прил. №4 + №10А) exactly. Tile mirrors the Stara Zagora pattern.
export const usePlevenCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "pleven", fiscalYear] as const,
    queryFn: () =>
      fetchJson<PlevenCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/pleven-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Plovdiv's annual Капиталова програма — parsed from a borderless PDF on
// plovdiv.bg into ~567 line items + per-район rollup. Plovdiv has a single
// settlement record for the whole city, so the tile renders all 6 райони
// stacked instead of filtering to one (Sofia's pattern).
//
// Parser quality: project-sum is ~46M EUR (recap headline 71.4M EUR).
// The 25M EUR gap reflects the source-document convention: the recap is
// the published city-wide ОБЩО including non-itemized commitments
// (transfers, some EU-cofinanced items, paragraph-level rollups that
// don't decompose to individual line items). The same pattern appears
// in Ruse (recap 49.5M EUR vs per-sheet sum 26.2M EUR). The tile shows
// the recap as the headline (correct) and the per-project list contains
// only the items that DO carry a specific § code + description — no
// generic Дейност-category labels leak into top-N.
export const usePlovdivCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "plovdiv", fiscalYear] as const,
    queryFn: () =>
      fetchJson<PlovdivCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/plovdiv-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Burgas's annual Капиталова програма — extracted from the city's draft-
// budget XLSX workbook. Not районирана, so the tile groups by funding
// source (state subsidy / own / debt / EU / other / carry-over) instead
// of by район, plus a per-settlement strip for the ~14% of projects that
// name a village or city quarter in their description.
export const useBurgasCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "burgas", fiscalYear] as const,
    queryFn: () =>
      fetchJson<BurgasCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/burgas-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Ruse's annual капиталова програма — parsed from the обshtinaruse.bg
// year-end XLSX. Single município, but with DEDICATED PER-VILLAGE
// SHEETS — sub-settlement attribution is via workbook structure, so the
// LOCALISATION of any captured project to a village is 100% accurate
// (no free-text regex).
//
// Per-project amount = col F (Уточнен план = revised plan for the
// fiscal year). The recap headline is computed as the sum of per-sheet
// ОБЩО col F values across all 70 spending-unit sheets — this matches
// the per-project list to the byte. The Общо sheet's own R8 col F
// shows a HIGHER figure (~96.8M BGN vs 51.3M BGN per-sheet sum for
// 2025) because it includes a city-wide "Преходен остатък ДДД"
// (delegated-state-activity carry-over, idx 21 ≈ 49.5M BGN) that
// doesn't decompose to any individual spending unit. Using it as the
// recap would make the tile show a number the per-project list can't
// substantiate, so we deliberately don't.
export const useRuseCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "ruse", fiscalYear] as const,
    queryFn: () =>
      fetchJson<RuseCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/ruse-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Stara Zagora's annual Капиталова програма (Приложение №4) — parsed
// from the council-budget PDF via `pdftotext -layout` (clean row-based
// extraction). The tile shows the itemised sum (~14M EUR) as the
// headline so it equals what the per-project list sums to — same
// Ruse-style convention. The PDF's own "КАПИТАЛОВИ РАЗХОДИ - ОБЩО"
// recap (29.3M EUR) is kept on the JSON's `publishedRecap` field for
// reference but not surfaced as the tile headline because the gap
// (city-wide commitments, paragraph-level rollups) can't be substantiated
// from the line-item list users can drill into.
export const useStaraZagoraCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: [
      "budget",
      "capital_programs",
      "stara_zagora",
      fiscalYear,
    ] as const,
    queryFn: () =>
      fetchJson<StaraZagoraCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/stara_zagora-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Shumen — Tier-2 oblast capital (SHU30, 27 settlements). 15-page
// born-digital PDF found via the Playwright budget-portal harvester.
// Same shape as Sliven (per-village rollup + top projects).
export const useShumenCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "shumen", fiscalYear] as const,
    queryFn: () =>
      fetchJson<ShumenCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/shumen-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Asenovgrad — large second-tier town (PDV01, Plovdiv oblast). Single
// município with 29 settlements; OCR-derived from a 10-page born-digital
// PDF. Same shape as Sliven (per-village rollup + top projects).
export const useAsenovgradCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "asenovgrad", fiscalYear] as const,
    queryFn: () =>
      fetchJson<AsenovgradCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/asenovgrad-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Dobrich — Tier-2 oblast capital, single-settlement município (DOB28).
// Sourced from an inline HTML table on dobrich.bg (no OCR / PDF needed).
// Tile pattern: Burgas-style funding-source mini-grid + top projects.
export const useDobrichCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "dobrich", fiscalYear] as const,
    queryFn: () =>
      fetchJson<DobrichCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/dobrich-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Sliven — Tier-2 oblast capital, single município (SLV20, EKATTE 67338).
// Same shape as Stara Zagora (per-village rollup, "honest tile" with
// itemised total as headline + publishedRecap preserved). Source is a
// 23-page rasterized PDF on mun.sliven.bg, OCR'd by sliven_ocr.ts.
export const useSlivenCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "sliven", fiscalYear] as const,
    queryFn: () =>
      fetchJson<SlivenCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/sliven-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Vidin — Tier-2 oblast capital (VID09, 34 settlements). The
// year-end "Отчет капиталови разходи" .doc is parsed directly by
// vidin.ts (no OCR — born-text). 2023 ingest covers a 90%
// settlement-tagged execution report, currently the only year on
// disk; back-years exist on vidin.bg and could be added the same way.
export const useVidinCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "vidin", fiscalYear] as const,
    queryFn: () =>
      fetchJson<VidinCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/vidin-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Самоков — Sofia-oblast município (SFO39, 28 settlements). Born-
// digital PDF on samokov.bg; OCR via Gemini Vision.
export const useSamokovCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "samokov", fiscalYear] as const,
    queryFn: () =>
      fetchJson<SamokovCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/samokov-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Велинград — Pazardjik-oblast município (PAZ08, 21 settlements).
// Born-digital PDF on m.velingrad.bg; OCR via Gemini Vision.
export const useVelingradCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "velingrad", fiscalYear] as const,
    queryFn: () =>
      fetchJson<VelingradCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/velingrad-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Дупница — Kyustendil-oblast município (KNL48, 17 settlements).
// Born-digital MINFIN B3 PDF on dupnitsa.bg; OCR via Gemini Vision.
export const useDupnitsaCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "dupnitsa", fiscalYear] as const,
    queryFn: () =>
      fetchJson<DupnitsaCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/dupnitsa-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Ловеч — Oblast capital (LOV18, 35 settlements). Scanned PDF, capital
// section on pages 36-42, OCR via Gemini Vision. Multi-column layout
// where OCR sometimes mis-picks a column; publishedRecap is overridden
// with the council's authoritative total and the tile uses it for the
// headline. Per-village breakdown remains useful for relative rankings.
export const useLovechCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "lovech", fiscalYear] as const,
    queryFn: () =>
      fetchJson<LovechCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/lovech-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Кърджали — Oblast capital (KRZ16, 118 settlements). Born-digital
// landscape PDF discovered via Google indexing. OCR via Gemini Vision.
export const useKardzhaliCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "kardzhali", fiscalYear] as const,
    queryFn: () =>
      fetchJson<KardzhaliCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/kardzhali-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Ямбол — Oblast capital (JAM26), single-settlement. Capital list
// from Прил. 4 (2022-2024) / Прил. 5 (2025) inside the council budget
// archive. PDF via Gemini Vision OCR.
export const useYambolCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "yambol", fiscalYear] as const,
    queryFn: () =>
      fetchJson<YambolCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/yambol-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Габрово — Oblast capital (GAB05, 134 settlements). 9-page born-
// digital landscape PDF on gabrovo.bg; OCR via Gemini Vision.
export const useGabrovoCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "gabrovo", fiscalYear] as const,
    queryFn: () =>
      fetchJson<GabrovoCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/gabrovo-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Хасково — Oblast capital (HKV34, 37 settlements). 19-page born-
// digital landscape PDF on haskovo.bg; OCR via Gemini Vision.
export const useHaskovoCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "haskovo", fiscalYear] as const,
    queryFn: () =>
      fetchJson<HaskovoCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/haskovo-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Перник — Oblast capital (PER32, 24 settlements). Single-sheet XLS
// on pernik.bg, already in EUR (post-euro). No OCR needed.
export const usePernikCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "pernik", fiscalYear] as const,
    queryFn: () =>
      fetchJson<PernikCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/pernik-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Велико Търново — Tier-2 oblast capital (VTR04, 89 settlements). Source
// is a clean XLSX with a dedicated "Pril15" sheet (Инвестиционна програма) —
// no OCR. 2025 plan covers 382 projects totalling ~€47.1M.
export const useVelikoTarnovoCapitalProgram = (
  fiscalYear: number | undefined,
) =>
  useQuery({
    queryKey: [
      "budget",
      "capital_programs",
      "veliko_tarnovo",
      fiscalYear,
    ] as const,
    queryFn: () =>
      fetchJson<VelikoTarnovoCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/veliko_tarnovo-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Карлово — Plovdiv-oblast município (PDV13, 27 settlements). Source is
// a clean XLSX (Приложение № 7 — план за финансиране на капиталови
// разходи) on karlovo.bg — no OCR. 2025 plan covers 136 projects
// totalling ~€15.0M.
export const useKarlovoCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "karlovo", fiscalYear] as const,
    queryFn: () =>
      fetchJson<KarlovoCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/karlovo-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// МРРБ IPOP — Инвестиционна програма за общински проекти. National
// summary file (~80KB) carries totals + per-município / per-oblast
// aggregates; per-município shard files carry the full project list
// for that município.
export const useIpopNational = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "ipop", "national", fiscalYear] as const,
    queryFn: () =>
      fetchJson<IpopNationalFile>(`/budget/ipop/${fiscalYear}.json`),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const useIpopMunicipality = (obshtinaCode: string | undefined) =>
  useQuery({
    queryKey: ["budget", "ipop", "municipality", obshtinaCode] as const,
    queryFn: () =>
      fetchJson<IpopMunicipalityFile>(
        `/budget/ipop/municipalities/${obshtinaCode}.json`,
      ),
    enabled: !!obshtinaCode,
    staleTime: Infinity,
  });

// Монтана — Montana oblast capital (MON29, 24 settlements). Source is
// the council's 5-page scanned "Капиталова програма за 2025 г." on
// montana.bg — OCR via Gemini Vision. Parser uses page 5 (consolidated
// summary) only; pages 1-4 are funding-source sub-appendices that
// would double-count. 2025: 9 projects, ~€29.1M.
export const useMontanaCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "montana", fiscalYear] as const,
    queryFn: () =>
      fetchJson<MontanaCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/montana-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Кюстендил — Kyustendil oblast capital (KNL29, 72 settlements).
// Source is Прил. №6 inside the council's "Окончателен годишен план"
// PDF on obs.kyustendil.bg — OCR via Gemini Vision after pre-slicing
// pages 30-40. 2025 final plan: 246 projects, ~€11.0M.
export const useKyustendilCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "kyustendil", fiscalYear] as const,
    queryFn: () =>
      fetchJson<KyustendilCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/kyustendil-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Казанлък — Stara Zagora oblast município (SZR12, 20 settlements).
// Source is the council's "Приложения" PDF (Приложение №4 — Проект на
// инвестиционна програма); URL discovered via the kazanlak.bg Nuxt
// _payload.json. OCR via Gemini Vision. 2025 plan covers 201 projects
// totalling ~€7.9M.
export const useKazanlakCapitalProgram = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "capital_programs", "kazanlak", fiscalYear] as const,
    queryFn: () =>
      fetchJson<KazanlakCapitalProgramFile>(
        `/budget/capital_programs/${fiscalYear}/kazanlak-tile.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

// Generic top-projects-from-capital-programme reader for the My-Area
// tile. The per-município hooks above each return tile-specific typed
// shapes (Sofia has byRayon, Burgas has bySettlement, Pleven has
// byFundingSource, etc.); this hook returns a slim, schema-agnostic
// view — top N projects by amountEur + grand total + fiscal year —
// suitable for surfacing on a card that doesn't need the full plan.
//
// Most wired municípios ship a 2025-cycle plan. CAPITAL_PROGRAMS_LATEST
// records the most recent fiscal year on disk per município (2025 by
// default; older for the few stragglers, 2026 for Pernik). When a new
// year lands for a slug, update this table.

const OBSHTINA_TO_CAPITAL_SLUG: Record<string, string> = {
  SOF00: "sofia",
  SOF46: "sofia", // Sofia município shape (vs the per-район S2xxx)
  VAR06: "varna",
  PDV22: "plovdiv",
  BGS04: "burgas",
  PVN24: "pleven",
  RSE25: "ruse",
  SZR23: "stara_zagora",
  SHU30: "shumen",
  PDV01: "asenovgrad",
  DOB28: "dobrich",
  SLV20: "sliven",
  VID09: "vidin",
  SFO39: "samokov",
  PAZ08: "velingrad",
  KNL48: "dupnitsa",
  LOV18: "lovech",
  KRZ16: "kardzhali",
  JAM26: "yambol",
  GAB05: "gabrovo",
  HKV34: "haskovo",
  PER32: "pernik",
  VTR04: "veliko_tarnovo",
  PDV13: "karlovo",
  MON29: "montana",
  KNL29: "kyustendil",
  SZR12: "kazanlak",
};

const CAPITAL_PROGRAMS_DEFAULT_YEAR = 2025;
const CAPITAL_PROGRAMS_LATEST: Record<string, number> = {
  pernik: 2026,
  haskovo: 2024, // 2025 not yet ingested
  vidin: 2023, // 2024-2025 not yet ingested
};
const capitalProgramLatestYear = (slug: string): number =>
  CAPITAL_PROGRAMS_LATEST[slug] ?? CAPITAL_PROGRAMS_DEFAULT_YEAR;

/** Resolve an obshtina code to its capital-programme slug. Sofia districts
 *  (S2xxx) roll up to "sofia" — the city-wide programme covers them. */
const capitalProgramSlugForObshtina = (
  obshtina: string | undefined,
): string | null => {
  if (!obshtina) return null;
  if (/^S2\d{3}$/.test(obshtina)) return "sofia";
  return OBSHTINA_TO_CAPITAL_SLUG[obshtina] ?? null;
};

export type CapitalProgramTopProject = {
  id?: number | string;
  name: string;
  totalEur: number;
};

export type CapitalProgramTileSlim = {
  fiscalYear: number;
  grandTotalEur: number;
  topProjects: CapitalProgramTopProject[];
  /** "rayon" when the projects are filtered to a Sofia район (we found
   *  enough tagged projects to fill the top-N); "city" when we're
   *  showing the município-wide list. */
  scope: "rayon" | "city";
  /** When scope is "rayon", the район code we filtered by (e.g.
   *  "SREDETS"). Null otherwise. */
  rayonCode: string | null;
};

type CapitalProgramRawTile = {
  fiscalYear: number;
  recapitulation?: { total?: { amountEur?: number } };
  projects?: Array<{
    id?: number | string;
    name?: string;
    total?: { amountEur?: number };
    rayons?: string[];
  }>;
  // Sofia tile only: per-район rollup with the район's own topProjects
  // list. tile.json's top-level `projects[]` carries only the city-wide
  // top ~30 — too few to give most districts three rows. byRayon[].topProjects
  // is pre-computed against the full project set.
  byRayon?: Array<{
    code: string;
    projectCount: number;
    topProjects?: Array<{
      id?: number | string;
      name?: string;
      total?: { amountEur?: number };
    }>;
  }>;
};

export const useCapitalProgramsTopProjects = (
  obshtina: string | undefined,
  topN = 3,
) => {
  const slug = capitalProgramSlugForObshtina(obshtina);
  // For Sofia districts (S2xxx) we try to filter the city-wide capital
  // programme to projects tagged with this район — more personally
  // relevant than the city-wide top-3. The Sofia tile schema records
  // each project's rayons[] (capital_programs/sofia.ts emits these from
  // the район text in the project name + a curated mapping). If the
  // район has fewer than topN tagged projects we fall back to city-wide.
  const rayonCode = obshtina ? rayonFromObshtina(obshtina) : null;
  return useQuery({
    queryKey: [
      "budget",
      "capital_programs",
      "top_projects",
      slug,
      rayonCode,
      topN,
    ] as const,
    queryFn: async (): Promise<CapitalProgramTileSlim | null> => {
      if (!slug) return null;
      const year = capitalProgramLatestYear(slug);
      const file = await fetchJson<CapitalProgramRawTile>(
        `/budget/capital_programs/${year}/${slug}-tile.json`,
      );
      // fetchJson returns null on 404. Guard against that so a stale
      // CAPITAL_PROGRAMS_LATEST entry doesn't surface as an exception.
      if (!file) return null;

      const cityProjects = (file.projects ?? []).filter(
        (p) => (p.total?.amountEur ?? 0) > 0 && !!p.name,
      );
      const cityTop = [...cityProjects]
        .sort((a, b) => (b.total?.amountEur ?? 0) - (a.total?.amountEur ?? 0))
        .slice(0, topN);

      // Sofia район path — use the pre-computed byRayon[].topProjects
      // for the user's район (it ranks against the full project set,
      // whereas tile.json's top-level `projects[]` is only the city-wide
      // top ~30, which leaves most districts with 0-1 hits even when they
      // have a dozen projects). Fall back to city-wide if the район
      // isn't in byRayon or has < topN projects.
      let scope: "rayon" | "city" = "city";
      let topProjects: Array<{
        id?: number | string;
        name?: string;
        total?: { amountEur?: number };
      }> = cityTop;
      if (rayonCode && slug === "sofia") {
        const rayonEntry = file.byRayon?.find((r) => r.code === rayonCode);
        const rayonTop = (rayonEntry?.topProjects ?? [])
          .filter((p) => (p.total?.amountEur ?? 0) > 0 && !!p.name)
          .slice(0, topN);
        if (rayonTop.length >= topN) {
          scope = "rayon";
          topProjects = rayonTop;
        }
      }

      const mapped = topProjects.map((p) => ({
        id: p.id,
        name: p.name!,
        totalEur: p.total?.amountEur ?? 0,
      }));
      return {
        fiscalYear: file.fiscalYear,
        grandTotalEur: file.recapitulation?.total?.amountEur ?? 0,
        topProjects: mapped,
        scope,
        rayonCode: scope === "rayon" ? rayonCode : null,
      };
    },
    enabled: !!slug,
    staleTime: Infinity,
  });
};

// Policy-simulator baseline — one small derived file carrying the executed
// revenue lines, pre-scaled VAT consumption slices + calibration, and the
// МОД-cap identity aggregates. Assembled by run_policy_baseline.ts.
export const usePolicyBaseline = () =>
  useQuery({
    queryKey: ["budget", "policy-baseline"] as const,
    queryFn: () =>
      fetchJson<PolicyBaselineFile>("/budget/derived/policy_baseline.json"),
    staleTime: Infinity,
  });

// Municipal cash-execution (касово изпълнение по ЕБК) — plan-vs-actual revenue
// and expense by economic paragraph, sourced from the MINFIN B3 report a few
// общини publish to data.egov.bg. The index lists covered munis + years; the
// per-(muni, year) file is small (~12 KB), so no tile-shrink sidecar.
export const useMunicipalExecutionIndex = () =>
  useQuery({
    queryKey: ["budget", "municipal-execution", "index"] as const,
    queryFn: () =>
      fetchJson<MunicipalExecutionIndexFile>(
        "/budget/municipal_execution/index.json",
      ),
    staleTime: Infinity,
  });

export const useMunicipalExecution = (
  muniSlug: string | undefined,
  fiscalYear: number | undefined,
) =>
  useQuery({
    queryKey: ["budget", "municipal-execution", muniSlug, fiscalYear] as const,
    queryFn: () =>
      fetchJson<MunicipalExecutionFile>(
        `/budget/municipal_execution/${muniSlug}/${fiscalYear}.json`,
      ),
    enabled: !!muniSlug && !!fiscalYear,
    staleTime: Infinity,
  });
