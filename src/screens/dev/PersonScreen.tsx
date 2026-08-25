// DB-backed person page (/person/:name) — a dashboard that rolls the person's
// whole PORTFOLIO up to the individual. Unlike the political-class-only
// /procurement/mps rankings, it queries Postgres live so it works for ANY TR
// officer:
//   • portfolio procurement rollup — top awarders / top contracts / sectors /
//     by-cabinet / by-year, aggregated over every company the person runs/owns
//     (person_procurement, person_by_cabinet), reusing the company-page tiles;
//   • Участия — ONE row per company, every registry role on it as a tag, with a
//     portfolio value bar (see personParticipations.ts for why per-company);
//   • inner circle — the people co-appearing across the person's companies;
//   • political connections; a visual tenure timeline; a connection check.
// A person is identified only by folded name (TR has no person id), so rows may
// span more than one real individual sharing the name; and our TR store only
// covers ~2022+, so older participations may be missing. Served by /api/db — the
// Vite plugin in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Briefcase,
  Building2,
  Coins,
  Crosshair,
  Euro,
  FileText,
  Info,
  Landmark,
  MapPin,
  PieChart,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useNoindex } from "@/lib/useNoindex";
import { useScope } from "@/data/scope/useScope";
import { scopeRange } from "@/data/scope/scopeRange";
import { useElectionContext } from "@/data/ElectionContext";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { trRoleLabel } from "@/lib/trRole";
import { decodeEntities } from "@/lib/decodeEntities";
import { cn } from "@/lib/utils";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import { StatCard } from "../dashboard/StatCard";
import { DashboardSection } from "../dashboard/DashboardSection";
import { CompanyTopContractsTile } from "../components/procurement/CompanyTopContractsTile";
import { CompanyTopAwardersTile } from "../components/procurement/CompanyTopAwardersTile";
import { CompanyByYearChart } from "../components/procurement/CompanyByYearChart";
import { ProcurementBreakdownTile } from "../components/procurement/ProcurementBreakdownTile";
import {
  CabinetTimelineTile,
  type CabinetRow,
} from "../components/procurement/CabinetTimelineTile";
import {
  PersonAssociatesTile,
  type Associate,
} from "../components/procurement/PersonAssociatesTile";
import { EvidenceBasis } from "../components/procurement/EvidenceBasis";
import { PersonConnectionCheck } from "../components/procurement/PersonConnectionCheck";
import {
  foldParticipations,
  participationTag,
  OWNS,
  type ParticipationRow,
} from "./personParticipations";
import { PersonTimelineTile } from "../components/procurement/PersonTimelineTile";
import { isPlottableRole } from "../components/procurement/plottableRole";
import {
  PersonProcurementBreakdownTile,
  type PersonBreakdownRow,
} from "../components/procurement/PersonProcurementBreakdownTile";
import { PersonMagistrateHoldingsTile } from "../components/procurement/PersonMagistrateHoldingsTile";
import { PersonMagistratePoliticianLinks } from "../components/procurement/PersonMagistratePoliticianLinks";
import type {
  ProcurementContractorRollup,
  ProcurementBreakdown,
} from "@/data/dataTypes";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";

interface RoleRow {
  uic: string;
  company: string | null;
  status: string | null;
  role: string | null;
  share: string | number | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
  contracts: string;
  contracts_eur: number;
}
interface PoliticianRow {
  politician: string;
  ref: string;
  kind: string;
  role: string | null;
  via_eik: string;
  via_company: string | null;
  total_eur: number | null;
}
// Portfolio breakdown rows (migration 125) — reconcile with the procurement headline.
interface CompanyCut {
  eik: string;
  name: string | null;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
}
interface SettlementCut {
  ekatte: string | null;
  settlement: string | null;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
}

// Portfolio rollup from person_procurement() — the same jsonb the company page's
// company_procurement returns, so the shared tiles are reused verbatim.
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

/** Companies shown before the „покажи всички" toggle. A mass filer runs to hundreds of
 *  rows, which buries every section below this one; the toggle discloses the cap rather
 *  than truncating silently, and only appears when it binds. */
const PARTICIPATIONS_SHOWN = 12;

const num = new Intl.NumberFormat("bg-BG");
/** Below this share of the money carrying a `procurement_method` at all, „печели пряко"
 *  is withheld. Same number and same reason as `ProcurementBreakdownTile`'s EU-funding
 *  line, which is the precedent this follows rather than a fresh judgement. */
const PROC_COVERAGE_FLOOR = 0.6;

