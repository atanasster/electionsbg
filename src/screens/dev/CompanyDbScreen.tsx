// DB-backed company page (/company/:eik). Works for ANY registered company —
// including the ~1M TR companies with no procurement (hence no JSON shard). Fed
// live from Postgres via /api/db/company: TR identity + capital, officers with
// ownership %, political connections, and a link out to the full procurement
// dashboard when the company has contracts. Served by /api/db — the Vite plugin
// in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  Building2,
  Landmark,
  Users,
  ArrowRight,
  Coins,
  FileText,
  Ban,
  Target,
  Sprout,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { type AgriRecipientFile } from "@/data/agri/types";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import { formatEur, formatEurCompact, toEur } from "@/lib/currency";
import { useTranslation } from "react-i18next";
import { StatCard } from "../dashboard/StatCard";
import { CompanyTopContractsTile } from "../components/procurement/CompanyTopContractsTile";
import { CompanyTopAwardersTile } from "../components/procurement/CompanyTopAwardersTile";
import { CompanyByYearChart } from "../components/procurement/CompanyByYearChart";
import { CompanyBuyerConcentrationTile } from "../components/procurement/CompanyBuyerConcentrationTile";
import {
  CompanyBuyerCaptureTile,
  type BuyerRelationships,
} from "../components/procurement/CompanyBuyerCaptureTile";
import { type SectorRank } from "../components/procurement/CompanySectorRankTile";
import { CompanySectorsTile } from "../components/procurement/CompanySectorsTile";
import {
  CompanyRelatedTile,
  type RelatedCompany,
} from "../components/procurement/CompanyRelatedTile";
import {
  CompanyGeographyTile,
  type CompanyGeography,
} from "../components/procurement/CompanyGeographyTile";
import { AwarderTopContractorsTile } from "../components/procurement/AwarderTopContractorsTile";
import { AwarderTendersTile } from "../components/procurement/AwarderTendersTile";
import { AwarderAppealsTile } from "../components/procurement/AwarderAppealsTile";
import { ProcurementBreakdownTile } from "../components/procurement/ProcurementBreakdownTile";
import { CompanyPortfolioTreemap } from "../components/procurement/CompanyPortfolioTreemap";
import { EntityFlowTile } from "../components/procurement/EntityFlowTile";
import { type EntityFlowMpEdge } from "@/data/procurement/entityFlow";
import { getSectorPack } from "../components/procurement/sectorPacks";
import { canonicalAwarderName } from "@/lib/awarderNameOverrides";
import { AwarderBreadcrumb } from "../components/procurement/AwarderBreadcrumb";
import { SectorBreadcrumb } from "../components/procurement/SectorBreadcrumb";
import { sectorDashboardForLeadEik } from "../sector/sectorDashboards";
import { ProcurementBenchmarksTile } from "../components/procurement/ProcurementBenchmarksTile";
import { type ProcurementBenchmarksFile } from "@/data/procurement/useProcurementBenchmarks";
import { CompanyRiskChips } from "../components/procurement/CompanyRiskChips";
import {
  CompanyRetailChainTile,
  type RetailChainInfo,
} from "../components/procurement/CompanyRetailChainTile";
import {
  EntityRiskGradeCard,
  type EntityRiskGrade,
} from "../components/procurement/EntityRiskGradeCard";
import {
  CompanyFundsTile,
  type FundProjectRow,
} from "../components/procurement/CompanyFundsTile";
import { CompanyConnectionCheck } from "../components/procurement/CompanyConnectionCheck";
import { CompanyPoliticalLinks } from "../components/CompanyPoliticalLinks";
import { CompanyMagistratesTile } from "../components/procurement/CompanyMagistratesTile";
import { NzokHospitalReimbursementTile } from "../components/procurement/nzok/NzokHospitalReimbursementTile";
import { NzokActivityByEikTile } from "../components/procurement/nzok/NzokActivityByEikTile";
import { NzokReportCardTile } from "../components/procurement/nzok/NzokReportCardTile";
import { NzokDrugOverpayByEikTile } from "../components/procurement/nzok/NzokDrugOverpayByEikTile";
import { NzokFinancialHealthStrip } from "@/screens/components/procurement/nzok/NzokFinancialHealthStrip";
import { NgoSignalPills } from "@/screens/components/procurement/NgoSignalPills";
import { type NgoSignal } from "@/screens/components/procurement/ngoSignalMeta";

interface NgoBoardLink {
  person: string;
  ref: string;
  kind: string;
  role: string | null;
  position: string | null;
  confidence: string;
}
import { SchoolIdentityTile } from "../components/procurement/mon/SchoolIdentityTile";
import {
  CabinetTimelineTile,
  type CabinetRow,
} from "../components/procurement/CabinetTimelineTile";
import type {
  ProcurementContractorRollup,
  ProcurementAwarderRollup,
  ProcurementBreakdown,
} from "@/data/dataTypes";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import { trRoleLabel } from "@/lib/trRole";
import { legalFormLabel } from "@/lib/legalForm";
import { decodeEntities } from "@/lib/decodeEntities";
import { ScopeControl } from "../components/ScopeControl";
import { scopeYear, useScope } from "@/data/scope/useScope";
import { scopeRange } from "@/data/scope/scopeRange";
import { useElectionContext } from "@/data/ElectionContext";
import { useHashScroll } from "@/ux/useHashScroll";

interface Company {
  uic: string;
  name: string | null;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  funds_amount: string | number | null;
  funds_currency: string | null;
  entity_class: string | null;
  ngo_type: string | null;
}
// ЮЛНЦ metadata sidecar (цели/полза) — null for commercial entities.
interface NgoDetails {
  public_benefit: boolean | null;
  private_benefit: boolean | null;
  objectives: string | null;
  means: string | null;
}
const NGO_CLASSES = new Set(["ngo_assoc", "ngo_found", "chitalishte"]);
// Awarder K-Index — share of a buyer's contract value to politically linked
// suppliers (from awarder_kindex()).
interface KindexSupplier {
  eik: string;
  name: string | null;
  eur: number;
  n: number;
  politicians: { politician: string; ref: string; kind: string }[] | null;
}
interface AwarderKindex {
  totalEur: number;
  supplierCount: number;
  linkedEur: number;
  linkedSupplierCount: number;
  sharePct: number;
  suppliers: KindexSupplier[];
}
// External funding received by an NGO (EU direct / state subsidy / foreign grant).
interface NgoFunding {
  totalEur: number;
  bySource: { source: string; funder: string | null; eur: number; n: number }[];
  rows: {
    source: string;
    funder: string | null;
    year: number | null;
    programme: string | null;
    eur: number;
  }[];
}
const FUNDING_SOURCE_LABEL: Record<string, { bg: string; en: string }> = {
  eu_fts: { bg: "ЕС (пряко управление)", en: "EU (direct)" },
  budget_subsidy: { bg: "Държавна субсидия", en: "State subsidy" },
  abf: { bg: "Фондация Америка за България", en: "America for Bulgaria Fdn" },
  ned: { bg: "NED", en: "NED" },
};
interface Summary {
  contracts: number;
  contracts_eur: number;
}
interface Officer {
  name: string;
  role: string | null;
  share: string | number | null;
  share_amount: string | number | null;
  share_currency: string | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
}
interface Politician {
  politician: string;
  ref: string;
  kind: string;
  role: string | null;
  total_eur: number | null;
  relations?: unknown;
}
interface Debarred {
  name: string;
  debarred_until: string | null;
  details_url: string | null;
  published_at: string | null;
}
interface Funds {
  name: string | null;
  org_type: string | null;
  contract_count: number | null;
  contracted_eur: number | null;
  paid_eur: number | null;
}
// Synthesised identity for an EIK that isn't in the commercial register but
// appears as an awarder / fund beneficiary (state agencies, ministries).
interface Institution {
  name: string | null;
  region: string | null;
  locality: string | null;
  orgType: string | null;
  isAwarder: boolean;
  isBeneficiary: boolean;
  isContractor: boolean;
  buyContractCount: number;
  buyTotalEur: number;
  buyContractorCount: number;
}

