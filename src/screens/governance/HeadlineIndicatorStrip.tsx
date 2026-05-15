// Opening band of the Governance dashboard. Each tile is independently
// timestamped — Eurostat-style — so users see "as of YYYY-MM-DD" per metric
// rather than a misleading global cycle picker. Governance data runs on
// multiple cadences (roll-call sessions, fiscal years, monthly procurement
// ingest, quarterly Eurostat) and a single time selector would lie about
// any tile that doesn't match it.

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
import { useProcurementIndex } from "@/data/procurement/useProcurementIndex";
import { useMacro } from "@/data/macro/useMacro";
import { useElectionContext } from "@/data/ElectionContext";
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

export const HeadlineIndicatorStrip: FC = () => {
  const { t } = useTranslation();
  const { sessions } = useRollcallIndex();
  const { mps, currentNs } = useMps();
  const { data: budgetIndex } = useBudgetIndex();
  const { data: procurementIndex } = useProcurementIndex();
  const { data: macro } = useMacro();
  const { selected } = useElectionContext();

  // Roll-call: pick the newest session by date (sessions are listed newest-
  // first by convention but we sort defensively).
  const latestSession =
    sessions && sessions.length > 0
      ? [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
      : null;

  // Active MPs in the selected term's parliament. `currentNs` from useMps is
  // the long display label ("52-ро Народно събрание") — for filtering we need
  // the short folder form ("52") which electionToNsFolder() provides.
  const selectedFolder = electionToNsFolder(selected);
  const currentMpCount =
    mps && selectedFolder
      ? mps.filter((m) => m.nsFolders.includes(selectedFolder)).length
      : (mps?.length ?? null);

  // Budget: most recent fiscal-year summary with both planned and actual
  // expenditure (the in-progress FY can have actuals but no `planned` yet, so
  // skip it — otherwise the percentage is meaningless and the tile reads "—").
  const latestFy =
    budgetIndex?.fiscalYears && budgetIndex.fiscalYears.length > 0
      ? ([...budgetIndex.fiscalYears]
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

  // Macro tail values.
  const inflationSeries = macro?.series.inflation ?? [];
  const latestInflation = inflationSeries.length
    ? inflationSeries[inflationSeries.length - 1]
    : null;
  const unemploymentSeries = macro?.series.unemployment ?? [];
  const latestUnemployment = unemploymentSeries.length
    ? unemploymentSeries[unemploymentSeries.length - 1]
    : null;
  const macroAsOf = macro?.fetchedAt ?? null;
  const inflationPeriod = latestInflation?.period ?? `${latestInflation?.year}`;
  const unemploymentPeriod =
    latestUnemployment?.period ?? `${latestUnemployment?.year}`;

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
            procurementIndex?.totals.contracts != null
              ? new Intl.NumberFormat("en-GB").format(
                  procurementIndex.totals.contracts,
                )
              : "—"
          }
          asOf={asOfChip(t, procurementIndex?.lastIngest)}
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