/** One decimal, so „95,6%" does not round to a flat „96%" — the point of the headline is
 *  how close to total the figure is, and that last digit is where it reads. */
const pctFmt = new Intl.NumberFormat("bg-BG", {
  style: "percent",
  maximumFractionDigits: 1,
});
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");

// At-a-glance signal chips (person-shaped analogue of CompanyRiskChips).
const chipTone = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  violet:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  muted: "bg-muted text-muted-foreground",
} as const;

/** The politician's role in the shared company, rendered for a reader.
 *
 *  `company_politicians.role` mixes TWO vocabularies, because the table has two arms
 *  (see `armSql` in load_tr_pg.ts): registry codes from `person_role` (`manager`,
 *  `partner`, `director`, …), which `trRoleLabel` already translates, and the two
 *  DECLARATION codes `stake` / `declared_role`, which it does not — they are not
 *  Търговски регистър roles at all, so giving them `tr_role_*` keys would file them
 *  under the wrong vocabulary. Before this, those fell through `trRoleLabel`'s
 *  raw-code fallback and showed a Bulgarian reader an English token — 96 of the
 *  table's 982 rows (measured 2026-08-25: stake 74, declared_role 22).
 *
 *  Naming the declaration arm explicitly also earns its keep here specifically: a
 *  declared stake is exactly the edge the card's basis line says the registry check
 *  above cannot see, so labelling it makes that difference visible per row rather than
 *  only in the caveat. */
const politicianRoleLabel = (
  role: string | null,
  t: TFunction,
): string | null => {
  if (!role) return null;
  if (role === "stake") return "декларирано дялово участие";
  if (role === "declared_role") return "декларирана длъжност";
  return trRoleLabel(role, t);
};

/** The participations table — ONE row per company, every role on it as a tag.
 *
 *  This replaced two tables („Собственост" / „Управление"). They were the same
 *  relationship to the same company split across the page, so answering "what is this
 *  person to ИНВЕНТИКС" meant scanning both — and, worse, `person_roles` repeats a
 *  PER-COMPANY `contracts_eur` on every role row, so a company appearing in both tables
 *  printed its money twice. See `foldParticipations`' header for the measurement (the
 *  majority of people in the corpus are in that shape) and for why the fold takes a max
 *  rather than a sum.
 *
 *  MODULE scope, not declared inside PersonScreen: a component defined in a render body
 *  is a new component TYPE on every render, so React unmounts and remounts the whole
 *  subtree instead of updating it — and this page re-renders on every ScopeControl
 *  interaction and every fetch settle. What it would otherwise read from the closure
 *  (`maxRoleEur`, `t`, `i18n.language`) is passed in instead. */