// The buy-side rollup from awarder_procurement() — the ProcurementAwarderRollup
// fields (minus eik/name/generatedAt/seat, filled client-side).
type DbAwarderRollup = Pick<
  ProcurementAwarderRollup,
  | "totalEur"
  | "totalOther"
  | "contractCount"
  | "awardCount"
  | "byContractor"
  | "byYear"
  | "topContracts"
> & {
  contractorCount: number;
  amendmentCount: number;
  // awarder_procurement() emits the same breakdown block as company_procurement
  // (CPV divisions + procedure mix + EU share + bid-count competition) — feeds
  // the buy-side "Какво купува" tile and the EU-threshold benchmarks tile.
  breakdown?: {
    totalEur: number;
    cpvKnownEur: number;
    procKnownEur: number;
    euEur: number;
    euKnownEur: number;
    bidKnownN?: number;
    singleBidN?: number;
    noCallN?: number;
    methodKnownN?: number;
    cpvRaw: { d: string; eur: number; n: number }[];
    procRaw: { method: string; eur: number; n: number }[];
  };
};

// The procurement rollup from company_procurement() — the ProcurementContractorRollup
// fields (minus eik/name/generatedAt, filled client-side) + the raw breakdown
// aggregation the CPV/procedure tile buckets client-side.
type DbRollup = Pick<
  ProcurementContractorRollup,
  | "totalEur"
  | "totalOther"
  | "contractCount"
  | "awardCount"
  | "byAwarder"
  | "byYear"
  | "topContracts"
> & {
  awarderCount: number;
  amendmentCount: number;
  // Consortium / framework participation (stored model, migration 087). `totalEur`
  // is now SOLO work only (a member firm's joint rows are €0). `consortiumEur` is
  // the FULL value of the joint contracts this firm took part in as an обединение
  // member — NOT a slice of totalEur, and not an estimate of its share (which isn't
  // public). `frameworkEur` is the part of totalEur won via рамкови споразумения
  // (shared ceiling). `consortiumMembers` lists this entity's members when the page
  // itself IS a consortium (carrier) entity.
  consortiumEur?: number;
  consortiumCount?: number;
  frameworkEur?: number;
  frameworkCount?: number;
  consortiumMembers?: Array<{ eik: string; name: string }>;
  breakdown: {
    totalEur: number;
    cpvKnownEur: number;
    procKnownEur: number;
    euEur: number;
    euKnownEur: number;
    bidKnownN?: number;
    singleBidN?: number;
    noCallN?: number;
    methodKnownN?: number;
    cpvRaw: { d: string; eur: number; n: number }[];
    procRaw: { method: string; eur: number; n: number }[];
  };
};

// Kicker label by entity_class (BG / EN). NGO classes get an "Организация с
// нестопанска цел" framing; foreign branches and state enterprises their own.
const ENTITY_CLASS_KICKER: Record<string, { bg: string; en: string }> = {
  ngo_assoc: { bg: "Сдружение (ЮЛНЦ)", en: "Association (NPO)" },
  ngo_found: { bg: "Фондация (ЮЛНЦ)", en: "Foundation (NPO)" },
  chitalishte: { bg: "Народно читалище", en: "Community centre (chitalishte)" },
  coop: { bg: "Кооперация", en: "Cooperative" },
  foreign_branch: {
    bg: "Клон на чуждестранно лице",
    en: "Foreign entity branch",
  },
  state_enterprise: { bg: "Държавно предприятие", en: "State enterprise" },
};

// Bucket a raw awarder/company breakdown (CPV divisions + per-method sums, as
// emitted by *_procurement()) into the ProcurementBreakdown the breakdown tile
// expects. Shared by the contractor ("В кои сектори печели") and awarder
// ("Какво купува") sides so both use identical procedure bucketing.
const toBreakdown = (
  eik: string,
  bd: {
    totalEur: number;
    cpvKnownEur: number;
    procKnownEur: number;
    euEur: number;
    euKnownEur: number;
    cpvRaw: { d: string; eur: number; n: number }[];
    procRaw: { method: string; eur: number; n: number }[];
  },
): ProcurementBreakdown => {
  const byBucket = new Map<ProcedureBucket, { eur: number; n: number }>();
  for (const p of bd.procRaw) {
    const b = procedureBucket(p.method);
    const cur = byBucket.get(b) ?? { eur: 0, n: 0 };
    cur.eur += p.eur;
    cur.n += p.n;
    byBucket.set(b, cur);
  }
  return {
    eik,
    totalEur: bd.totalEur,
    cpvKnownEur: bd.cpvKnownEur,
    procKnownEur: bd.procKnownEur,
    euEur: bd.euEur,
    euKnownEur: bd.euKnownEur,
    cpv: bd.cpvRaw,
    proc: [...byBucket].map(([b, v]) => ({ b, eur: v.eur, n: v.n })),
  };
};

// EU-threshold benchmark inputs for one entity, taken straight from the four
// competition counts *_procurement() computes the SAME way as the national
// procurement_benchmarks (037) — competitive-only single-bid denominator, the
// direct-method no-call list. So an entity's number is genuinely its slice of
// the national figure, and the ≤10%/>20% thresholds apply unchanged.
const entityBenchmarks = (
  contractCount: number,
  bd: {
    bidKnownN?: number;
    singleBidN?: number;
    noCallN?: number;
    methodKnownN?: number;
  },
): ProcurementBenchmarksFile => ({
  total: contractCount,
  singleBidder: { single: bd.singleBidN ?? 0, known: bd.bidKnownN ?? 0 },
  noCall: { noCall: bd.noCallN ?? 0, methodKnown: bd.methodKnownN ?? 0 },
});

const num = new Intl.NumberFormat("bg-BG");
// Officers shown inline on the dashboard; the rest live on the standalone
// backend-paginated /company/:eik/officers table.
const OFFICERS_PREVIEW = 10;
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: string | number | null): string =>
  s === null || s === undefined || s === "" ? "—" : `${Math.round(Number(s))}%`;

