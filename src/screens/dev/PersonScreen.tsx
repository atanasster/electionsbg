// DB-backed person page (/person/:name) — a dashboard that rolls the person's
// whole PORTFOLIO up to the individual. Unlike the JSON-fed /procurement/people
// scanner, it queries Postgres live so it works for ANY TR officer:
//   • portfolio procurement rollup — top awarders / top contracts / sectors /
//     by-cabinet / by-year, aggregated over every company the person runs/owns
//     (person_procurement, person_by_cabinet), reusing the company-page tiles;
//   • Участия split into ownership vs management, with a portfolio value bar;
//   • inner circle — the people co-appearing across the person's companies;
//   • political connections; a visual tenure timeline; a connection check.
// A person is identified only by folded name (TR has no person id), so rows may
// span more than one real individual sharing the name; and our TR store only
// covers ~2022+, so older participations may be missing. Served by /api/db — the
// Vite plugin in dev, the `db` Cloud Function (hosting rewrite) in prod.
// See docs/plans/postgres-migration-v1.md.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Coins,
  Crosshair,
  Euro,
  FileText,
  Info,
  Landmark,
  Link2,
  PieChart,
  Search,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { trRoleLabel } from "@/lib/trRole";
import { decodeEntities } from "@/lib/decodeEntities";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import { StatCard } from "../dashboard/StatCard";
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
import { PersonTimelineTile } from "../components/procurement/PersonTimelineTile";
import type {
  ProcurementContractorRollup,
  ProcurementBreakdown,
} from "@/data/dataTypes";

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
interface ConnRow {
  uic: string;
  company: string | null;
  status: string | null;
  a_roles: string | null;
  b_roles: string | null;
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

// Ownership roles (vs management) — the split that makes Участия meaningful.
const OWNS = new Set(["sole_owner", "partner", "actual_owner"]);

const PERIOD_ALL = "all";
const PERIOD_LAST4 = "last4";
const NOW_YEAR = new Date().getFullYear();
const PERIOD_YEARS: string[] = Array.from(
  { length: NOW_YEAR - 2007 + 1 },
  (_, i) => String(NOW_YEAR - i),
);
const periodRange = (p: string): [string | null, string | null] => {
  if (p === PERIOD_ALL) return [null, null];
  if (p === PERIOD_LAST4) return [`${NOW_YEAR - 3}-01-01`, null];
  return [`${p}-01-01`, `${p}-12-31`];
};

const num = new Intl.NumberFormat("bg-BG");
const day = (s: string | null): string => (s ? String(s).slice(0, 10) : "—");
const pct = (s: string | number | null): string =>
  s === null || s === undefined || s === "" ? "—" : `${Math.round(Number(s))}%`;

// At-a-glance signal chips (person-shaped analogue of CompanyRiskChips).
const chipTone = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  violet:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  emerald:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  muted: "bg-muted text-muted-foreground",
} as const;