const ParticipationRows: FC<{
  rows: ParticipationRow[];
  maxRoleEur: number;
  t: TFunction;
  lang: string;
}> = ({ rows, maxRoleEur, t, lang }) => (
  // The table is wider than a phone-width card, and without this it was simply CLIPPED —
  // measured at a 318px viewport, a 359px table inside a 253px card with `overflow-x:
  // visible`, and the page itself does not scroll horizontally, so „Стойност" was
  // unreachable rather than merely off-screen. The repo's rule is that wide content
  // scrolls inside its own container instead of pushing the page.
  <div className="overflow-x-auto">
    <table className="w-full min-w-[34rem] text-sm [&_td]:px-2 [&_td]:first:pl-0 [&_th]:px-2 [&_th]:first:pl-0">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1">Фирма</th>
          <th className="py-1">Роля</th>
          <th className="py-1">От</th>
          <th className="py-1">Статус</th>
          <th className="py-1 text-right">Стойност</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.uic}
            className={cn(
              "border-t border-border align-top",
              // Dimmed only when EVERY role has ended — a former partner who is still the
              // manager has not left the company.
              !r.active && "opacity-60",
            )}
          >
            <td className="py-1.5">
              <Link
                to={`/company/${r.uic}`}
                className="text-accent hover:underline"
              >
                {decodeEntities(r.company) || r.uic}
              </Link>
            </td>
            <td className="py-1.5">
              <span className="flex flex-wrap gap-1">
                {r.roles.map((role, i) => (
                  <span
                    key={`${role.role}-${i}`}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs",
                      // An ENDED role must not be drawn like a live one. The row-level
                      // status is an OR across roles, so a company whose ownership ended
                      // while the management continues correctly reads „активен" — and
                      // without this the ended съдружник tag beside it would assert a
                      // holding the person no longer has. Struck through rather than
                      // hidden: the role is historical, not absent.
                      !role.active
                        ? "bg-muted text-muted-foreground"
                        : OWNS.has(role.role ?? "")
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                    title={role.active ? undefined : `до ${day(role.erasedAt)}`}
                  >
                    {/* ⚠️ The strike is on THIS inner span, not on the tag, and that is a
                      CSS constraint rather than a preference: text-decoration propagates
                      to descendants and a descendant CANNOT cancel it — `no-underline`
                      on the date reports `text-decoration-line: none` in the computed
                      style and still paints struck, which is what a screenshot caught
                      after the computed style said it was fine. Scoping the strike to the
                      role text is the only way to keep the date legible. */}
                    <span
                      className={cn(
                        !role.active && "line-through decoration-1",
                      )}
                    >
                      {participationTag(role, t)}
                    </span>
                    {/* The leading space is in the STRING, not only in `ml-1`: a margin is
                      invisible to textContent, so without it the accessible name and
                      every copied selection read „съдружник· до …". */}
                    {!role.active && (
                      <span className="ml-1"> · до {day(role.erasedAt)}</span>
                    )}
                  </span>
                ))}
              </span>
            </td>
            <td className="py-1.5 tabular-nums text-muted-foreground">
              {day(r.addedAt)}
            </td>
            <td className="py-1.5">
              {r.active ? (
                <span className="text-emerald-600">активен</span>
              ) : (
                <span className="text-muted-foreground">
                  бивш · {day(r.erasedAt)}
                </span>
              )}
            </td>
            <td className="py-1.5">
              <div className="flex items-center justify-end gap-2">
                {r.contractsEur ? (
                  <>
                    <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded bg-muted md:w-20">
                      <span
                        className="block h-full rounded bg-primary/60"
                        style={{
                          width: `${Math.max(3, (r.contractsEur / maxRoleEur) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 text-right tabular-nums md:w-20">
                      {formatEurCompact(r.contractsEur, lang)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const PersonScreen: FC = () => {
  const { name = "" } = useParams();
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const person = decodeURIComponent(name);
  // NOINDEX (S5): the name-keyed portfolio is a NAME match, not a canonical identity (it folds
  // every TR officer sharing the name — the person_namesake_disclosure below says so), it is never
  // prerendered and carries no sitemap <loc>. Keep the JS crawler off it too.
  useNoindex();

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
  const [procurement, setProcurement] = useState<DbRollup | null>(null);
  const [cabinets, setCabinets] = useState<CabinetRow[]>([]);
  const [associates, setAssociates] = useState<Associate[]>([]);
  const [byCompany, setByCompany] = useState<CompanyCut[]>([]);
  const [bySettlement, setBySettlement] = useState<SettlementCut[]>([]);
  const [allParticipations, setAllParticipations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The shared URL-backed scope (?pscope), same control as every procurement page. INCLUSIVE
  // [from,to] via scopeRange — person_procurement (and the two breakdown cuts) filter
  // `date >= from AND date <= to`, so the inclusive sibling of useScopeWindow is the right one.
  const { scope } = useScope();
  const { selected } = useElectionContext();
  const [from, to] = useMemo(
    () => scopeRange(scope, selected),
    [scope, selected],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const qs =
      `/api/db/person?name=${encodeURIComponent(person)}` +
      (from ? `&from=${from}` : "") +
      (to ? `&to=${to}` : "");
    fetch(qs)
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else {
          setRoles(j.roles ?? []);
          setPoliticians(j.politicians ?? []);
          setProcurement(j.procurement ?? null);
          setCabinets(j.cabinets ?? []);
          setAssociates(j.associates ?? []);
          setByCompany(j.byCompany ?? []);
          setBySettlement(j.bySettlement ?? []);
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [person, from, to]);

  // Companies count + active-role count come from the participations (roles);
  // money + contract count are driven by the procurement rollup so the headline
  // matches the tiles exactly.
  const summary = useMemo(() => {
    const byUic = new Set(roles.map((r) => r.uic));
    const active = roles.filter((r) => r.active).length;
    const owns = new Set(
      roles.filter((r) => OWNS.has(r.role ?? "")).map((r) => r.uic),
    ).size;
    const manages = new Set(
      roles.filter((r) => !OWNS.has(r.role ?? "")).map((r) => r.uic),
    ).size;
    return { companies: byUic.size, active, owns, manages };
  }, [roles]);

  const totalEur = procurement?.totalEur ?? 0;
  const contractCount = procurement?.contractCount ?? 0;

  // Reassemble the ProcurementContractorRollup the shared tiles expect.
  const rollup = useMemo<ProcurementContractorRollup | null>(
    () =>
      procurement
        ? {
            eik: "",
            name: person,
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
    [procurement, person],
  );

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
      eik: "",
      totalEur: bd.totalEur,
      cpvKnownEur: bd.cpvKnownEur,
      procKnownEur: bd.procKnownEur,
      euEur: bd.euEur,
      euKnownEur: bd.euKnownEur,
      cpv: bd.cpvRaw,
      proc: [...byBucket].map(([b, v]) => ({ b, eur: v.eur, n: v.n })),
    };
  }, [procurement]);

  /** „Печели пряко" — the share of KNOWN-procedure money won without an open advert.
   *
   *  ⚠️ COVERAGE-GATED, and that is the whole difficulty with promoting this number to a
   *  headline. `procurement_method` is absent on a large part of the corpus — measured
   *  2026-08-26 over `contracts` at `tag='contract'`: **54.8% of rows and 60.3% of the
   *  money** carry one — so `direct / procKnown` is a share of a SUBSET. Printed bare in
   *  a stat card it reads as a claim about everything the person's companies won.
   *
   *  The threshold and its rationale are not invented here: `ProcurementBreakdownTile`
   *  already withholds its EU-funding share below `euCoverage >= 0.6`, for the same
   *  reason in the same card. Below the gate this returns null and the card says the
   *  procedure is unknown rather than showing a number over too little of the money;
   *  above it, `coverage` rides along so the sub-line can name the basis. */
  const directShare = useMemo(() => {
    if (!breakdown || breakdown.totalEur <= 0) return null;
    const coverage = breakdown.procKnownEur / breakdown.totalEur;
    if (coverage < PROC_COVERAGE_FLOOR) return null;
    const known = breakdown.proc.reduce((sum, p) => sum + p.eur, 0);
    if (known <= 0) return null;
    const direct = breakdown.proc.find((p) => p.b === "direct")?.eur ?? 0;
    return { share: direct / known, coverage };
  }, [breakdown]);

  /** How much of the portfolio actually wins public work — or null when unanswerable.
   *
   *  `byCompany` (migration 125) ships the FULL per-company cut with no LIMIT, so its
   *  length is exactly "companies with contracts", and the denominator is the same
   *  `summary.companies` the Участия heading counts, so the two sections agree.
   *
   *  ⚠️ AN EMPTY ARRAY IS NOT A ZERO, and reading it as one publishes a card that
   *  contradicts the card beside it. 125 and 024 do not agree on their population — 125
   *  excludes the TR sentinel „Заличено обстоятелство." and 024 does not — and the route
   *  additionally degrades a missing 125 to `[]` rather than erroring. Rendered live
   *  before this guard: „Общо възложени €3,4 млрд. · Договори 24 381 · Фирми с поръчки
   *  0 от 4383". Whenever there IS procurement and 125 returned nothing, the honest
   *  answer is „—", the same shape `directShare` uses one card over. */
  const winningCompanies =
    byCompany.length === 0 && contractCount > 0 ? null : byCompany.length;

  // Person signal chips.
  const chips = useMemo(() => {
    const out: {
      tone: keyof typeof chipTone;
      icon: FC<{ className?: string }>;
      label: string;
    }[] = [];
    const top1 = procurement?.byAwarder?.[0];
    if (top1 && totalEur > 0 && top1.totalEur / totalEur >= 0.6)
      out.push({
        tone: "amber",
        icon: Crosshair,
        label: bg
          ? `${Math.round((top1.totalEur / totalEur) * 100)}% от един възложител`
          : `${Math.round((top1.totalEur / totalEur) * 100)}% from one buyer`,
      });
    if (politicians.length > 0)
      out.push({
        tone: "violet",
        icon: Landmark,
        label: bg
          ? `Политически връзки (${politicians.length})`
          : `Political links (${politicians.length})`,
      });
    if (procurement && procurement.breakdown.euEur > 0)
      out.push({
        tone: "emerald",
        icon: Euro,
        label: bg ? "Финансиране от ЕС" : "EU funding",
      });
    const nSectors = procurement?.breakdown.cpvRaw.length ?? 0;
    if (nSectors > 0)
      out.push({
        tone: "muted",
        icon: PieChart,
        label: bg
          ? `Активен в ${nSectors} ${nSectors === 1 ? "сектор" : "сектора"}`
          : `Active in ${nSectors} ${nSectors === 1 ? "sector" : "sectors"}`,
      });
    return out;
  }, [procurement, totalEur, politicians.length, bg]);

  const maxRoleEur = useMemo(
    () => Math.max(1, ...roles.map((r) => r.contracts_eur ?? 0)),
    [roles],
  );
  /** One row per COMPANY. Note this is shorter than `roles` whenever the person holds
   *  more than one role somewhere — the ordinary ЕООД case — which is exactly why the
   *  card's heading counts these and not the raw rows. */
  const participations = useMemo(() => foldParticipations(roles), [roles]);
  const shownParticipations = allParticipations
    ? participations
    : participations.slice(0, PARTICIPATIONS_SHOWN);
  /** Roles the timeline cannot plot, because they carry no `added_at`.
   *
   *  Counted per ROLE, not per company, because the timeline draws one bar PER ROLE
   *  („Периоди на роля по фирми") while the list above it is now one row per company.
   *  Those two counts genuinely differ — verified live: 7 companies, 8 bars, because
   *  one firm carries both съдружник and действителен собственик. */
  const undatedRoles = useMemo(
    () => roles.filter((r) => !isPlottableRole(r)).length,
    [roles],
  );
  /** Companies the timeline can actually draw.
   *
   *  ⚠️ DERIVED, never assumed equal to `participations.length`. A company ALL of whose
   *  roles lack `added_at` gets no bar at all — measured 2026-08-25, 73,156 (person,
   *  company) pairs over 63,686 people are in that shape — so „Същите N фирми" would be
   *  a false correspondence. Stating „X от N" whenever they differ makes the note
   *  self-correcting instead, and keeps the headline count in ONE unit: the caveat
   *  beside it counts ROLES, and two adjacent numbers in different units invite a
   *  subtraction that is right only by luck. */
  const timelineCompanies = useMemo(
    () => new Set(roles.filter(isPlottableRole).map((r) => r.uic)).size,
    [roles],
  );
  /** True when at least one company contributes more than one bar.
   *
   *  The caveat it gates says „няколко роли … повече от веднъж" rather than naming two:
   *  21,378 (person, company) pairs over 18,990 people carry three or more roles, up to
   *  five, so „appears twice" is simply wrong for them. */
  const multiRoleCompany = useMemo(
    () => participations.some((p) => p.merged),
    [participations],
  );

  // Whether the "Профил на възлагането" grid has a tile that will actually render.
  // All three tiles inside it self-hide on an EMPTY ARRAY, and DashboardSection
  // cannot see that — `isRenderable` returns true for any valid element, including
  // one that renders null — so the wrapper must be conditional or the layout div
  // alone would keep that section's own self-hiding from ever firing.
  const hasAwardingCuts =
    (rollup?.byAwarder.length ?? 0) > 0 ||
    byCompany.length > 0 ||
    bySettlement.length > 0;

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <GovernanceBreadcrumb
        sectionKey="persons_title"
        sectionTo="/persons"
        current={person}
        className="mb-3"
      />
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Лице (Търговски регистър)
        </div>
        <h1 className="text-2xl font-bold">{person}</h1>
        {!loading && !error && (
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>{num.format(summary.companies)} фирми</span>
            <span>{num.format(summary.active)} активни роли</span>
            {contractCount > 0 && (
              <span>{num.format(contractCount)} договора</span>
            )}
            {totalEur > 0 && <span>{formatEur(totalEur, i18n.language)}</span>}
            <span>{num.format(politicians.length)} политически връзки</span>
          </div>
        )}
        {!loading && !error && chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((c, i) => {
              const Icon = c.icon;
              return (
                <span
                  key={i}
                  title={c.label}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${chipTone[c.tone]}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[15rem]">{c.label}</span>
                </span>
              );
            })}
          </div>
        )}
        {!loading && !error && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("person_namesake_disclosure")}</span>
          </p>
        )}
      </div>

      {loading && <div className="text-muted-foreground">Зареждане…</div>}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          {/* If this person is a magistrate with a declared company (ИВСС), show it.
              Renders nothing otherwise. */}
          <PersonMagistrateHoldingsTile name={person} />
          {/* The richer bridge: politicians reachable from a magistrate's declared
              companies over the officer graph. Renders nothing unless a link exists. */}
          <PersonMagistratePoliticianLinks name={person} />

          {/* ФИРМИ — who this person is in business terms, before what those
              companies won. Leads the page for the same reason the modern dashboard
              leads with offices rather than wealth: identity first, analysis after.
              Участия and the timeline are the SAME `person_roles` rows in two views,
              which is why they now share one section instead of sitting ~90 lines
              apart with the whole procurement block between them. */}
          <DashboardSection
            id="person-portfolio"
            title="Фирми"
            icon={Briefcase}
            headingLevel={2}
          >
            {roles.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Няма намерени участия за това име.
              </div>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Coins className="h-4 w-4" /> Участия (
                    {num.format(participations.length)})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ParticipationRows
                    rows={shownParticipations}
                    maxRoleEur={maxRoleEur}
                    t={t}
                    lang={i18n.language}
                  />
                  {/* The cap exists because a mass filer runs to hundreds of rows and
                      the section below it then never gets seen. It is a DISCLOSURE
                      whenever it binds, never a silent truncation.
                      ⚠️ The order is the QUERY's (active, then newest), not by money —
                      so the biggest earner can sit behind the toggle while the visible
                      twelve show short bars against a maximum scaled over ALL rows. The
                      label says the hidden rows are older rather than smaller, so the
                      bars cannot be read as „these are the big ones". */}
                  {participations.length > PARTICIPATIONS_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setAllParticipations((v) => !v)}
                      aria-expanded={allParticipations}
                      className="mt-2 text-sm text-accent hover:underline"
                    >
                      {allParticipations
                        ? "Покажи по-малко"
                        : `Покажи всички ${num.format(participations.length)} фирми`}
                    </button>
                  )}
                  {participations.length > PARTICIPATIONS_SHOWN &&
                    !allParticipations && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Подредени по актуалност, не по стойност — най-голямата
                        по пари фирма може да е сред скритите.
                      </p>
                    )}
                </CardContent>
              </Card>
            )}
            {/* The SAME participations on a time axis, said in words — otherwise two
                cards of the same ten facts read as two datasets that ought to agree.
                It plots `added_at`, so roles without one are dropped; that omission was
                invisible (10 участия, 6 bars, nothing explaining the gap) and is now
                counted in `undatedRoles` and stated. Self-hides when NO role is dated. */}
            {roles.length > 0 && (
              <PersonTimelineTile
                roles={roles}
                note={[
                  // ⚠️ „Същите" and „подредени" are BOTH plural — inflecting only the
                  // noun emits „Същите 1 фирма, подредени", which is ungrammatical and
                  // fires for every person with exactly one company, the commonest
                  // shape. Bulgarian also does not count to one out loud here.
                  timelineCompanies !== participations.length
                    ? bg
                      ? `${num.format(timelineCompanies)} от ${num.format(participations.length)} фирми, подредени във времето.`
                      : `${num.format(timelineCompanies)} of ${num.format(participations.length)} companies, laid out over time.`
                    : participations.length === 1
                      ? bg
                        ? "Същата фирма, подредена във времето."
                        : "The same company, laid out over time."
                      : bg
                        ? `Същите ${num.format(participations.length)} фирми, подредени във времето.`
                        : `The same ${num.format(participations.length)} companies, laid out over time.`,
                  multiRoleCompany &&
                    (bg
                      ? "Тук всяка роля има своя лента, затова фирма с няколко роли се появява повече от веднъж."
                      : "Each role gets its own bar here, so a company with more than one role appears more than once."),
                  undatedRoles > 0 &&
                    (bg
                      ? `${num.format(undatedRoles)} ${
                          undatedRoles === 1 ? "роля няма" : "роли нямат"
                        } дата на вписване и не ${
                          undatedRoles === 1 ? "се показва" : "се показват"
                        } тук.`
                      : `${num.format(undatedRoles)} ${undatedRoles === 1 ? "role has" : "roles have"} no start date and ${undatedRoles === 1 ? "is" : "are"} not shown here.`),
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            )}
          </DashboardSection>

          {/* ОБЩЕСТВЕНИ ПОРЪЧКИ — the headline and the biggest contracts. The whole
              section is gated on there being procurement at all, so the heading can
              never render above nothing. */}
          {rollup && rollup.contractCount > 0 && (
            <DashboardSection
              id="person-procurement"
              title="Обществени поръчки"
              icon={Building2}
              headingLevel={2}
              subtitle={<ScopeControl mode="toggle" />}
            >
              <p className="text-xs text-muted-foreground">
                Сумарно за всички фирми, в които лицето е (или е било) вписано.
              </p>

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <StatCard label="Общо възложени">
                  <div className="flex items-baseline gap-2">
                    <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span
                      className="text-lg md:text-xl font-bold tabular-nums"
                      title={formatEur(totalEur, i18n.language)}
                    >
                      {formatEurCompact(totalEur, i18n.language) || "—"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    средно {formatEur(totalEur / contractCount, i18n.language)}{" "}
                    / договор
                  </div>
                </StatCard>
                <StatCard label="Договори">
                  <div className="flex items-baseline gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {num.format(contractCount)}
                    </span>
                  </div>
                </StatCard>
                {/* „Възложители" moved out of the headline: it duplicated a number the
                    awarders tile below now states with its own cap („Топ 10 / 270"), and
                    beside „Договори" it read as a designed pairing when the two matching
                    is a coincidence of the data. What replaces it is the more telling
                    figure — how much of this money never met an open advert.
                    ⚠️ NOT „Печели пряко", which the plan proposed. Measured over the
                    `direct` bucket corpus-wide, only 9.6% of that money (€660M of
                    €6.90bn) is literally „пряко договаряне"; 78.1% is „договаряне без
                    предварително обявление" and 12.3% is the OCDS `limited` code. And
                    much of it is LAWFUL sole-sourcing under чл. 79, so a bold
                    person-level „печели пряко" reads as an integrity finding the number
                    does not support. „Без открита процедура" is true of all five raw
                    strings that reach the bucket and accuses nobody. */}
                <StatCard label="Без открита процедура">
                  <div className="flex items-baseline gap-2">
                    <Crosshair className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {directShare
                        ? `${pctFmt.format(directShare.share)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {directShare
                      ? `от сумата с известна процедура (${pctFmt.format(directShare.coverage)} от общата; видът е записан главно след 2020 г.)`
                      : "процедурата е известна за твърде малка част от сумата"}
                  </div>
                </StatCard>
                {/* „Фирми в портфейла" answered a Фирми-section question from inside
                    the procurement section, and the Участия heading above already counts
                    the same companies. Framed as a RATIO it becomes a procurement fact:
                    how concentrated this money is across the portfolio. */}
                <StatCard label="Фирми с поръчки">
                  <div className="flex items-baseline gap-2">
                    <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                    {/* The leading space is in the STRING, not only in the flex gap: a
                        gap is invisible to textContent, so „1 от 2" was reaching the
                        clipboard and the accessible name as „1от 2" — the same defect
                        the participation tags carry a note about. */}
                    <span className="text-2xl font-bold tabular-nums">
                      {winningCompanies === null
                        ? "—"
                        : num.format(winningCompanies)}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {" "}
                      от {num.format(summary.companies)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    владее {num.format(summary.owns)} · управлява{" "}
                    {num.format(summary.manages)}
                  </div>
                </StatCard>
              </div>

              <CompanyTopContractsTile
                eik=""
                rollup={rollup}
                partyHref={(e) => `/company/${e}`}
                contractorHref={(e) => `/company/${e}`}
                seeAllHref={`/person/${encodeURIComponent(person)}/contracts`}
              />
            </DashboardSection>
          )}

          {/* ПРОФИЛ НА ВЪЗЛАГАНЕТО — the analytical cuts: who pays, where, in what,
              and when. Split off the headline section above so the page's opening
              answer ("how much, and the biggest contracts") is not buried under six
              breakdown tiles.

              No extra gate beyond the rollup, and the reason is an SQL invariant
              rather than a JSX one: `byaw` (024_person_api.sql) carries
              `HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0`, so `byAwarder`
              is non-empty whenever `contractCount > 0` — and CompanyTopAwardersTile
              hides only on an empty `byAwarder`. The section therefore always has one
              visible child. Every child below is individually gated on the array its
              tile hides on, so if that HAVING is ever removed DashboardSection's own
              self-hiding takes over rather than leaving a heading above nothing. */}
          {rollup && rollup.contractCount > 0 && (
            <DashboardSection
              id="person-procurement-profile"
              title="Профил на възлагането"
              icon={PieChart}
              headingLevel={2}
            >
              {hasAwardingCuts && (
                <div className="grid gap-4 xl:grid-cols-2">
                  {rollup.byAwarder.length > 0 && (
                    <CompanyTopAwardersTile
                      eik=""
                      rollup={rollup}
                      awarderHref={(e) => `/company/${e}`}
                      seeAllHref={null}
                      showBars
                    />
                  )}
                  {/* The two portfolio cuts — по фирма / по населено място (migration 125).
                      Both reconcile with the headline above. */}
                  {byCompany.length > 0 && (
                    <PersonProcurementBreakdownTile
                      title={t("pp_by_company") || "По фирма"}
                      icon={Building2}
                      rows={byCompany.map<PersonBreakdownRow>((c) => ({
                        id: c.eik,
                        // TR names can carry HTML entities (like every company name in this file).
                        label: decodeEntities(c.name) || c.eik,
                        href: `/company/${c.eik}`,
                        totalEur: c.totalEur,
                        contractCount: c.contractCount,
                      }))}
                    />
                  )}
                  {bySettlement.length > 0 && (
                    <PersonProcurementBreakdownTile
                      title={t("pp_by_settlement") || "По населено място"}
                      icon={MapPin}
                      rows={bySettlement.map<PersonBreakdownRow>((sx) => ({
                        id: sx.ekatte ?? "national",
                        // Settlement names are canonical place-dim strings — no entity decode
                        // needed (unlike the TR company names above).
                        label:
                          sx.settlement ??
                          (t("pp_national_buyers") || "Национални възложители"),
                        href: sx.ekatte
                          ? `/procurement/settlement/${sx.ekatte}`
                          : null,
                        totalEur: sx.totalEur,
                        contractCount: sx.contractCount,
                      }))}
                    />
                  )}
                </div>
              )}

              {breakdown && (
                <ProcurementBreakdownTile kind="c" breakdown={breakdown} />
              )}
              {cabinets.length > 0 && (
                <CabinetTimelineTile cabinets={cabinets} totalEur={totalEur} />
              )}
              {rollup.byYear.length > 0 && (
                <CompanyByYearChart rows={rollup.byYear} />
              )}
            </DashboardSection>
          )}

          {/* ВРЪЗКИ — the three blocks that answer "who is this person connected to".
              One section, because a reader asks that as one question. Tier 3 of the
              plan gives each block the line stating WHICH evidence it rests on: they
              read different tables and can disagree about the same named person, which
              is invisible while they sit apart and obvious once they are adjacent. */}
          <DashboardSection
            id="person-connections"
            title="Връзки"
            icon={Users}
            headingLevel={2}
          >
            {/* Ordered by EVIDENCE, not by topic. The first two blocks read the same
                edge — co-entry in tr_officers — so they sit adjacent and the check
                below reads as "the same question, for a name you choose". Политически
                връзки reads a different table with a different population, so it comes
                last and says so, rather than looking like a third view of one dataset.
                (The timeline that used to separate these three now lives in the Фирми
                section, beside the participations it plots.) */}
            <PersonAssociatesTile associates={associates} />

            {/* The connection check — same edge as the tile above, for one typed name,
                and WITHOUT its two exclusions (no mega-hub cut, no entity-name filter).
                Shared with the resolved /person/:slug profile, which had no way to check
                a connection at all until this was extracted; see the component's header
                for why the basis line is stronger there. */}
            <PersonConnectionCheck
              personName={person}
              politicalAnchor="#person-political-links"
              bg={bg}
            />

            {/* Political connections. `id` is the anchor the negative result above
                points at, so it must not be renamed without following that link.
                `tabIndex={-1}` makes following it move FOCUS as well as scroll —
                without it a keyboard or screen-reader user is jumped to a position
                with no reading point, which is the half of an in-page anchor that is
                easy to ship untested. */}
            <Card
              id="person-political-links"
              tabIndex={-1}
              className="scroll-mt-20"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Landmark className="h-4 w-4" /> Политически връзки (
                  {num.format(politicians.length)})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* „и длъжности" is not padding: the declaration arm emits TWO codes
                    (`stake` 74, `declared_role` 22 — load_tr_pg.ts's `stake_kind`
                    CASE), and `politicianRoleLabel` renders both, so a basis naming
                    only stakes leaves „декларирана длъжност" rows unexplained.
                    „невинаги отразява" rather than „не се вписват" because an ООД
                    съдружник's stake IS in the register — it is АД shareholdings and
                    declared positions that reliably are not. */}
                <EvidenceBasis>
                  {bg
                    ? "Различна основа от двата блока по-горе. Обхваща и декларирани дялове и длъжности, които регистърът невинаги отразява — но само за фирми, спечелили обществени поръчки."
                    : "A different basis from the two blocks above. It also covers declared holdings and positions, which the registry does not always record — but only for companies that have won public contracts."}
                </EvidenceBasis>
                {politicians.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Няма установени връзки с политици през общите фирми.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {politicians.map((p, i) => {
                      const roleLabel = politicianRoleLabel(p.role, t);
                      return (
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
                            {roleLabel ? ` · ${roleLabel}` : ""} · през{" "}
                            <Link
                              to={`/company/${p.via_eik}`}
                              className="hover:underline"
                            >
                              {decodeEntities(p.via_company) || p.via_eik}
                            </Link>
                            {p.total_eur ? ` · ${formatEur(p.total_eur)}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </DashboardSection>
        </div>
      )}
    </div>
  );
};