export const CompanyDbScreen: FC = () => {
  const { eik = "" } = useParams();
  // This same screen backs both /company/:eik (contractor view) and
  // /awarder/:eik (buyer view); the route decides which breadcrumb trail to show.
  const isAwarderRoute = useLocation().pathname.startsWith("/awarder/");

  const [company, setCompany] = useState<Company | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // All-time (UNSCOPED) awarder activity — "does this entity award anything, ever?".
  // Lets an empty scope say where the data actually is instead of rendering blank.
  const [awarderAllTime, setAwarderAllTime] = useState<{
    contracts: number;
    total_eur: number;
  } | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [politicians, setPoliticians] = useState<Politician[]>([]);
  const [procurement, setProcurement] = useState<DbRollup | null>(null);
  const [cabinets, setCabinets] = useState<CabinetRow[]>([]);
  const [debarred, setDebarred] = useState<Debarred[]>([]);
  const [funds, setFunds] = useState<Funds | null>(null);
  const [fundProjects, setFundProjects] = useState<FundProjectRow[]>([]);
  const [relationships, setRelationships] = useState<BuyerRelationships | null>(
    null,
  );
  const [sectors, setSectors] = useState<SectorRank[] | null>(null);
  const [related, setRelated] = useState<RelatedCompany[] | null>(null);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [geography, setGeography] = useState<CompanyGeography | null>(null);
  const [awarderProc, setAwarderProc] = useState<DbAwarderRollup | null>(null);
  const [ngoDetails, setNgoDetails] = useState<NgoDetails | null>(null);
  const [awarderKindex, setAwarderKindex] = useState<AwarderKindex | null>(
    null,
  );
  const [ngoFunding, setNgoFunding] = useState<NgoFunding | null>(null);
  const [ngoSignals, setNgoSignals] = useState<NgoSignal[] | null>(null);
  const [ngoBoardLinks, setNgoBoardLinks] = useState<NgoBoardLink[] | null>(
    null,
  );
  const [subsidies, setSubsidies] = useState<AgriRecipientFile | null>(null);
  const [retailChain, setRetailChain] = useState<RetailChainInfo | null>(null);
  const [awarderGrade, setAwarderGrade] = useState<EntityRiskGrade | null>(
    null,
  );
  const [supplierGrade, setSupplierGrade] = useState<EntityRiskGrade | null>(
    null,
  );
  // Name as it appears in the procurement corpus — the only identity we have
  // for a contractor/awarder absent from the TR register.
  const [corpusName, setCorpusName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Section scope, URL-backed via ?pscope — the SAME semantics as the rest of
  // the procurement section (absent = "this parliament"; "all"/"y:<year>" are
  // written to the URL). Sharing useScope means the scope no longer
  // silently flips when you navigate between the hub/section and an entity page,
  // which used to happen because this page treated an absent param as "all".
  const { scope, setScope } = useScope();
  // Latches true once the entity is known to be an awarder, so narrowing the
  // scope to an empty window can't hide the control (which would strand the user
  // with no way back to "all").
  const [hadAwarder, setHadAwarder] = useState(false);
  const { selected } = useElectionContext();
  const { t, i18n } = useTranslation();

  // The active [from, to] window from the local scope control — INCLUSIVE, as the
  // scoped DB endpoints (awarder_procurement …) filter `date <= to`.
  const [from, to] = useMemo(
    () => scopeRange(scope, selected),
    [scope, selected],
  );
  // Sector packs re-scope CLIENT-SIDE with `scopeByWindow`, which is HALF-OPEN
  // (`date < to`). Feeding it the inclusive `to = YYYY-12-31` from scopeRange
  // silently drops contracts dated exactly 31 Dec under a `y:YYYY` scope, so
  // convert a single-year scope to its half-open next-year bound for the pack.
  // (`ns`'s `to` is already the next election date — correctly exclusive — and
  // `all` is null, so only `y:YYYY` needs adjusting.)
  const packWindow = useMemo(() => {
    const year = scopeYear(scope);
    return year != null
      ? { from: `${year}-01-01`, to: `${year + 1}-01-01` }
      : { from, to };
  }, [scope, from, to]);
  // A domain pack (e.g. roads for АПИ) rendered as a hero inside the awarder
  // section; null for the vast majority of awarders (generic page only).
  const SectorPack = useMemo(() => getSectorPack(eik), [eik]);
  // When this awarder IS the lead of a sector dashboard, its disbursement/
  // delivery pack has moved to /sector/:id — the awarder page stays the
  // institution's own ЗОП financials. Suppress the pack here and cross-link.
  const sectorDash = useMemo(() => sectorDashboardForLeadEik(eik), [eik]);
  const showPack = SectorPack && !sectorDash;

  // Deep links into a pack band (e.g. /awarder/121858220#nzok-drugs) must scroll
  // once the page settles. The generic awarder tiles above the pack load async
  // and shift height, so re-run the scroll as the main payloads arrive; the pack
  // itself runs the same hook for its own late-loading tiles.
  useHashScroll([loading, procurement, awarderProc]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const qs =
      `/api/db/company?eik=${encodeURIComponent(eik)}` +
      (from ? `&from=${from}` : "") +
      (to ? `&to=${to}` : "");
    fetch(qs)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else {
          // Names from TR/OCDS can carry HTML entities (&quot; …) — decode at the
          // boundary so every downstream use (header, awarder heading) is clean.
          setCompany(
            j.company
              ? { ...j.company, name: decodeEntities(j.company.name) }
              : null,
          );
          setSummary(j.summary);
          setOfficers(j.officers ?? []);
          setPoliticians(j.politicians ?? []);
          setProcurement(j.procurement ?? null);
          setCabinets(j.cabinets ?? []);
          setDebarred(j.debarred ?? []);
          setFunds(j.funds ?? null);
          setFundProjects(j.fundProjects ?? []);
          setRelationships(j.relationships ?? null);
          setSectors(j.sectors ?? null);
          setRelated(j.related ?? null);
          setInstitution(
            j.institution
              ? { ...j.institution, name: decodeEntities(j.institution.name) }
              : null,
          );
          setGeography(j.geography ?? null);
          setAwarderProc(j.awarderProcurement ?? null);
          setAwarderAllTime(j.awarderAllTime ?? null);
          // Latch on EITHER the scoped rollup or the all-time probe: the scoped one
          // is absent when you LAND on an empty window, which used to hide the scope
          // control and strand the reader (see the awarderAllTime note in db_routes).
          if (j.awarderProcurement || (j.awarderAllTime?.contracts ?? 0) > 0)
            setHadAwarder(true);
          setNgoDetails(j.ngoDetails ?? null);
          setAwarderKindex(j.awarderKindex ?? null);
          setNgoFunding(j.ngoFunding ?? null);
          setNgoSignals(j.ngoSignals ?? null);
          setNgoBoardLinks(j.ngoBoardLinks ?? null);
          setSubsidies(j.subsidies ?? null);
          setRetailChain(j.retailChain ?? null);
          setAwarderGrade(j.awarderRiskGrade ?? null);
          setSupplierGrade(j.supplierRiskGrade ?? null);
          setCorpusName(j.corpusName ? decodeEntities(j.corpusName) : null);
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eik, from, to]);

  const contracts = Number(summary?.contracts ?? 0);
  // A contractor can appear in the procurement corpus without a TR record (~32%
  // of distinct EIKs — foreign / deregistered suppliers the search deliberately
  // surfaces). We still have their contracts, so render the procurement body
  // instead of dead-ending on "Няма фирма …".
  const hasProcurement = contracts > 0 || hadAwarder;
  // Best available display name: curated override (collided shared-Булстат
  // EIKs) → TR record → synthesised institution → the procurement-corpus name →
  // bare EIK as a last resort.
  const displayName =
    canonicalAwarderName(eik) ??
    company?.name ??
    institution?.name ??
    corpusName ??
    eik;
  // Corpus-only entity: has procurement but no TR record and no institution
  // identity — surface it with a procurement kicker, not the TR-register one.
  const corpusOnly = !company && !institution && hasProcurement;

  // Assemble the ProcurementContractorRollup the existing tiles expect (add the
  // eik/name/generatedAt the endpoint omits).
  const rollup = useMemo<ProcurementContractorRollup | null>(
    () =>
      procurement
        ? {
            eik,
            name: displayName,
            totalEur: procurement.totalEur,
            totalOther: procurement.totalOther,
            contractCount: procurement.contractCount,
            awardCount: procurement.awardCount,
            awarderCount: procurement.awarderCount,
            byAwarder: procurement.byAwarder,
            byYear: procurement.byYear,
            topContracts: procurement.topContracts,
            generatedAt: "",
          }
        : null,
    [procurement, eik, displayName],
  );

  // Buy-side rollup for the DB awarder dashboard (when the EIK is an awarder).
  const awarderName = displayName;
  const awarderRollup = useMemo<ProcurementAwarderRollup | null>(
    () =>
      awarderProc
        ? {
            eik,
            name: awarderName,
            totalEur: awarderProc.totalEur,
            totalOther: awarderProc.totalOther,
            contractCount: awarderProc.contractCount,
            awardCount: awarderProc.awardCount,
            contractorCount: awarderProc.contractorCount,
            byContractor: awarderProc.byContractor,
            byYear: awarderProc.byYear,
            topContracts: awarderProc.topContracts,
            generatedAt: "",
          }
        : null,
    [awarderProc, eik, awarderName],
  );
  // The top-contracts tile takes a contractor-shaped rollup; feed it the
  // awarder's topContracts (party = the CONTRACTOR that was paid).
  const awarderContractsRollup = useMemo<ProcurementContractorRollup | null>(
    () =>
      awarderProc
        ? {
            eik,
            name: awarderName,
            totalEur: awarderProc.totalEur,
            totalOther: awarderProc.totalOther,
            contractCount: awarderProc.contractCount,
            awardCount: awarderProc.awardCount,
            awarderCount: awarderProc.contractorCount,
            byAwarder: [],
            byYear: awarderProc.byYear,
            topContracts: awarderProc.topContracts,
            generatedAt: "",
          }
        : null,
    [awarderProc, eik, awarderName],
  );

  // Bucket the raw procedure-method sums into the ProcedureBucket the breakdown
  // tile expects (same procedureBucket() the offline builder uses → identical
  // buckets); the CPV part is already division-grouped (d = left(cpv,2)).
  const breakdown = useMemo<ProcurementBreakdown | null>(
    () => (procurement ? toBreakdown(eik, procurement.breakdown) : null),
    [procurement, eik],
  );

  // Buy-side "Какво купува" breakdown — the awarder's spend by CPV division +
  // how it procures (procedure mix). Same shape/tile as the contractor side.
  const awarderBreakdown = useMemo<ProcurementBreakdown | null>(
    () =>
      awarderProc?.breakdown ? toBreakdown(eik, awarderProc.breakdown) : null,
    [awarderProc, eik],
  );

  // EU-threshold competition benchmarks (single-bid % / no-call %) for the
  // awarder and contractor sides — the tile hides itself below the coverage
  // floor, so small entities simply don't show it.
  const awarderBenchmarks = useMemo<ProcurementBenchmarksFile | null>(
    () =>
      awarderProc?.breakdown
        ? entityBenchmarks(awarderProc.contractCount, awarderProc.breakdown)
        : null,
    [awarderProc],
  );
  const contractorBenchmarks = useMemo<ProcurementBenchmarksFile | null>(
    () =>
      procurement
        ? entityBenchmarks(procurement.contractCount, procurement.breakdown)
        : null,
    [procurement],
  );

  // MP overlay for the awarder money-flow sankey: any politically-linked
  // supplier (from awarder_kindex) whose link is a sitting/former MP, keyed by
  // the /candidate/mp-<id> ref the connections graph uses.
  const awarderMpEdges = useMemo<EntityFlowMpEdge[]>(() => {
    if (!awarderKindex) return [];
    const edges: EntityFlowMpEdge[] = [];
    for (const s of awarderKindex.suppliers) {
      for (const p of s.politicians ?? []) {
        const m = /mp-(\d+)/.exec(p.ref);
        if (!m) continue;
        edges.push({
          contractorEik: s.eik,
          mpId: Number(m[1]),
          mpName: p.politician,
          valueEur: s.eur,
        });
      }
    }
    return edges;
  }, [awarderKindex]);

  return (
    <div className="w-full px-4 py-6 md:px-6">
      {/* data-og: stable anchor for the OG-card capture of the packed
          institution pages (roads / НОИ / НЗОК / ДФЗ). See
          scripts/og/capture-screens.ts — the clip is top-aligned here so the
          card leads with the institution name, identity chips and headline
          KPI cards. */}
      <div className="mb-6" data-og="awarder-hero">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {company
            ? company.entity_class && ENTITY_CLASS_KICKER[company.entity_class]
              ? ENTITY_CLASS_KICKER[company.entity_class][
                  i18n.language === "bg" ? "bg" : "en"
                ]
              : "Фирма (Търговски регистър)"
            : institution
              ? "Институция / възложител"
              : corpusOnly
                ? "Изпълнител / възложител по поръчки"
                : "Фирма (Търговски регистър)"}
        </div>
        <h1 className="text-2xl font-bold">
          {displayName}{" "}
          {company?.legal_form && (
            <span className="text-base font-normal text-muted-foreground">
              {legalFormLabel(company.legal_form)}
            </span>
          )}
        </h1>
        {/* Identity only — contract counts / totals / political links live in the
            stat cards + the political-links card below, so they aren't repeated. */}
        {!loading && !error && (
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>ЕИК {eik}</span>
            {company?.status && <span>{company.status}</span>}
            {institution?.orgType && <span>{institution.orgType}</span>}
            {company?.funds_amount != null && (
              <span>
                капитал{" "}
                {formatEur(
                  toEur(Number(company.funds_amount), company.funds_currency) ??
                    Number(company.funds_amount),
                  i18n.language,
                )}
              </span>
            )}
          </div>
        )}
        {(company?.seat || institution?.locality) && (
          <div className="mt-1 text-sm text-muted-foreground">
            {company?.seat ?? institution?.locality}
          </div>
        )}
        {!loading && !error && (
          <CompanyRiskChips
            debarredCount={debarred.length}
            sectors={sectors}
            relationships={relationships}
            politicianCount={politicians.length}
            fundsContractedEur={Number(funds?.contracted_eur ?? 0)}
          />
        )}
        {!loading && !error && retailChain && (
          <div className="mt-3">
            <CompanyRetailChainTile eik={eik} info={retailChain} />
          </div>
        )}
      </div>

      {loading && <div className="text-muted-foreground">Зареждане…</div>}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}
      {!loading && !error && !company && !institution && !hasProcurement && (
        <div className="text-sm text-muted-foreground">
          Няма фирма с ЕИК {eik} в базата.
        </div>
      )}

      {/* Corpus-only entity: appears in contracts but has no Commerce-Register
          record in our data (may simply be un-ingested, or a foreign /
          deregistered entity). Soft-worded — we can't assert it's unregistered —
          then fall through to the procurement body below. */}
      {!loading && !error && corpusOnly && (
        <div className="mb-4 text-sm text-muted-foreground">
          Няма запис от Търговския регистър в нашата база — показани са данните
          от обществените поръчки.
        </div>
      )}

      {!loading && !error && (company || institution || hasProcurement) && (
        <div className="space-y-6">
          {/* Page-level time scope (same pill UI as the procurement pages) — at
              the very top so it reads as the page control, above the subsidies /
              НЗОК / procurement sections. Drives the scoped DB fetch for the
              procurement sections (awarder + contractor); the subsidies + НЗОК
              tiles are all-time. Shown once the entity has any procurement. */}
          {(hadAwarder || contracts > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Обхват</span>
              <ScopeControl value={scope} onChange={setScope} />
            </div>
          )}
          {/* Hierarchy breadcrumb. On an awarder page (/awarder/:eik) the trail
              is Управление › Обществени поръчки › Възложители › <name>. On a
              company page it stays sector-scoped and only shows for the packed
              sector awarder seats (АПИ / НОИ / НЗОК / МОН / НАП / Митници),
              linking up to the sectors hub; generic company pages skip it. */}
          {isAwarderRoute ? (
            <AwarderBreadcrumb current={displayName} />
          ) : (
            SectorPack && <SectorBreadcrumb current={displayName} />
          )}
          {/* Entity-graph identity — this EIK is a school (schools.eik join).
              Self-hides unless the EIK matched a school; links to its report
              card on /school/:id. */}
          <SchoolIdentityTile eik={eik} />
          {/* Money IN — НЗОК hospital-care reimbursement. Self-hides unless this
              EIK is a matched hospital; sits above the ЗОП (money-out) tiles. */}
          <NzokHospitalReimbursementTile eik={eik} />
          {/* The WORK behind that money — this hospital's case-mix (top pathways
              by cases + national share). The per-patient denominator. Self-hides
              unless this EIK matched a facility in the activity crosswalk. */}
          <NzokActivityByEikTile eik={eik} />
          {/* This hospital's own drug packs priced above the national year-median
              — the per-entity view of the health pack's price-dispersion tile.
              Rows link to /molecule/:inn and the pack trend. Self-hides unless
              this EIK has above-median drug rows. */}
          <NzokDrugOverpayByEikTile eik={eik} />
          {/* Everything BELOW the НЗОК money line — revenue vs expense, total and
              overdue liabilities, occupancy, length of stay. Self-hides unless
              this EIK matched a hospital in the МЗ quarterly financials. */}
          <NzokFinancialHealthStrip eik={eik} />
          {/* The peer-comparison reading of those same financials — each ratio
              measure badged vs the national median (CMS Care Compare) + a decile
              fan over time (OpenPrescribing). Self-hides unless matched. */}
          <NzokReportCardTile eik={eik} />
          {/* Procurement risk exposure — hoisted here (below the page controls +
              identity tiles, above the money-detail tiles) so the buyer/supplier
              risk grade is prominent instead of buried under funding/subsidies.
              Each card self-hides when the entity has no contracts in that role;
              the awarder grade is all-time, so it now shows regardless of the
              selected scope (previously it was gated by the scoped awarder rollup). */}
          <EntityRiskGradeCard grade={awarderGrade} />
          <EntityRiskGradeCard grade={supplierGrade} />
          {company &&
            company.entity_class &&
            NGO_CLASSES.has(company.entity_class) &&
            ngoSignals &&
            ngoSignals.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4" />
                    {i18n.language === "bg"
                      ? "Сигнали за публичен интерес"
                      : "Public-interest signals"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <NgoSignalPills signals={ngoSignals} />
                  {ngoBoardLinks && ngoBoardLinks.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {i18n.language === "bg"
                          ? "Свързани лица в ръководството"
                          : "Connected people on the board"}
                      </div>
                      <ul className="space-y-1">
                        {ngoBoardLinks.map((l, i) => (
                          <li key={`${l.ref}-${i}`} className="text-sm">
                            <Link
                              to={l.ref}
                              className="font-medium text-accent hover:underline"
                            >
                              {decodeEntities(l.person)}
                            </Link>
                            <span className="text-muted-foreground">
                              {" · "}
                              {l.kind === "magistrate"
                                ? i18n.language === "bg"
                                  ? "магистрат"
                                  : "magistrate"
                                : l.kind === "mp"
                                  ? i18n.language === "bg"
                                    ? "депутат"
                                    : "MP"
                                  : i18n.language === "bg"
                                    ? "служител"
                                    : "official"}
                            </span>
                            {l.position && (
                              <span className="text-muted-foreground">
                                {" · "}
                                {decodeEntities(l.position)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        {i18n.language === "bg"
                          ? "Съвпадение по име с рядко срещано име (непотвърдено). Проверете лицето за детайли."
                          : "Matched on a rare exact name (unverified). Open the person for details."}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {i18n.language === "bg"
                      ? "Показателите са индикатори за публичен интерес, следа, не доказателство за нарушение."
                      : "Public-interest indicators — a trace, not proof of wrongdoing."}
                  </p>
                </CardContent>
              </Card>
            )}
          {company &&
            company.entity_class &&
            NGO_CLASSES.has(company.entity_class) &&
            (ngoDetails?.objectives ||
              ngoDetails?.public_benefit != null ||
              company.ngo_type) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4" />
                    {i18n.language === "bg"
                      ? "Организация с нестопанска цел"
                      : "Non-profit organisation"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    {ngoDetails?.public_benefit && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {i18n.language === "bg"
                          ? "Общественополезна дейност"
                          : "Public benefit"}
                      </span>
                    )}
                    {ngoDetails?.private_benefit && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {i18n.language === "bg"
                          ? "Частна дейност"
                          : "Private benefit"}
                      </span>
                    )}
                    {company.ngo_type && company.ngo_type !== "other" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t(`ngo_type_${company.ngo_type}`, company.ngo_type)}
                      </span>
                    )}
                  </div>
                  {ngoDetails?.objectives && (
                    <div>
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {i18n.language === "bg" ? "Цели" : "Objectives"}
                      </div>
                      <p className="whitespace-pre-line text-muted-foreground">
                        {ngoDetails.objectives.length > 600
                          ? ngoDetails.objectives.slice(0, 600) + "…"
                          : ngoDetails.objectives}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          {ngoFunding && ngoFunding.totalEur > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="h-4 w-4" />
                  {i18n.language === "bg"
                    ? "Външно финансиране"
                    : "External funding"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {formatEurCompact(ngoFunding.totalEur, i18n.language)}
                  </span>
                  <span className="text-muted-foreground">
                    {i18n.language === "bg"
                      ? "получено от именувани донори (абсолютни суми)"
                      : "received from named funders (absolute amounts)"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ngoFunding.bySource.map((s) => {
                    const l = FUNDING_SOURCE_LABEL[s.source];
                    return (
                      <span
                        key={s.source}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {(l
                          ? i18n.language === "bg"
                            ? l.bg
                            : l.en
                          : s.source) +
                          ": " +
                          formatEurCompact(s.eur, i18n.language)}
                      </span>
                    );
                  })}
                </div>
                <ul className="divide-y">
                  {ngoFunding.rows.slice(0, 6).map((r, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="min-w-0 text-muted-foreground line-clamp-1">
                        {r.funder ||
                          FUNDING_SOURCE_LABEL[r.source]?.bg ||
                          r.source}
                        {r.year ? ` · ${r.year}` : ""}
                        {r.programme ? ` · ${r.programme}` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatEurCompact(r.eur, i18n.language)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {i18n.language === "bg"
                    ? "Източници: EU Financial Transparency System, Закон за държавния бюджет. Публични данни за публично и международно финансиране."
                    : "Sources: EU Financial Transparency System, State Budget Law. Public data on public and international funding."}
                </p>
              </CardContent>
            </Card>
          )}
          {/* ДФ „Земеделие" administers the CAP subsidy programme (it doesn't
              receive farm money — its own rows are техническа помощ / публично
              складиране), so instead of the per-recipient "received" tile it gets
              a card linking to the whole /subsidies pack. */}
          {eik === AGRI_PAYER_EIK && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sprout className="h-4 w-4 text-emerald-600" />
                  {i18n.language === "bg"
                    ? "Земеделски субсидии"
                    : "Farm subsidies"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {i18n.language === "bg"
                    ? "ДФ „Земеделие“ е разплащателната агенция по Общата селскостопанска политика — изплаща директните плащания и мерките за развитие на селските райони на земеделските стопани."
                    : "The State Fund Agriculture is the CAP paying agency — it disburses the direct payments and rural-development measures to farmers."}
                </p>
                <Link
                  to="/subsidies"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {i18n.language === "bg"
                    ? "Разгледай земеделските субсидии"
                    : "Explore farm subsidies"}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          )}
          {subsidies && subsidies.totalEur > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sprout className="h-4 w-4 text-emerald-600" />
                  {i18n.language === "bg"
                    ? "Земеделски субсидии"
                    : "Farm subsidies"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {formatEurCompact(subsidies.totalEur, i18n.language)}
                  </span>
                  <span className="text-muted-foreground">
                    {i18n.language === "bg"
                      ? `от ДФ „Земеделие“ · ${subsidies.paymentCount.toLocaleString("bg-BG")} плащания · ${subsidies.firstYear}–${subsidies.lastYear}`
                      : `from the State Fund Agriculture · ${subsidies.paymentCount.toLocaleString("en-US")} payments · ${subsidies.firstYear}–${subsidies.lastYear}`}
                  </span>
                </div>
                <ul className="divide-y">
                  {subsidies.byScheme.slice(0, 5).map((s) => (
                    <li
                      key={s.scheme}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="min-w-0 text-muted-foreground line-clamp-1">
                        {s.scheme}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatEurCompact(s.totalEur, i18n.language)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/farm/${eik}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {i18n.language === "bg"
                    ? "Пълна история на субсидиите"
                    : "Full subsidy history"}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          )}
          {awarderRollup && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Като възложител</h2>
              </div>
              <div
                className="grid gap-3 grid-cols-2 lg:grid-cols-3"
                data-og="awarder-kpis"
              >
                <StatCard label="Общо възложени">
                  <div className="flex items-baseline gap-2">
                    <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span
                      className="text-lg md:text-xl font-bold tabular-nums"
                      title={formatEur(awarderRollup.totalEur, i18n.language)}
                    >
                      {formatEurCompact(awarderRollup.totalEur, i18n.language)}
                    </span>
                  </div>
                </StatCard>
                <StatCard label="Договори">
                  <div className="flex items-baseline gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-lg md:text-xl font-bold tabular-nums">
                      {num.format(awarderRollup.contractCount)}
                    </span>
                    {awarderProc && awarderProc.amendmentCount > 0 && (
                      <span className="text-xs text-muted-foreground">
                        + {num.format(awarderProc.amendmentCount)} анекса
                      </span>
                    )}
                  </div>
                </StatCard>
                <StatCard label="Изпълнители">
                  <div className="flex items-baseline gap-2">
                    <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-lg md:text-xl font-bold tabular-nums">
                      {num.format(awarderRollup.contractorCount ?? 0)}
                    </span>
                  </div>
                </StatCard>
              </div>
              {/* (Risk scorecard hoisted to the top of the page — see the
                  EntityRiskGradeCard block above the money-detail tiles.) */}
              {/* Domain pack hero (roads for АПИ …) — kept the focus of the page
                  for the buyers that have one; renders nothing for the rest.
                  Sector-lead awarders (НЗОК/НАП/…) instead cross-link to their
                  /sector/:id dashboard, where the disbursement pack now lives. */}
              {showPack && (
                <Suspense
                  fallback={
                    <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
                  }
                >
                  <SectorPack eik={eik} scopeWindow={packWindow} />
                </Suspense>
              )}
              {sectorDash && (
                <Link
                  to={`/sector/${sectorDash.id}`}
                  className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3 text-sm hover:border-primary/50"
                >
                  <span>
                    {i18n.language === "bg"
                      ? "Разпределените средства и детайлите по сектора са в таблото на сектора"
                      : "The disbursed funds and sector detail are on the sector dashboard"}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    {i18n.language === "bg" ? "Към таблото" : "Open dashboard"}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <CompanyTopContractsTile
                  eik={eik}
                  rollup={awarderContractsRollup}
                  partyHref={(e) => `/company/${e}`}
                  seeAllHref={`/awarder/${eik}`}
                />
                <AwarderTopContractorsTile
                  eik={eik}
                  rollup={awarderRollup}
                  contractorHref={(e) => `/company/${e}`}
                />
              </div>
              {/* Какво купува — CPV-division spend + procedure mix, buy-side. */}
              {awarderBreakdown && (
                <ProcurementBreakdownTile
                  kind="a"
                  breakdown={awarderBreakdown}
                />
              )}
              {/* Competition vs the EU red lines (single-bid % / no-call %). */}
              <ProcurementBenchmarksTile
                data={awarderBenchmarks}
                title={
                  i18n.language === "bg"
                    ? "Конкуренция спрямо праговете на ЕС"
                    : "Competition vs the EU thresholds"
                }
              />
              {/* Where the money goes — top suppliers with the MP overlay. */}
              {awarderRollup.byContractor.length > 0 && (
                <EntityFlowTile
                  role="awarder"
                  centerEik={eik}
                  centerName={awarderRollup.name}
                  counterparties={awarderRollup.byContractor.map((c) => ({
                    eik: c.eik,
                    name: c.name,
                    totalEur: c.totalEur,
                  }))}
                  mpEdges={awarderMpEdges}
                />
              )}
              {/* Static composition of spend across suppliers. */}
              {awarderRollup.byContractor.length > 1 && (
                <CompanyPortfolioTreemap
                  role="awarder"
                  items={awarderRollup.byContractor.map((c) => ({
                    eik: c.eik,
                    name: c.name,
                    totalEur: c.totalEur,
                  }))}
                />
              )}
              {awarderRollup.byYear.length > 0 && (
                <CompanyByYearChart rows={awarderRollup.byYear} />
              )}
              {/* Lifecycle — announced procedures (forecast) → awarded (actual)
                  via the ocid join, then the КЗК appeals filed against them.
                  Both self-fetching; render nothing when there's none. */}
              <AwarderTendersTile eik={eik} />
              <AwarderAppealsTile eik={eik} />
            </section>
          )}
          {/* Awarder with no awards inside the chosen window — keep the section
              present (and the scope control reachable) instead of vanishing. */}
          {hadAwarder && !awarderRollup && scope !== "all" && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Като възложител</h2>
              </div>
              {/* Don't dead-end on "нищо намерено": say what was searched, and —
                  when the entity DOES award outside this window — where the data
                  actually is, with a one-click way to get there. */}
              <p className="text-sm text-muted-foreground">
                Няма възложени договори за избрания период.
              </p>
              {(awarderAllTime?.contracts ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground">
                  За всички периоди:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {(awarderAllTime?.contracts ?? 0).toLocaleString("bg-BG")}
                  </span>{" "}
                  договора на стойност{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatEurCompact(
                      awarderAllTime?.total_eur ?? 0,
                      i18n.language,
                    )}
                  </span>
                  {/* No full stop here: the BG compact format already ends in an
                      abbreviation dot ("€13,6 млн."), so adding one reads "млн..". */}{" "}
                  <button
                    type="button"
                    onClick={() => setScope("all")}
                    className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  >
                    Виж всички периоди
                  </button>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Проверихме договорите, поръчките и връзките — няма намерени
                  записи за тази институция.
                </p>
              )}
            </section>
          )}
          {/* (Supplier risk scorecard hoisted to the top of the page.) */}
          {awarderKindex &&
            awarderKindex.linkedSupplierCount > 0 &&
            awarderKindex.totalEur > 0 && (
              <Card className="border-amber-300/60 dark:border-amber-800/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Landmark className="h-4 w-4" />
                    {i18n.language === "bg"
                      ? "Свързани с политиката изпълнители"
                      : "Politically linked suppliers"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {/* A genuine but sub-1% share (e.g. €0.9M of a €350M
                          all-time total) must not round to a flat "0%" — that
                          reads as "nothing", contradicting the linked total and
                          the supplier list right below it. */}
                      {awarderKindex.sharePct > 0 &&
                      awarderKindex.sharePct < 0.01
                        ? "<1%"
                        : `${Math.round(awarderKindex.sharePct * 100)}%`}
                    </span>
                    <span className="text-muted-foreground">
                      {/* linkedEur (the money going TO the linked suppliers)
                          reads as the total if placed next to "awarded funds";
                          attach it to the suppliers at the end instead. */}
                      {i18n.language === "bg"
                        ? `от възложените средства отиват към ${awarderKindex.linkedSupplierCount} свързан(и) изпълнител(и) — ${formatEurCompact(awarderKindex.linkedEur, i18n.language)}`
                        : `of awarded value goes to ${awarderKindex.linkedSupplierCount} linked supplier(s) — ${formatEurCompact(awarderKindex.linkedEur, i18n.language)}`}
                    </span>
                  </div>
                  <ul className="divide-y">
                    {awarderKindex.suppliers.slice(0, 8).map((s) => (
                      <li
                        key={s.eik}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <Link
                            to={`/company/${s.eik}`}
                            className="hover:text-primary hover:underline"
                          >
                            {decodeEntities(s.name) || s.eik}
                          </Link>
                          {s.politicians && s.politicians.length > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (
                              {s.politicians
                                .map((p) => p.politician)
                                .slice(0, 2)
                                .join(", ")}
                              )
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatEurCompact(s.eur, i18n.language)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          {debarred.length > 0 && (
            <div className="rounded-md border border-red-300 bg-red-100 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-900/30 dark:text-red-100">
              <div className="flex items-center gap-2 font-semibold">
                <Ban className="h-4 w-4 shrink-0" />
                Фирмата е в Регистъра на отстранените изпълнители (АОП)
              </div>
              <ul className="mt-1.5 space-y-0.5 pl-6 text-xs">
                {debarred.map((d, i) => (
                  <li key={i}>
                    {d.debarred_until
                      ? `отстранена до ${d.debarred_until}`
                      : "отстранена"}
                    {d.details_url ? (
                      <>
                        {" · "}
                        <a
                          href={d.details_url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          решение на КЗК
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Contractor with no contracts inside the chosen window — mirror the
              awarder empty state so the scope stays legible on a narrowed view. */}
          {contracts > 0 && (!rollup || rollup.contractCount === 0) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" /> Няма договори за избрания
              период.
            </div>
          )}
          {rollup && rollup.contractCount > 0 && (
            <>
              {/* Section header. When the entity is BOTH an awarder and a
                  contractor (e.g. a state EAD), "Като изпълнител" distinguishes
                  this from the awarder dashboard; otherwise "Обществени поръчки". */}
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">
                  {awarderRollup ? "Като изпълнител" : "Обществени поръчки"}
                </h2>
              </div>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <StatCard label="Общо възложени">
                  <div className="flex items-baseline gap-2">
                    <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span
                      className="text-lg md:text-xl font-bold tabular-nums"
                      title={formatEur(rollup.totalEur, i18n.language)}
                    >
                      {formatEurCompact(rollup.totalEur, i18n.language) || "—"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    средно{" "}
                    {formatEur(
                      rollup.totalEur / rollup.contractCount,
                      i18n.language,
                    )}{" "}
                    / договор
                  </div>
                  {procurement && (procurement.consortiumCount ?? 0) > 0 && (
                    <Link
                      to={`/company/${eik}/contracts`}
                      className="block text-xs text-muted-foreground tabular-nums hover:underline hover:text-foreground"
                      title="Пълната стойност на договорите, спечелени като член на обединение (ДЗЗД). Реалният дял на всеки член не е публичен, затова показваме пълната стойност на договора — тя НЕ е включена в горната сума (тя е само за самостоятелните договори)."
                    >
                      + участник в{" "}
                      {num.format(procurement.consortiumCount ?? 0)} обединения
                      (общо{" "}
                      {formatEurCompact(
                        procurement.consortiumEur ?? 0,
                        i18n.language,
                      )}
                      ; дялът не е публичен)
                    </Link>
                  )}
                  {procurement && (procurement.frameworkCount ?? 0) > 0 && (
                    <div
                      className="text-xs text-muted-foreground tabular-nums"
                      title="Част от горната сума е спечелена по рамкови споразумения с няколко изпълнители — стойността е споделен таван, а не гарантиран приход."
                    >
                      вкл.{" "}
                      {formatEurCompact(
                        procurement.frameworkEur ?? 0,
                        i18n.language,
                      )}{" "}
                      по рамкови споразумения
                    </div>
                  )}
                </StatCard>
                <StatCard label="Договори">
                  <Link
                    to={`/company/${eik}/contracts`}
                    className="flex items-baseline gap-2 hover:underline"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {num.format(rollup.contractCount)}
                    </span>
                  </Link>
                  {procurement && procurement.amendmentCount > 0 && (
                    <Link
                      to={`/company/${eik}/annexes`}
                      className="text-xs text-muted-foreground tabular-nums hover:underline hover:text-foreground"
                    >
                      + {num.format(procurement.amendmentCount)} анекса
                    </Link>
                  )}
                </StatCard>
                <StatCard label="Възложители">
                  <div className="flex items-baseline gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {num.format(
                        rollup.awarderCount ?? rollup.byAwarder.length,
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Брой държавни институции
                  </div>
                </StatCard>
                <StatCard label="Свързани с властта">
                  <div className="flex items-baseline gap-2">
                    <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {num.format(politicians.length)}
                    </span>
                    <span className="text-sm text-muted-foreground">лица</span>
                  </div>
                </StatCard>
              </div>

              {procurement &&
                (procurement.consortiumMembers?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 font-medium">
                      Обединение — участници
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Това е обединение (ДЗЗД). Пълната стойност на договорите е
                      записана тук; фирмите по-долу са членовете — дялът на
                      всеки не е публичен.
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {procurement.consortiumMembers?.map((m) => (
                        <Link
                          key={m.eik}
                          to={`/company/${m.eik}`}
                          className="text-xs hover:underline hover:text-foreground text-muted-foreground"
                        >
                          {m.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

              <div className="grid gap-4 xl:grid-cols-2">
                <CompanyTopContractsTile
                  eik={eik}
                  rollup={rollup}
                  partyHref={(e) => `/company/${e}`}
                  seeAllHref={`/company/${eik}/contracts`}
                />
                {rollup.byAwarder.length > 0 && (
                  <CompanyTopAwardersTile
                    eik={eik}
                    rollup={rollup}
                    awarderHref={(e) => `/company/${e}`}
                    showBars
                  />
                )}
              </div>

              {breakdown && (
                <CompanySectorsTile
                  eik={eik}
                  breakdown={breakdown}
                  sectors={sectors}
                />
              )}
              {/* Competition vs the EU red lines, sell-side (contracts this
                  supplier won with a single bidder / without a call). */}
              <ProcurementBenchmarksTile
                data={contractorBenchmarks}
                title={
                  i18n.language === "bg"
                    ? "Конкуренция спрямо праговете на ЕС"
                    : "Competition vs the EU thresholds"
                }
              />
              {geography && <CompanyGeographyTile data={geography} />}
              <CompanyBuyerConcentrationTile rollup={rollup} />
              {relationships && (
                <CompanyBuyerCaptureTile data={relationships} />
              )}
              {rollup.byYear.length > 0 && (
                <CompanyByYearChart rows={rollup.byYear} />
              )}
            </>
          )}

          {/* All-time (not date-scoped) — its per-cabinet shares use the all-time
              total, so it's correct regardless of the scope filter above. */}
          {contracts > 0 && (
            <CabinetTimelineTile
              cabinets={cabinets}
              totalEur={Number(summary?.contracts_eur ?? 0)}
            />
          )}

          {funds && Number(funds.contracted_eur ?? 0) > 0 && (
            <CompanyFundsTile eik={eik} funds={funds} projects={fundProjects} />
          )}

          {company && (
            <div className="flex items-center gap-2 pt-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Собственост и връзки</h2>
            </div>
          )}

          {company && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" /> Лица (
                  {num.format(officers.length)})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {officers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Няма вписани лица.
                  </div>
                ) : (
                  <table className="w-full text-sm [&_td]:px-2 [&_td]:first:pl-0 [&_th]:px-2 [&_th]:first:pl-0">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1">Лице</th>
                        <th className="py-1">Роля</th>
                        <th className="py-1 text-right">Дял</th>
                        <th className="py-1">От</th>
                        <th className="py-1">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {officers.slice(0, OFFICERS_PREVIEW).map((o, i) => (
                        <tr
                          key={`${o.name}-${o.role}-${i}`}
                          className="border-t border-border"
                        >
                          <td className="py-1">
                            <Link
                              to={`/person/${encodeURIComponent(o.name)}`}
                              className="text-accent hover:underline"
                            >
                              {o.name}
                            </Link>
                          </td>
                          <td className="py-1 text-muted-foreground">
                            {trRoleLabel(o.role, t)}
                          </td>
                          <td className="py-1 text-right tabular-nums">
                            {o.role === "sole_owner" &&
                            (o.share === null || o.share === "")
                              ? "100%"
                              : pct(o.share)}
                            {o.share_amount != null && (
                              <span className="ml-1 text-xs text-muted-foreground/70">
                                ({num.format(Number(o.share_amount))}
                                {o.share_currency ? ` ${o.share_currency}` : ""}
                                )
                              </span>
                            )}
                          </td>
                          <td className="py-1 tabular-nums text-muted-foreground">
                            {day(o.added_at)}
                          </td>
                          <td className="py-1">
                            {o.active ? (
                              <span className="text-emerald-600">активен</span>
                            ) : (
                              <span className="text-muted-foreground">
                                бивш · {day(o.erased_at)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {officers.length > OFFICERS_PREVIEW && (
                  <Link
                    to={`/company/${eik}/officers`}
                    className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    Виж всички {num.format(officers.length)} лица{" "}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          {related && related.length > 0 && (
            <CompanyRelatedTile data={related} />
          )}

          {company && (
            <CompanyPoliticalLinks eik={eik} politicians={politicians} />
          )}

          {company && <CompanyConnectionCheck eik={eik} />}

          {/* Magistrates who declared this company (ИВСС чл. 175а ЗСВ). Renders
              nothing unless there is a match — sparse by design. */}
          {company && <CompanyMagistratesTile eik={eik} />}

          {company && contracts === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" /> Фирмата няма обществени поръчки
              в базата.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