export const PersonScreen: FC = () => {
  const { name = "" } = useParams();
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const person = decodeURIComponent(name);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [politicians, setPoliticians] = useState<PoliticianRow[]>([]);
  const [procurement, setProcurement] = useState<DbRollup | null>(null);
  const [cabinets, setCabinets] = useState<CabinetRow[]>([]);
  const [associates, setAssociates] = useState<Associate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>(PERIOD_ALL);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const [from, to] = periodRange(period);
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
        }
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [person, period]);

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
  const ownsRoles = roles.filter((r) => OWNS.has(r.role ?? ""));
  const managesRoles = roles.filter((r) => !OWNS.has(r.role ?? ""));

  // Custom connection check (unchanged).
  const [other, setOther] = useState("");
  const [conn, setConn] = useState<ConnRow[] | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  const checkConnection = useCallback(() => {
    const b = other.trim();
    if (!b) return;
    setConnLoading(true);
    setConn(null);
    fetch(
      `/api/db/connection?a=${encodeURIComponent(person)}&b=${encodeURIComponent(b)}`,
    )
      .then((r) => r.json())
      .then((j) => setConn(j.shared ?? []))
      .catch(() => setConn([]))
      .finally(() => setConnLoading(false));
  }, [other, person]);

  // Shared row renderer for the owns/manages participations tables.
  const RoleRows: FC<{ rows: RoleRow[] }> = ({ rows }) => (
    <table className="w-full text-sm [&_td]:px-2 [&_td]:first:pl-0 [&_th]:px-2 [&_th]:first:pl-0">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="py-1">Фирма</th>
          <th className="py-1">Роля</th>
          <th className="py-1 text-right">Дял</th>
          <th className="py-1">От</th>
          <th className="py-1">Статус</th>
          <th className="py-1 text-right">Стойност</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={`${r.uic}-${r.role}-${i}`}
            className="border-t border-border"
          >
            <td className="py-1">
              <Link
                to={`/db/company/${r.uic}`}
                className="text-accent hover:underline"
              >
                {decodeEntities(r.company) || r.uic}
              </Link>
            </td>
            <td className="py-1 text-muted-foreground">
              {trRoleLabel(r.role, t)}
            </td>
            <td className="py-1 text-right tabular-nums">
              {r.role === "sole_owner" && (r.share === null || r.share === "")
                ? "100%"
                : pct(r.share)}
            </td>
            <td className="py-1 tabular-nums text-muted-foreground">
              {day(r.added_at)}
            </td>
            <td className="py-1">
              {r.active ? (
                <span className="text-emerald-600">активен</span>
              ) : (
                <span className="text-muted-foreground">
                  бивш · {day(r.erased_at)}
                </span>
              )}
            </td>
            <td className="py-1">
              <div className="flex items-center justify-end gap-2">
                {r.contracts_eur ? (
                  <>
                    <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded bg-muted md:w-20">
                      <span
                        className="block h-full rounded bg-primary/60"
                        style={{
                          width: `${Math.max(3, (r.contracts_eur / maxRoleEur) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="w-16 text-right tabular-nums md:w-20">
                      {formatEurCompact(r.contracts_eur, i18n.language)}
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
  );

  return (
    <div className="w-full px-4 py-6 md:px-6">
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
          {/* Portfolio procurement */}
          {rollup && rollup.contractCount > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">
                  Обществени поръчки (портфейл)
                </h2>
                <span className="ml-2 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Период</span>
                  <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="w-auto h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PERIOD_ALL}>Всички години</SelectItem>
                      <SelectItem value={PERIOD_LAST4}>
                        Последните 4 г.
                      </SelectItem>
                      {PERIOD_YEARS.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </span>
              </div>
              <p className="text-xs text-muted-foreground -mt-4">
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
                <StatCard label="Фирми в портфейла">
                  <div className="flex items-baseline gap-2">
                    <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                    <span className="text-2xl font-bold tabular-nums">
                      {num.format(summary.companies)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    владее {num.format(summary.owns)} · управлява{" "}
                    {num.format(summary.manages)}
                  </div>
                </StatCard>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <CompanyTopContractsTile
                  eik=""
                  rollup={rollup}
                  partyHref={(e) => `/db/company/${e}`}
                  seeAllHref={null}
                />
                {rollup.byAwarder.length > 0 && (
                  <CompanyTopAwardersTile
                    eik=""
                    rollup={rollup}
                    awarderHref={(e) => `/db/company/${e}`}
                    seeAllHref={null}
                    showBars
                  />
                )}
              </div>

              {breakdown && (
                <ProcurementBreakdownTile
                  kind="c"
                  eik=""
                  breakdown={breakdown}
                />
              )}
              {cabinets.length > 0 && (
                <CabinetTimelineTile cabinets={cabinets} totalEur={totalEur} />
              )}
              {rollup.byYear.length > 0 && (
                <CompanyByYearChart rows={rollup.byYear} />
              )}
            </>
          )}

          {/* Participations — ownership vs management */}
          <div className="flex items-center gap-2 pt-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              Участия ({num.format(roles.length)})
            </h2>
          </div>
          {roles.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Няма намерени участия за това име.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {ownsRoles.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Coins className="h-4 w-4" /> Собственост (
                      {num.format(ownsRoles.length)})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RoleRows rows={ownsRoles} />
                  </CardContent>
                </Card>
              )}
              {managesRoles.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-4 w-4" /> Управление (
                      {num.format(managesRoles.length)})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <RoleRows rows={managesRoles} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Inner circle */}
          <PersonAssociatesTile associates={associates} />

          {/* Political connections */}
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
                  Няма установени връзки с политици през общите фирми.
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
                        {p.role ? ` · ${p.role}` : ""} · през{" "}
                        <Link
                          to={`/db/company/${p.via_eik}`}
                          className="hover:underline"
                        >
                          {decodeEntities(p.via_company) || p.via_eik}
                        </Link>
                        {p.total_eur ? ` · ${formatEur(p.total_eur)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Visual tenure timeline */}
          <PersonTimelineTile roles={roles} />

          {/* Custom connection check */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" /> Проверка на връзка
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex gap-2">
                <Input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && checkConnection()}
                  placeholder="друго име (напр. политик или лице)…"
                  className="h-9 max-w-md"
                />
                <Button onClick={checkConnection} disabled={connLoading}>
                  <Search className="mr-1 h-4 w-4" /> Провери
                </Button>
              </div>
              {conn !== null &&
                (conn.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Няма общи фирми между „{person}“ и „{other}“.
                  </div>
                ) : (
                  <div className="text-sm">
                    <div className="mb-1 text-muted-foreground">
                      Общи фирми ({num.format(conn.length)}):
                    </div>
                    <ul className="space-y-1">
                      {conn.map((c, i) => (
                        <li key={`${c.uic}-${i}`}>
                          <Link
                            to={`/db/company/${c.uic}`}
                            className="text-accent hover:underline"
                          >
                            {decodeEntities(c.company) || c.uic}
                          </Link>
                          <span className="text-muted-foreground">
                            {" "}
                            — „{person}“: {c.a_roles} · „{other}“: {c.b_roles}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
