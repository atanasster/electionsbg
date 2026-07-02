// DB-backed company page (/company/:eik). Works for ANY registered company —
// including the ~1M TR companies with no procurement (hence no JSON shard). Fed
// live from Postgres via /api/db/company: TR identity + capital, officers with
// ownership %, political connections, and a link out to the full procurement
// dashboard when the company has contracts. Served by /api/db — the Vite plugin
// in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Building2,
  Landmark,
  Users,
  ArrowRight,
  Coins,
  FileText,
  Ban,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
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
import { CompanyRiskChips } from "../components/procurement/CompanyRiskChips";
import {
  CompanyFundsTile,
  type FundProjectRow,
} from "../components/procurement/CompanyFundsTile";
import { CompanyConnectionCheck } from "../components/procurement/CompanyConnectionCheck";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PERIOD_ALL = "all";
const PERIOD_LAST4 = "last4";
const NOW_YEAR = new Date().getFullYear();
const PERIOD_YEARS: string[] = Array.from(
  { length: NOW_YEAR - 2007 + 1 },
  (_, i) => String(NOW_YEAR - i),
);

// Period preset → [from, to] (YYYY-MM-DD | null) for company_procurement.
const periodRange = (p: string): [string | null, string | null] => {
  if (p === PERIOD_ALL) return [null, null];
  if (p === PERIOD_LAST4) return [`${NOW_YEAR - 3}-01-01`, null];
  return [`${p}-01-01`, `${p}-12-31`];
};

interface Company {
  uic: string;
  name: string | null;
  legal_form: string | null;
  seat: string | null;
  status: string | null;
  funds_amount: string | number | null;
  funds_currency: string | null;
}
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
> & { contractorCount: number; amendmentCount: number };

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
  breakdown: {
    totalEur: number;
    cpvKnownEur: number;
    procKnownEur: number;
    euEur: number;
    euKnownEur: number;
    cpvRaw: { d: string; eur: number; n: number }[];
    procRaw: { method: string; eur: number; n: number }[];
  };
};

const num = new Intl.NumberFormat("bg-BG");
// Officers shown inline on the dashboard; the rest live on the standalone
// backend-paginated /company/:eik/officers table.
const OFFICERS_PREVIEW = 10;
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: string | number | null): string =>
  s === null || s === undefined || s === "" ? "—" : `${Math.round(Number(s))}%`;

export const CompanyDbScreen: FC = () => {
  const { eik = "" } = useParams();

  const [company, setCompany] = useState<Company | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>(PERIOD_ALL);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const [from, to] = periodRange(period);
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
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eik, period]);

  const contracts = Number(summary?.contracts ?? 0);

  // Assemble the ProcurementContractorRollup the existing tiles expect (add the
  // eik/name/generatedAt the endpoint omits).
  const rollup = useMemo<ProcurementContractorRollup | null>(
    () =>
      procurement
        ? {
            eik,
            name: company?.name ?? eik,
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
    [procurement, eik, company?.name],
  );

  // Buy-side rollup for the DB awarder dashboard (when the EIK is an awarder).
  const awarderName = company?.name ?? institution?.name ?? eik;
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
  const breakdown = useMemo<ProcurementBreakdown | null>(() => {
    if (!procurement) return null;
    const bd = procurement.breakdown;
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
  }, [procurement, eik]);

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {company
            ? "Фирма (Търговски регистър)"
            : institution
              ? "Институция / възложител"
              : "Фирма (Търговски регистър)"}
        </div>
        <h1 className="text-2xl font-bold">
          {company?.name ?? institution?.name ?? eik}{" "}
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
      </div>

      {loading && <div className="text-muted-foreground">Зареждане…</div>}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}
      {!loading && !error && !company && !institution && (
        <div className="text-sm text-muted-foreground">
          Няма фирма с ЕИК {eik} в базата.
        </div>
      )}

      {!loading && !error && (company || institution) && (
        <div className="space-y-6">
          {awarderRollup && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Като възложител</h2>
              </div>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
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
              {awarderRollup.byYear.length > 0 && (
                <CompanyByYearChart rows={awarderRollup.byYear} />
              )}
            </section>
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
          {contracts > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Период</span>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-auto h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PERIOD_ALL}>Всички години</SelectItem>
                  <SelectItem value={PERIOD_LAST4}>Последните 4 г.</SelectItem>
                  {PERIOD_YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {period !== PERIOD_ALL && (
                <span className="text-xs text-muted-foreground">
                  {rollup
                    ? `${num.format(rollup.contractCount)} договора · ${formatEurCompact(rollup.totalEur, i18n.language)}`
                    : "няма договори за периода"}
                </span>
              )}
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
              total, so it's correct regardless of the period filter above. */}
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Landmark className="h-4 w-4" /> Политически връзки (
                  {num.format(politicians.length)})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {politicians.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Няма установени връзки с политици.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {politicians.map((p, i) => (
                      <li key={`${p.ref}-${i}`} className="text-sm">
                        <Link
                          to={p.ref}
                          className="font-medium text-accent hover:underline"
                        >
                          {p.politician}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}
                          · {p.kind === "mp" ? "депутат" : "служител"}
                          {p.role ? ` · ${p.role}` : ""}
                          {p.total_eur ? ` · ${formatEur(p.total_eur)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {company && <CompanyConnectionCheck eik={eik} />}

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
