// /sector/administration — the Държавна администрация dashboard. A BESPOKE,
// institution-first screen (not the generic SectorDashboardScreen): the state
// administration as an institution — how big, how much it costs, how it is
// staffed — leads; МЕУ's thin e-government procurement folds in as a lower
// section. See docs/plans/administration-view-v1.md §4 (G7 locked).
//
// House UX: stacked bands, homepage width, no tabs. Institution tiles read the
// annual Доклад (personnel.json), year-scoped via ?pscope; trend tiles stay
// full-history. Charts are CSS/flex + inline SVG (no chart lib) so the band
// renders instantly for the OG screenshot.

import { FC, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Users,
  Building2,
  TrendingDown,
  Landmark,
  Banknote,
  MonitorSmartphone,
  MessagesSquare,
  ListChecks,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { StatCard } from "@/screens/dashboard/StatCard";
import { PackSection } from "@/screens/components/procurement/PackSection";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useScope, scopeYear } from "@/data/scope/useScope";
import {
  useAdminContext,
  type AdminContext,
} from "@/data/administration/useAdminContext";
import {
  useAdminEgov,
  type EgovPayload,
} from "@/data/administration/useAdminEgov";
import {
  useAdminServiceQuality,
  type ServiceQualityPayload,
} from "@/data/administration/useAdminServiceQuality";
import {
  useAdminServices,
  type ServicesOverview,
} from "@/data/administration/useAdminServices";
import { pctChange } from "@/data/administration/scopeOverview";
import {
  ADMIN_SECTOR_EIKS,
  ADMIN_ENTITIES,
  ministryName,
} from "@/lib/administrationReferenceData";
import {
  buildAwarderModelFromAggregates,
  type AwarderModel,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  SectorSpendByYearTile,
  SectorTopContractorsTile,
} from "@/screens/sector/SectorCharts";
import { formatEurCompact, formatInt, formatPct } from "@/lib/currency";

const GENERIC_CLASSIFIER: SectorClassifier<"all"> = { categoryOf: () => "all" };

// Fixed colours for the central/territorial split — never repaint by rank.
const C_CENTRAL = "#2f6f8f";
const C_TERRITORIAL = "#c07a2f";

const sumCounts = (r: Record<string, number> | undefined): number =>
  r ? Object.values(r).reduce((a, b) => a + b, 0) : 0;

