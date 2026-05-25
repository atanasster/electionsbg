// Drill-down panel for the budget-flow Sankey's "Персонал" node. Shown
// inside the BudgetFlowTile card when the user clicks the Персонал node;
// answers the obvious follow-up "where do those €1.6B go?" with a
// ministry-by-ministry table.
//
// Pulls from data/budget/personnel.json (same source as the standalone
// BudgetPersonnelTile). When no per-ministry data is available for the
// matching fiscal year, falls back to the latest year that has data — same
// behavior as the main personnel tile.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, Users, X } from "lucide-react";
import { formatEur } from "@/lib/currency";
import { usePersonnel } from "@/data/budget/useBudget";
import type {
  KfpSnapshot,
  MinistryHeadcountSummary,
} from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const compactN = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString("en-US");
};

interface MinistryRow {
  adminId: string;
  name: string;
  headcount: number;
  personnelEur: number;
  avgEur: number | null;
}

export const BudgetFlowPersonnelDrilldown: FC<{
  fiscalYear: number;
  snapshot: KfpSnapshot;
  onClose: () => void;
}> = ({ fiscalYear, snapshot, onClose }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = usePersonnel();

  // The Sankey's "Персонал" node value — what we're drilling into. Looked
  // up from the snapshot's expenditure section.
  const sankeyPersonnelEur = useMemo(() => {
    const exp = snapshot.sections.find((s) => s.series === "expenditure");
    const row = exp?.lines.find((l) => /^Персонал$/i.test(l.labelBg));
    return row?.executed?.amountEur ?? null;
  }, [snapshot]);

  const ministryYear = useMemo(() => {
    if (!data) return null;
    if ((data.byMinistry[String(fiscalYear)] ?? []).length > 0)
      return fiscalYear;
    const yearsWithData = Object.keys(data.byMinistry)
      .map(Number)
      .filter((y) => (data.byMinistry[String(y)] ?? []).length > 0)
      .sort((a, b) => b - a);
    return yearsWithData[0] ?? null;
  }, [data, fiscalYear]);

  const rows: MinistryRow[] = useMemo(() => {
    if (!data || ministryYear == null) return [];
    const summaries = data.byMinistry[String(ministryYear)] ?? [];
    return (summaries as MinistryHeadcountSummary[])
      .map((m) => ({
        adminId: m.adminId,
        name: lang === "bg" ? m.nameBg : m.nameEn,
        headcount: m.totalHeadcount.executed ?? 0,
        personnelEur: m.totalPersonnel.executed?.amountEur ?? 0,
        avgEur: m.avgAnnualCostPerFte?.amountEur ?? null,
      }))
      .filter((m) => m.personnelEur > 0)
      .sort((a, b) => b.personnelEur - a.personnelEur);
  }, [data, ministryYear, lang]);

  if (!data || rows.length === 0) return null;

  const coveredEur = rows.reduce((s, r) => s + r.personnelEur, 0);
  // Percent denominator: prefer the Sankey's authoritative Персонал total
  // (КФП consolidated) so the user can see how much of the bar we cover.
  // Fall back to the sum of covered ministries when КФП lacks the line.
  const totalEur = sankeyPersonnelEur ?? coveredEur;
  const coveragePct = totalEur > 0 ? (coveredEur / totalEur) * 100 : 0;

  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4" />
          {lang === "bg" ? "Персонал → министерства" : "Personnel → ministries"}
          <span className="text-xs text-muted-foreground font-normal">
            · {ministryYear} г.
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={lang === "bg" ? "Затвори" : "Close"}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Coverage banner — only a handful of ministries publish staffing
          data, so be explicit about how much of the КФП "Персонал" line we
          actually cover. The remainder sits in МО (classified), МВР / МФ
          (WAF-blocked), and other ministries not yet wired in. */}
      {sankeyPersonnelEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {lang === "bg"
            ? `Покритие: ${compactEur(coveredEur)} от ${compactEur(totalEur)} (${coveragePct.toFixed(1)}%) от линията „Персонал" в КФП. Останалата част — МО (класифицирано), МВР, МФ и министерства, които още не са ингестирани.`
            : `Coverage: ${compactEur(coveredEur)} of ${compactEur(totalEur)} (${coveragePct.toFixed(1)}%) of the КФП Personnel line. Remainder = MOD (classified), MoI, MoF, and ministries not yet ingested.`}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((r) => {
          const pct = totalEur > 0 ? (r.personnelEur / totalEur) * 100 : 0;
          return (
            <Link
              key={r.adminId}
              to={`/budget/ministry/${r.adminId}`}
              className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-xs hover:bg-muted/50"
            >
              <span className="truncate">{r.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {compactN(r.headcount)}
              </span>
              <span className="tabular-nums font-medium">
                {compactEur(r.personnelEur)}
              </span>
              <span className="tabular-nums text-muted-foreground w-12 text-right">
                {pct >= 1 ? `${pct.toFixed(1)}%` : ""}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lang === "bg"
          ? "Само министерства, които публикуват „Численост на щатния персонал“ в програмния отчет. МО не публикува (класифицирано)."
          : "Only ministries that publish staffing data in their program-budget execution report. MOD does not (classified)."}
      </p>
    </div>
  );
};

// Trigger button — appears below the Sankey card header when the snapshot
// has a Персонал line. Lets users open the drill-down without clicking
// inside the Sankey itself (which is also wired).
export const BudgetFlowPersonnelTrigger: FC<{
  open: boolean;
  onClick: () => void;
}> = ({ open, onClick }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-muted/50"
    >
      <Users className="h-3 w-3" />
      {lang === "bg"
        ? "Разпредели „Персонал“ по министерства"
        : "Drill into Personnel by ministry"}
      <ChevronDown
        className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
};
