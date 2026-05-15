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
  TrendingDown,
  TrendingUp,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import { LucideIcon } from "lucide-react";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import { useMps } from "@/data/parliament/useMps";
import { useBudgetIndex } from "@/data/budget/useBudget";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import { useMacro, MacroPoint } from "@/data/macro/useMacro";
import { useElectionContext } from "@/data/ElectionContext";
import { useParliamentTerm } from "@/data/parliament/useParliamentTerm";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
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

// "Is this ISO date at or before the end of the term?" check. termEnd is
// exclusive (the day of the next election opens the next term) and null for
// the still-open current term. We deliberately drop the lower bound — the
// "as of" chip tells the user what period the figure refers to, and for the
// current term recent macro/budget data may not yet exist inside the window.
const isInTerm = (
  iso: string,
  _termStart: Date | null,
  termEnd: Date | null,
): boolean => {
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return false;
  if (termEnd && d >= termEnd) return false;
  return true;
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

export const HeadlineIndicatorStrip: FC = () => {
  const { t } = useTranslation();
  const { sessions } = useRollcallIndex();
  const { mps, currentNs } = useMps();
  const { data: budgetIndex } = useBudgetIndex();
  const { data: procurementByNs } = useProcurementByNs();
  const { data: macro } = useMacro();
  const { selected } = useElectionContext();
  const { termStart, termEnd } = useParliamentTerm();

  // Roll-call: latest session whose date falls inside the selected term.
  const latestSession =
    sessions && sessions.length > 0
      ? ([...sessions]
          .filter((s) => isInTerm(s.date, termStart, termEnd))
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null)
      : null;

  // Active MPs in the selected term's parliament. `currentNs` from useMps is
  // the long display label ("52-ро Народно събрание") — for filtering we need
  // the short folder form ("52") which electionToNsFolder() provides.
  const selectedFolder = electionToNsFolder(selected);
  const currentMpCount =
    mps && selectedFolder
      ? mps.filter((m) => m.nsFolders.includes(selectedFolder)).length
      : (mps?.length ?? null);

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

  // Procurement: per-NS slice pre-aggregates contract counts inside the
  // term's procurement window. The slice's `end` (or today, for the open
  // term) makes a more honest "as of" than the global lastIngest.
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
  const macroAsOf = macro?.fetchedAt ?? null;
  const inflationPeriod = latestInflation
    ? (latestInflation.period ?? `${latestInflation.year}`)
    : "";
  const unemploymentPeriod = latestUnemployment
    ? (latestUnemployment.period ?? `${latestUnemployment.year}`)
    : "";

  return (
    <section
      aria-label={t("governance_headline_label") || "Governance indicators"}
      className="my-2"
    >
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <IndicatorTile
          icon={Vote}
          label={t("governance_kpi_last_session") || "Last roll-call"}
          value={latestSession ? fmtIsoDate(latestSession.date) || "—" : "—"}
          asOf={
            latestSession
              ? `${latestSession.items ?? ""} ${t("governance_kpi_last_session_unit") || "items"}`.trim()
              : ""
          }
          href="/votes"
        />
        <IndicatorTile
          icon={Users}
          label={t("governance_kpi_active_mps") || "Active MPs"}
          value={
            currentMpCount != null && currentMpCount > 0
              ? currentMpCount.toString()
              : "—"
          }
          asOf={currentNs ?? ""}
          href="/parliament"
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
          icon={Landmark}
          label={t("governance_kpi_procurement") || "Procurement contracts"}
          value={
            procurementContracts != null
              ? new Intl.NumberFormat("en-GB").format(procurementContracts)
              : "—"
          }
          asOf={asOfChip(t, procurementAsOf)}
          href="/procurement"
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
      </div>
    </section>
  );
};