// ── Tile 1: the decade divergence (full-history, ignores year scope) ─────────
const DivergenceTile: FC<{
  headcount: Array<{ year: number; value: number }>;
  population: Array<{ year: number; value: number }>;
  bg: boolean;
}> = ({ headcount, population, bg }) => {
  const years = headcount.map((h) => h.year);
  if (years.length < 2) return null;
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  // Index both series to 100 at the first administration year so the shapes are
  // comparable regardless of absolute magnitude.
  const popByYear = new Map(population.map((p) => [p.year, p.value]));
  const base = (arr: Array<{ year: number; value: number }>, y: number) =>
    arr.find((p) => p.year === y)?.value ?? null;
  const hBase = base(headcount, y0);
  const pBase = popByYear.get(y0) ?? null;
  if (!hBase || !pBase) return null;

  const W = 320;
  const H = 120;
  const x = (yr: number) => ((yr - y0) / (y1 - y0)) * W;
  const idx: Array<{ year: number; h: number; p: number | null }> = headcount
    .slice()
    .sort((a, b) => a.year - b.year)
    .map((h) => ({
      year: h.year,
      h: (h.value / hBase) * 100,
      p: popByYear.has(h.year) ? (popByYear.get(h.year)! / pBase) * 100 : null,
    }));
  const all = idx.flatMap((d) => [d.h, d.p ?? 100]);
  const lo = Math.min(...all, 90);
  const hi = Math.max(...all, 110);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (key: "h" | "p") =>
    idx
      .filter((d) => d[key] != null)
      .map((d) => `${x(d.year).toFixed(1)},${y(d[key] as number).toFixed(1)}`)
      .join(" ");

  const hChange = pctChange(headcount);
  const pChange = pctChange(
    population.filter((p) => p.year >= y0 && p.year <= y1),
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown className="h-4 w-4 text-rose-500" aria-hidden />
          {bg
            ? "Администрацията расте, населението намалява"
            : "The administration grows as the population shrinks"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            bg ? "Численост срещу население" : "Headcount vs population"
          }
        >
          <polyline
            points={line("p")}
            fill="none"
            stroke="#6b8f2f"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={line("h")}
            fill="none"
            stroke="#c0392b"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-[#c0392b]">
            ● {bg ? "Численост" : "Headcount"}{" "}
            {hChange && (
              <b>
                {hChange.pct >= 0 ? "+" : ""}
                {formatPct(hChange.pct, bg ? "bg" : "en")}
              </b>
            )}
          </span>
          <span className="text-[#4d6b1f]">
            ● {bg ? "Население" : "Population"}{" "}
            {pChange && (
              <b>
                {pChange.pct >= 0 ? "+" : ""}
                {formatPct(pChange.pct, bg ? "bg" : "en")}
              </b>
            )}
          </span>
          <span className="text-muted-foreground">
            {y0}–{y1}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {bg
            ? "Индекс 100 = " +
              y0 +
              ". Население — оценка (номинален БВП ÷ БВП на човек). Отделно: по данни на ИПИ за десетилетието 2015–2025 администрацията расте с ~10%, а населението намалява с ~10%."
            : "Index 100 = " +
              y0 +
              ". Population is derived (nominal GDP ÷ GDP per capita). Separately, IME reports the administration grew ~10% while the population shrank ~10% over the 2015–2025 decade."}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Tile 3: headcount by administration type over time (full-history) ────────
const HeadcountByTypeTile: FC<{
  rows: Array<{
    year: number;
    central: number | null;
    territorial: number | null;
  }>;
  bg: boolean;
}> = ({ rows, bg }) => {
  const withData = rows.filter(
    (r) => r.central != null || r.territorial != null,
  );
  if (withData.length < 2) return null;
  const max = Math.max(
    1,
    ...withData.map((r) => (r.central ?? 0) + (r.territorial ?? 0)),
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-sky-600" aria-hidden />
          {bg
            ? "Численост по тип · щатни бройки"
            : "Headcount by type · positions"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {withData
          .slice()
          .sort((a, b) => b.year - a.year)
          .map((r) => {
            const c = r.central ?? 0;
            const t = r.territorial ?? 0;
            return (
              <div key={r.year} className="flex items-center gap-2 text-xs">
                <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
                  {r.year}
                </span>
                <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    style={{
                      width: `${(c / max) * 100}%`,
                      background: C_CENTRAL,
                    }}
                    title={`${bg ? "Централна" : "Central"}: ${formatInt(c, bg ? "bg" : "en")}`}
                  />
                  <div
                    style={{
                      width: `${(t / max) * 100}%`,
                      background: C_TERRITORIAL,
                    }}
                    title={`${bg ? "Териториална" : "Territorial"}: ${formatInt(t, bg ? "bg" : "en")}`}
                  />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums">
                  {formatInt(c + t, bg ? "bg" : "en")}
                </span>
              </div>
            );
          })}
        <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
              style={{ background: C_CENTRAL }}
            />
            {bg ? "Централна" : "Central"}
          </span>
          <span>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
              style={{ background: C_TERRITORIAL }}
            />
            {bg ? "Териториална" : "Territorial"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

// ── Tile 4: structures by type (year-scoped) ─────────────────────────────────
const StructuresTile: FC<{
  counts: Array<{ label: string; count: number }>;
  bg: boolean;
}> = ({ counts, bg }) => {
  const rows = counts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-teal-600" aria-hidden />
          {bg ? "Административни структури" : "Administrative structures"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span
              className="w-40 shrink-0 truncate text-muted-foreground"
              title={r.label}
            >
              {r.label}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                className="h-full"
                style={{
                  width: `${(r.count / max) * 100}%`,
                  background: C_CENTRAL,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums">
              {formatInt(r.count, bg ? "bg" : "en")}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

// ── Tile 5: personnel cost per FTE, largest ministries (year-scoped) ─────────
const CostPerFteTile: FC<{
  rows: Array<{ adminId: string; eur: number }>;
  year: number;
  bg: boolean;
}> = ({ rows, year, bg }) => {
  const clean = rows.filter((r) => r.eur > 0).sort((a, b) => b.eur - a.eur);
  if (!clean.length) return null;
  const max = Math.max(...clean.map((r) => r.eur));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-indigo-600" aria-hidden />
          {bg
            ? "Разход за персонал на щат · " + year
            : "Personnel cost per FTE · " + year}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {clean.map((r) => (
          <div key={r.adminId} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate text-muted-foreground">
              {ministryName(r.adminId, bg)}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                className="h-full"
                style={{
                  width: `${(r.eur / max) * 100}%`,
                  background: "#6d5b9c",
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums">
              {formatEurCompact(r.eur, bg ? "bg" : "en")}
            </span>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? "Само министерствата с програмен бюджет (частично покритие)."
            : "Ministries with a programme budget only (partial coverage)."}
        </p>
      </CardContent>
    </Card>
  );
};

// ── EU context: general public services, % of GDP, BG vs peers ───────────────
const GEO_LABEL: Record<string, { bg: string; en: string }> = {
  BG: { bg: "България", en: "Bulgaria" },
  EU27_2020: { bg: "ЕС27", en: "EU27" },
  EL: { bg: "Гърция", en: "Greece" },
  RO: { bg: "Румъния", en: "Romania" },
  HU: { bg: "Унгария", en: "Hungary" },
  HR: { bg: "Хърватия", en: "Croatia" },
};

const EuCompareTile: FC<{
  euCompare: AdminContext["gf01"]["euCompare"] | undefined;
  bg: boolean;
}> = ({ euCompare, bg }) => {
  const band = euCompare?.band;
  const year = euCompare?.year;
  if (!band || !euCompare?.bars.length) return null;
  const rows = euCompare.bars.slice().sort((a, b) => b.pct - a.pct);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.pct));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-emerald-600" aria-hidden />
          {bg
            ? `Общи държавни служби, % от БВП · ${year}`
            : `General public services, % of GDP · ${year}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => {
          const isBg = r.geo === "BG";
          return (
            <div key={r.geo} className="flex items-center gap-2 text-xs">
              <span
                className={
                  "w-20 shrink-0 truncate " +
                  (isBg ? "font-semibold" : "text-muted-foreground")
                }
              >
                {GEO_LABEL[r.geo]?.[bg ? "bg" : "en"] ?? r.geo}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="h-full"
                  style={{
                    width: `${(r.pct / max) * 100}%`,
                    background: isBg ? "#2f8f5b" : "#9aa0a6",
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right tabular-nums">
                {r.pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `България е ${band.rank}-а от ${band.total} в ЕС (средно ${band.euAvgPctGdp != null ? band.euAvgPctGdp.toFixed(1) + "%" : "н.д."}). GF01 включва и обслужването на държавния дълг и външните работи — ниският дял отразява отчасти по-малкото лихвено бреме, не само по-слаба администрация.`
            : `Bulgaria ranks ${band.rank} of ${band.total} in the EU (EU avg ${band.euAvgPctGdp != null ? band.euAvgPctGdp.toFixed(1) + "%" : "n/a"}). GF01 also folds in public-debt interest and foreign affairs — the low share partly reflects a lighter debt burden, not only a leaner administration.`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Digital: e-government use, BG vs EU peers (Eurostat) ─────────────────────
const EgovAdoptionTile: FC<{ egov: EgovPayload | undefined; bg: boolean }> = ({
  egov,
  bg,
}) => {
  if (!egov) return null;
  const year = egov.latestYear;
  const rows = Object.entries(egov.byGeo)
    .map(([geo, pts]) => ({
      geo,
      value: pts.find((p) => p.year === year)?.value ?? null,
    }))
    .filter((r): r is { geo: string; value: number } => r.value != null)
    .sort((a, b) => b.value - a.value);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const bgV = rows.find((r) => r.geo === "BG")?.value ?? null;
  const euV = rows.find((r) => r.geo === "EU27_2020")?.value ?? null;
  const trend = egov.byGeo.BG ?? [];
  const first = trend[0];
  const last = trend[trend.length - 1];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4 text-violet-600" aria-hidden />
          {bg
            ? `Използване на е-управление · ${year}`
            : `e-Government use · ${year}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => {
          const isBg = r.geo === "BG";
          const isEu = r.geo === "EU27_2020";
          return (
            <div key={r.geo} className="flex items-center gap-2 text-xs">
              <span
                className={
                  "w-20 shrink-0 truncate " +
                  (isBg
                    ? "font-semibold"
                    : isEu
                      ? "font-medium"
                      : "text-muted-foreground")
                }
              >
                {GEO_LABEL[r.geo]?.[bg ? "bg" : "en"] ?? r.geo}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="h-full"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    background: isBg ? "#6d28d9" : isEu ? "#94739e" : "#9aa0a6",
                  }}
                />
              </div>
              <span className="w-12 shrink-0 text-right tabular-nums">
                {r.value.toFixed(1)}%
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `Дял на хората, взаимодействали онлайн с администрацията (последните 12 м.). България — ${bgV != null ? bgV.toFixed(1) : "н.д."}%${euV != null ? ` срещу ${euV.toFixed(1)}% средно за ЕС — сред най-ниските в Съюза` : ""}${first && last ? `; ръст ${first.value.toFixed(0)}%→${last.value.toFixed(0)}% (${first.year}–${last.year})` : ""}. Източник: Eurostat isoc_ciegi_ac (I_IUGOV1).`
            : `Share of people who interacted online with the administration (last 12 months). Bulgaria — ${bgV != null ? bgV.toFixed(1) : "n/a"}%${euV != null ? ` vs the EU average ${euV.toFixed(1)}% — among the lowest in the Union` : ""}${first && last ? `; up ${first.value.toFixed(0)}%→${last.value.toFixed(0)}% (${first.year}–${last.year})` : ""}. Source: Eurostat isoc_ciegi_ac (I_IUGOV1).`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Service quality: signals volume + satisfaction-measurement compliance ────
const ServiceQualityTile: FC<{
  sq: ServiceQualityPayload | undefined;
  bg: boolean;
}> = ({ sq, bg }) => {
  if (!sq) return null;
  const rows = Object.entries(sq.byYear)
    .map(([y, v]) => ({ year: Number(y), signals: v.signals }))
    .filter((r): r is { year: number; signals: number } => r.signals != null)
    .sort((a, b) => a.year - b.year);
  const latestY = sq.latestYear != null ? String(sq.latestYear) : undefined;
  const latest = latestY ? sq.byYear[latestY] : undefined;
  const sat = latest?.satisfactionMeasured;
  if (!rows.length && !sat) return null;
  const max = rows.length ? Math.max(...rows.map((r) => r.signals)) : 1;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const growth =
    first && last && first.signals > 0
      ? (last.signals - first.signals) / first.signals
      : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4 w-4 text-orange-600" aria-hidden />
          {bg
            ? "Сигнали за административното обслужване"
            : "Signals about administrative service"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.year} className="flex items-center gap-2 text-xs">
            <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
              {r.year}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                className="h-full"
                style={{
                  width: `${(r.signals / max) * 100}%`,
                  background: "#d97706",
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right tabular-nums">
              {formatInt(r.signals, bg ? "bg" : "en")}
            </span>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? `Сигнали от граждани и бизнес по Глава осма от АПК${
                growth != null && last
                  ? ` — ${formatInt(last.signals, "bg")} през ${last.year} (${growth >= 0 ? "+" : ""}${formatPct(growth, "bg")} спрямо ${first.year})`
                  : ""
              }.${
                sat
                  ? ` ${sat.pct.toFixed(0)}% от администрациите измерват удовлетвореността на потребителите (процес, не самата оценка).`
                  : ""
              } Източник: Доклад за състоянието на администрацията.`
            : `Signals from citizens and business under Chapter 8 of the APC${
                growth != null && last
                  ? ` — ${formatInt(last.signals, "en")} in ${last.year} (${growth >= 0 ? "+" : ""}${formatPct(growth, "en")} vs ${first.year})`
                  : ""
              }.${
                sat
                  ? ` ${sat.pct.toFixed(0)}% of administrations measure user satisfaction (the process, not the score itself).`
                  : ""
              } Source: Report on the State of the Administration.`}
        </p>
      </CardContent>
    </Card>
  );
};

// ── Register: administrative services by provider tier (ИИСДА) ───────────────
const ServicesRegisterTile: FC<{
  services: ServicesOverview | undefined;
  bg: boolean;
}> = ({ services, bg }) => {
  if (!services) return null;
  const rows = services.byTier
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-cyan-700" aria-hidden />
          {bg
            ? `Административни услуги · ${formatInt(services.total, "bg")}`
            : `Administrative services · ${formatInt(services.total, "en")}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate text-muted-foreground">
              {bg ? r.bg : r.en}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-muted/40">
              <div
                className="h-full"
                style={{
                  width: `${(r.count / max) * 100}%`,
                  background: "#0e7490",
                }}
              />
            </div>
            <span className="w-12 shrink-0 text-right tabular-nums">
              {formatInt(r.count, bg ? "bg" : "en")}
            </span>
          </div>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          {bg
            ? "Уникални административни услуги в регистъра, по вид на предоставящата администрация. Източник: Административен регистър (ИИСДА)."
            : "Distinct administrative services in the register, by provider tier. Source: Administrative Register (IISDA)."}
        </p>
        <Link
          to="/sector/administration/services"
          className="text-xs font-medium text-primary hover:underline"
        >
          {bg ? "Разгледай всички услуги →" : "Browse all services →"}
        </Link>
      </CardContent>
    </Card>
  );
};

export const AdministrationScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const { scope } = useScope();
  const year = scopeYear(scope);

  // ONE ~8 KB precomputed blob replaces personnel.json + macro.json + cofog.json
  // (~324 KB) on this page — see scripts/administration/build_context.ts.
  const { data: ctx } = useAdminContext();
  const { data: egov } = useAdminEgov();
  const { data: serviceQuality } = useAdminServiceQuality();
  const { data: services } = useAdminServices();

  const years = useMemo(
    () =>
      ctx
        ? Object.keys(ctx.national)
            .map(Number)
            .sort((a, b) => b - a)
        : [],
    [ctx],
  );
  const selYear = year ?? years[0] ?? new Date().getFullYear();
  const nat = useMemo(() => {
    if (!ctx) return undefined;
    const y = year != null && ctx.national[String(year)] ? year : years[0];
    return y != null ? ctx.national[String(y)] : undefined;
  }, [ctx, year, years]);

  // Headcount + derived population series for the divergence tile (full-history).
  const headcountSeries = useMemo(
    () =>
      ctx
        ? years
            .map((y) => ({
              year: y,
              value: ctx.national[String(y)].positions.total,
            }))
            .sort((a, b) => a.year - b.year)
        : [],
    [ctx, years],
  );
  const popSeries = ctx?.population ?? [];
  const byTypeRows = useMemo(
    () =>
      ctx
        ? years.map((y) => {
            const p = ctx.national[String(y)].positions;
            return { year: y, central: p.central, territorial: p.territorial };
          })
        : [],
    [ctx, years],
  );

  // GF01 cost for the scoped year, clamped to the latest COFOG year (precomputed
  // pctGdp + perCapita already baked into the context).
  const cost = useMemo(() => {
    if (!ctx?.gf01.series.length) return null;
    const useYear = Math.min(selYear, ctx.cofogLatestYear);
    return (
      ctx.gf01.series.find((s) => s.year === useYear) ??
      ctx.gf01.series[ctx.gf01.series.length - 1] ??
      null
    );
  }, [ctx, selYear]);

  // Structures for the scoped year.
  const structureRows = useMemo(() => {
    if (!nat) return [];
    const both = {
      ...nat.structureCounts.central,
      ...nat.structureCounts.territorial,
    };
    return Object.entries(both).map(([label, count]) => ({ label, count }));
  }, [nat]);

  // Cost per FTE — scoped year if byMinistry covers it, else the latest that does.
  const costRows = useMemo(() => {
    if (!ctx)
      return {
        rows: [] as Array<{ adminId: string; eur: number }>,
        year: selYear,
      };
    const mYears = Object.keys(ctx.costByYear)
      .map(Number)
      .sort((a, b) => b - a);
    const useY =
      year != null && ctx.costByYear[String(year)] ? year : mYears[0];
    return {
      rows: useY != null ? ctx.costByYear[String(useY)] : [],
      year: useY ?? selYear,
    };
  }, [ctx, year, selYear]);

  // e-government procurement group — folded server-side. Year-scoped money
  // window; on the default (latest) view show the group's full-corpus total.
  const moneyWindow = useMemo(
    () =>
      year != null
        ? { from: `${year}-01-01`, to: `${year + 1}-01-01` }
        : { from: null, to: null },
    [year],
  );
  const build = useCallback(
    (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, GENERIC_CLASSIFIER),
    [],
  );
  const { model, byUnit } = useAwarderGroupModel(
    ADMIN_SECTOR_EIKS,
    build,
    moneyWindow,
    true,
  );
  const moneyModel = model as AwarderModel<"all"> | null;
  const awarderN = byUnit.filter((u) => (u.totalEur ?? 0) > 0).length;

  const filled = nat?.positions.filled ?? null;
  const vacant = nat?.positions.vacant ?? null;
  const structureTotal =
    (nat
      ? sumCounts(nat.structureCounts.central) +
        sumCounts(nat.structureCounts.territorial)
      : 0) || null;

  const title = bg ? "Държавна администрация" : "State administration";
  const description = bg
    ? "Колко голяма е държавната администрация, колко струва и как е разпределена — по данни на годишния Доклад за състоянието на администрацията, плюс парите за електронно управление."
    : "How big the Bulgarian state administration is, what it costs and how it is staffed — from the annual Report on the State of the Administration, plus the money behind e-government.";

  return (
    <div className="space-y-4" id="sector-dashboard">
      <Title description={description}>{title}</Title>
      <SectorBreadcrumb currentKey="sector_admin_title" />

      <div className="mb-3">
        <ScopeControl
          mode="toggle"
          years={years}
          nsLabelOverride={bg ? "Най-нова година" : "Latest year"}
          allowAll={false}
        />
      </div>

      {/* Tile 2 — the institution KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={bg ? "Щатна численост" : "Positions"}
          hint={
            bg
              ? `Обща щатна численост на администрацията, ${selYear}.`
              : `Total administration positions, ${selYear}.`
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {nat ? formatInt(nat.positions.total, bg ? "bg" : "en") : "—"}
          </span>
        </StatCard>
        <StatCard
          label={bg ? "Структури" : "Structures"}
          hint={
            bg
              ? "Брой административни структури."
              : "Administrative structures."
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {structureTotal ? formatInt(structureTotal, bg ? "bg" : "en") : "—"}
          </span>
        </StatCard>
        <StatCard
          label={bg ? "Незаети щатове" : "Vacancies"}
          hint={
            bg
              ? "Незаети щатни бройки и дял от общата численост."
              : "Vacant positions and share of the total."
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {vacant != null ? formatInt(vacant, bg ? "bg" : "en") : "—"}
          </span>
          {vacant != null && filled != null && (
            <span className="ml-1 text-sm text-muted-foreground">
              {formatPct(vacant / (vacant + filled), bg ? "bg" : "en")}
            </span>
          )}
        </StatCard>
        <StatCard
          label={bg ? "Общи държавни служби" : "General public services"}
          hint={
            bg
              ? `COFOG GF01 (вкл. обслужване на дълга и външни работи), ${cost?.year ?? "—"}.`
              : `COFOG GF01 (incl. debt service & foreign affairs), ${cost?.year ?? "—"}.`
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {cost ? formatEurCompact(cost.valueEur, bg ? "bg" : "en") : "—"}
          </span>
          {cost?.perCapita != null && (
            <span className="ml-1 text-sm text-muted-foreground">
              {formatEurCompact(cost.perCapita, bg ? "bg" : "en")}/
              {bg ? "чов." : "cap"}
            </span>
          )}
        </StatCard>
      </div>

      {/* Institution — size & workforce */}
      <PackSection
        icon={Users}
        title={bg ? "Мащаб и щат" : "Scale & workforce"}
        id="admin-institution"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <DivergenceTile
            headcount={headcountSeries}
            population={popSeries}
            bg={bg}
          />
          <HeadcountByTypeTile rows={byTypeRows} bg={bg} />
          <StructuresTile counts={structureRows} bg={bg} />
          <CostPerFteTile rows={costRows.rows} year={costRows.year} bg={bg} />
          <ServicesRegisterTile services={services} bg={bg} />
          <EuCompareTile euCompare={ctx?.gf01.euCompare} bg={bg} />
        </div>
      </PackSection>

      {/* Service quality — signals + satisfaction-measurement compliance */}
      {serviceQuality && (
        <PackSection
          icon={MessagesSquare}
          title={bg ? "Качество на обслужването" : "Service quality"}
          sub={
            bg
              ? "Обратна връзка от гражданите — по годишния Доклад за състоянието на администрацията."
              : "Feedback from citizens — from the annual Report on the State of the Administration."
          }
          id="admin-quality"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <ServiceQualityTile sq={serviceQuality} bg={bg} />
          </div>
        </PackSection>
      )}

      {/* Digital — e-government adoption vs the EU */}
      {egov && (
        <PackSection
          icon={MonitorSmartphone}
          title={bg ? "Дигитално управление" : "Digital government"}
          sub={
            bg
              ? "Къде е България в ЕС по използване на електронни услуги."
              : "Where Bulgaria stands in the EU on e-service use."
          }
          id="admin-digital"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <EgovAdoptionTile egov={egov} bg={bg} />
          </div>
        </PackSection>
      )}

      {/* Money — the e-government procurement group */}
      <PackSection
        icon={Banknote}
        title={bg ? "Пари за електронно управление" : "The e-government money"}
        sub={
          bg
            ? "Обществени поръчки на групата МЕУ + ИА ИЕУ + ДАЕУ (сгънати)."
            : "Procurement by the МЕУ + ИА ИЕУ + ДАЕУ group (folded)."
        }
        id="admin-money"
      >
        {moneyModel && moneyModel.totalEur > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label={bg ? "Възложени поръчки" : "Total awarded"}>
                <span className="text-xl font-bold tabular-nums">
                  {formatEurCompact(moneyModel.totalEur, bg ? "bg" : "en")}
                </span>
              </StatCard>
              <StatCard label={bg ? "Договори" : "Contracts"}>
                <span className="text-xl font-bold tabular-nums">
                  {formatInt(moneyModel.contractCount, bg ? "bg" : "en")}
                </span>
              </StatCard>
              <StatCard label={bg ? "Изпълнители" : "Contractors"}>
                <span className="text-xl font-bold tabular-nums">
                  {formatInt(moneyModel.suppliers.length, bg ? "bg" : "en")}
                </span>
              </StatCard>
              <StatCard label={bg ? "Институции" : "Buyers"}>
                <span className="text-xl font-bold tabular-nums">
                  {awarderN}
                </span>
              </StatCard>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <SectorSpendByYearTile model={moneyModel} />
              <SectorTopContractorsTile model={moneyModel} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Няма поръчки в избрания обхват."
              : "No contracts in the selected scope."}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {ADMIN_ENTITIES.map((e) => (
            <Link
              key={e.eik}
              to={`/awarder/${e.eik}`}
              className="rounded-full border px-3 py-1 text-xs hover:bg-muted"
            >
              {bg ? e.name.bg : e.name.en}
              <span className="ml-1 text-muted-foreground">
                · {bg ? e.role.bg : e.role.en}
              </span>
            </Link>
          ))}
        </div>
      </PackSection>
    </div>
  );
};
