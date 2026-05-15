// Opening band of the Governance dashboard. Each tile shows the latest
// observation at or before the end of the selected election's term. For the
// current (open-ended) term that's simply the most recent point globally;
// for older terms it's the most recent point inside the term window. The
// "as of" chip names the actual observation period so users can tell what
// the figure refers to.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import {
  ArrowRight,
  Briefcase,
  Landmark,
  Scale,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { LucideIcon } from "lucide-react";
import { useBudgetIndex } from "@/data/budget/useBudget";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import { useMacro, MacroPoint } from "@/data/macro/useMacro";
import { useGovernments, Government } from "@/data/governments/useGovernments";
import { useElectionContext } from "@/data/ElectionContext";
import { useParliamentTerm } from "@/data/parliament/useParliamentTerm";
import { localDate } from "@/data/utils";

// Format ISO date (YYYY-MM-DD or full ISO timestamp) to a human-readable
// "DD/MM/YYYY". localDate() expects the project's underscore-form
// (YYYY_MM_DD); convert and delegate.
const fmtIsoDate = (iso?: string | null): string => {
  if (!iso) return "";
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return iso;
  return localDate(date.replace(/-/g, "_"));
};

type IndicatorProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  asOf?: string | null;
  href?: string;
  hint?: ReactNode;
};

const IndicatorTile: FC<IndicatorProps> = ({
  icon: Icon,
  label,
  value,
  asOf,
  href,
  hint,
}) => {
  const inner = (
    <div className="flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="mt-[1px] h-4 w-4 shrink-0" />
        <span className="line-clamp-2 break-words leading-tight">{label}</span>
        {href ? (
          <ArrowRight
            className="ml-auto mt-[2px] h-3 w-3 shrink-0 opacity-60"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="text-2xl font-bold tabular-nums leading-tight">
        {value}
      </div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
      {asOf ? (
        <div className="mt-auto pt-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
          {asOf}
        </div>
      ) : null}
    </div>
  );
  if (!href) return inner;
  return (
    <Link to={href} underline={false} className="block h-full">
      {inner}
    </Link>
  );
};

// "2026-05-14" → "14/05/2026"; falls back to the raw string. The strip is
// busy, so labels stay short ("като ...").
const asOfChip = (t: (k: string) => string, iso?: string | null): string => {
  if (!iso) return "";
  const human = fmtIsoDate(iso);
  if (!human) return "";
  return `${t("governance_as_of") || "as of"} ${human}`;
};

const fmtPctOne = (n: number | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;

// Compact EUR formatter for the procurement tile — "€1.2B", "€340M",
// "€85K". Keeps the headline figure readable at glance.
const fmtCompactEur = (n: number | undefined | null): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `€${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(0)}K`;
  return `€${Math.round(n)}`;
};

// Latest macro point at or before the term's end. Quarterly points are
// positioned at their quarter start; annual points at their year start.
const pickLatestInTerm = (
  points: MacroPoint[],
  _termStart: Date | null,
  termEnd: Date | null,
): MacroPoint | null => {
  if (!points.length) return null;
  const endKey = termEnd
    ? termEnd.getFullYear() * 4 + Math.floor(termEnd.getMonth() / 3)
    : Infinity;
  let best: MacroPoint | null = null;
  let bestKey = -Infinity;
  for (const p of points) {
    const q = p.quarter ?? 1;
    const key = p.year * 4 + (q - 1);
    if (key >= endKey) continue;
    if (key > bestKey) {
      bestKey = key;
      best = p;
    }
  }
  return best;
};

// Pick the cabinet associated with the selected term. Preference order:
// (1) the government whose `precedingElection` matches the selected
// election — this is the cabinet the term was meant to produce; (2) the
// latest regular cabinet whose start date falls inside [termStart, termEnd);
// (3) the latest cabinet of any type inside the window. Falls back to null.
const pickCabinet = (
  governments: Government[] | undefined,
  selected: string,
  termStart: Date | null,
  termEnd: Date | null,
): Government | null => {
  if (!governments || governments.length === 0) return null;
  const direct = governments.find((g) => g.precedingElection === selected);
  if (direct) return direct;
  const inWindow = governments.filter((g) => {
    const start = new Date(g.startDate);
    if (Number.isNaN(start.getTime())) return false;
    if (termStart && start < termStart) return false;
    if (termEnd && start >= termEnd) return false;
    return true;
  });
  if (inWindow.length === 0) return null;
  const regular = inWindow.filter((g) => g.type === "regular");
  const pool = regular.length > 0 ? regular : inWindow;
  return [...pool].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
};

// PM display name — "Росен Желязков" rather than the long three-part form.
// The strip is dense so we keep the first + last name. Caretaker cabinets
// get a "(служебно)" qualifier on the hint line.
const pmShortName = (fullName: string): string => {
  const parts = fullName.split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

// Days between two ISO dates, inclusive of the start day. Returns null on
// parse failure.
const daysBetween = (startIso: string, end: Date): number | null => {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
};

export const HeadlineIndicatorStrip: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language?.startsWith("bg");
  const { data: budgetIndex } = useBudgetIndex();
  const { data: procurementByNs } = useProcurementByNs();
  const { data: macro } = useMacro();
  const { data: governments } = useGovernments();
  const { selected } = useElectionContext();
  const { termStart, termEnd } = useParliamentTerm();

  // Cabinet for the selected term. Days-in-office is measured to the term
  // end for closed terms, or to today for the open current term.
  const cabinet = pickCabinet(governments, selected, termStart, termEnd);
  const cabinetEnd = cabinet?.endDate ? new Date(cabinet.endDate) : new Date();
  const cabinetDays = cabinet
    ? daysBetween(cabinet.startDate, cabinetEnd)
    : null;
  const cabinetPmName = cabinet
    ? pmShortName(isBg ? cabinet.pmBg : cabinet.pmEn)
    : null;
  const cabinetParties = cabinet
    ? (isBg ? cabinet.parties : cabinet.partiesEn).join(", ") ||
      (isBg ? cabinet.pmPartyBg : cabinet.pmPartyEn) ||
      ""
    : "";
  const cabinetCaretaker = cabinet?.type === "caretaker";

  // Budget: latest fiscal year at or before the term's end that has both
  // planned and actual expenditure. For the open current term that's the most
  // recent completed FY globally; for older terms it's the latest FY that fits
  // inside the term window.
  const termEndYear = termEnd
    ? termEnd.getFullYear()
    : new Date().getFullYear();
  const latestFy =
    budgetIndex?.fiscalYears && budgetIndex.fiscalYears.length > 0
      ? ([...budgetIndex.fiscalYears]
          .filter((fy) => fy.fiscalYear <= termEndYear)
          .sort((a, b) => b.fiscalYear - a.fiscalYear)
          .find(
            (fy) =>
              fy.planned?.expenditure?.amountEur &&
              fy.actual?.expenditure?.amountEur,
          ) ?? null)
      : null;
  const executedPct =
    latestFy &&
    latestFy.planned?.expenditure?.amountEur &&
    latestFy.actual.expenditure?.amountEur
      ? (latestFy.actual.expenditure.amountEur /
          latestFy.planned.expenditure.amountEur) *
        100
      : null;

  // Procurement: switch from raw contract count to total awarded value —
  // the citizen-meaningful figure is "how much money moved through the state
  // procurement pipe", not "how many tenders were signed".
  const procurementEur = procurementByNs?.totals.totalEur ?? null;
  const procurementContracts = procurementByNs?.totals.contracts ?? null;
  const procurementAsOf =
    procurementByNs?.end ?? procurementByNs?.generatedAt ?? null;

  // Macro tail values, scoped to the term window.
  const inflationSeries = macro?.series.inflation ?? [];
  const latestInflation = pickLatestInTerm(inflationSeries, termStart, termEnd);
  const unemploymentSeries = macro?.series.unemployment ?? [];
  const latestUnemployment = pickLatestInTerm(
    unemploymentSeries,
    termStart,
    termEnd,
  );
  const govDebtSeries = macro?.series.govDebt ?? [];
  const latestGovDebt = pickLatestInTerm(govDebtSeries, termStart, termEnd);
  const macroAsOf = macro?.fetchedAt ?? null;
  const inflationPeriod = latestInflation
    ? (latestInflation.period ?? `${latestInflation.year}`)
    : "";
  const unemploymentPeriod = latestUnemployment
    ? (latestUnemployment.period ?? `${latestUnemployment.year}`)
    : "";
  const govDebtPeriod = latestGovDebt
    ? (latestGovDebt.period ?? `${latestGovDebt.year}`)
    : "";

  const cabinetHint = cabinet
    ? `${cabinetParties}${
        cabinetCaretaker
          ? ` · ${t("governance_kpi_cabinet_caretaker") || "caretaker"}`
          : ""
      }${
        cabinetDays != null
          ? ` · ${cabinetDays} ${t("governance_kpi_cabinet_days") || "days"}`
          : ""
      }`
    : "";

  return (
    <section
      aria-label={t("governance_headline_label") || "Governance indicators"}
      className="my-2"
    >
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <IndicatorTile
          icon={Users}
          label={t("governance_kpi_cabinet") || "Cabinet"}
          value={cabinetPmName ?? "—"}
          hint={cabinetHint}
          asOf={cabinet ? asOfChip(t, cabinet.startDate) : ""}
          href="/governments"
        />
        <IndicatorTile
          icon={
            latestInflation && latestInflation.value >= 0
              ? TrendingUp
              : TrendingDown
          }
          label={t("governance_kpi_inflation") || "Inflation (HICP)"}
          value={latestInflation ? `${latestInflation.value.toFixed(1)}%` : "—"}
          hint={inflationPeriod}
          asOf={asOfChip(t, macroAsOf)}
        />
        <IndicatorTile
          icon={Briefcase}
          label={t("governance_kpi_unemployment") || "Unemployment"}
          value={
            latestUnemployment ? `${latestUnemployment.value.toFixed(1)}%` : "—"
          }
          hint={unemploymentPeriod}
          asOf={asOfChip(t, macroAsOf)}
        />
        <IndicatorTile
          icon={Scale}
          label={t("governance_kpi_gov_debt") || "Government debt"}
          value={fmtPctOne(latestGovDebt?.value)}
          hint={
            govDebtPeriod
              ? `${govDebtPeriod} · ${t("governance_kpi_gov_debt_unit") || "% GDP"}`
              : t("governance_kpi_gov_debt_unit") || "% GDP"
          }
          asOf={asOfChip(t, macroAsOf)}
        />
        <IndicatorTile
          icon={Wallet}
          label={t("governance_kpi_budget_execution") || "Budget execution"}
          value={fmtPctOne(executedPct ?? undefined)}
          hint={
            latestFy
              ? `${t("governance_kpi_fy") || "FY"} ${latestFy.fiscalYear}`
              : ""
          }
          asOf={asOfChip(t, latestFy?.asOf)}
          href="/budget"
        />
        <IndicatorTile
          icon={procurementByNs?.totals.totalEur ? ShieldAlert : Landmark}
          label={t("governance_kpi_procurement_value") || "Procurement value"}
          value={fmtCompactEur(procurementEur)}
          hint={
            procurementContracts != null
              ? `${new Intl.NumberFormat("en-GB").format(procurementContracts)} ${
                  t("governance_kpi_procurement_contracts_unit") || "contracts"
                }`
              : ""
          }
          asOf={asOfChip(t, procurementAsOf)}
          href="/procurement"
        />
      </div>
    </section>
  );
};
