// Drill-down panel for the budget-flow Sankey's "Общини" node. Mounted
// inside the BudgetFlowTile card when the user clicks the Общини leaf;
// answers "where does the €6B+ in municipal transfers go?" two ways:
//
//   1. By transfer type — the five named envelopes set out in Article 53 of
//      the State Budget Law (delegated, equalization, winter, capital, other).
//   2. By oblast — pre-aggregated 28-row rollup the Article 53 per-municipality
//      table sums to. The largest oblast (Sofia-grad / Столична) is its own
//      synthetic code "SOF" since it's a one-municipality oblast.
//
// Falls back to the latest fiscal year with data when the selected year isn't
// ingested (same pattern as BudgetFlowPersonnelDrilldown).
//
// Note: this is the Article 53 envelope (state→municipal transfers — what the
// state budget allocates). The Sankey's "Общини" line is the КФП
// consolidated figure, which also includes municipal own revenue + flows
// outside Article 53. Coverage banner makes the gap explicit.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ChevronDown, X } from "lucide-react";
import { formatEur } from "@/lib/currency";
import {
  useMunicipalTransfersByOblast,
  useMunicipalTransfersIndex,
  useMunicipalTransfersTotals,
} from "@/data/budget/useBudget";
import type { KfpSnapshot, MunicipalTransferType } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

// Visual mapping of transfer-type code → translation key + tile colour. Kept
// here (rather than inside the component) so the colour ramp is stable across
// re-renders and matches the Sankey's spending-side palette.
const TRANSFER_TYPES: Array<{
  code: MunicipalTransferType;
  i18nKey: string;
  colour: string;
}> = [
  {
    code: "delegated",
    i18nKey: "municipal_transfer_delegated",
    colour: "#f43f5e",
  },
  {
    code: "equalization",
    i18nKey: "municipal_transfer_equalization",
    colour: "#fb7185",
  },
  {
    code: "winter",
    i18nKey: "municipal_transfer_winter",
    colour: "#fda4af",
  },
  {
    code: "capital",
    i18nKey: "municipal_transfer_capital",
    colour: "#fdba74",
  },
  {
    code: "otherTargeted",
    i18nKey: "municipal_transfer_otherTargeted",
    colour: "#fcd34d",
  },
];

export const BudgetFlowMunicipalitiesDrilldown: FC<{
  fiscalYear: number;
  snapshot: KfpSnapshot;
  onClose: () => void;
}> = ({ fiscalYear, snapshot, onClose }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data: index } = useMunicipalTransfersIndex();

  // Fall-back year picker — same approach as BudgetFlowPersonnelDrilldown.
  const dataYear = useMemo(() => {
    if (!index) return null;
    const has = (y: number) => index.years.some((row) => row.fiscalYear === y);
    if (has(fiscalYear)) return fiscalYear;
    const sorted = index.years
      .map((row) => row.fiscalYear)
      .sort((a, b) => b - a);
    return sorted[0] ?? null;
  }, [index, fiscalYear]);

  const { data: totals } = useMunicipalTransfersTotals(dataYear ?? undefined);
  const { data: byOblast } = useMunicipalTransfersByOblast(
    dataYear ?? undefined,
  );

  // Sankey "Общини" leaf value — the consolidated КФП figure we're drilling
  // into. Looked up from the snapshot's expenditure section (depth-2 leaf
  // under "Provided transfers" / "Предоставени текущи и капиталови трансфери").
  const sankeyMunicipalitiesEur = useMemo(() => {
    const exp = snapshot.sections.find((s) => s.series === "expenditure");
    const row = exp?.lines.find(
      (l) =>
        l.depth === 2 &&
        (/^общини$/i.test(l.labelBg) ||
          /^municipalities$/i.test(l.labelEn ?? "")),
    );
    return row?.executed?.amountEur ?? row?.planned?.amountEur ?? null;
  }, [snapshot]);

  if (!totals || !byOblast || dataYear == null) return null;

  // Sum of the five envelopes — the Article 53 grand total. Differs from the
  // КФП "Общини" line (which also includes municipal own revenue + transfers
  // outside Article 53), so the coverage banner makes the gap explicit.
  const envelopeEur =
    (totals.totals.delegated?.amountEur ?? 0) +
    (totals.totals.equalization?.amountEur ?? 0) +
    (totals.totals.winter?.amountEur ?? 0) +
    (totals.totals.capital?.amountEur ?? 0) +
    (totals.totals.otherTargeted?.amountEur ?? 0);

  const oblastsSorted = [...byOblast.oblasts].sort(
    (a, b) => b.total.amountEur - a.total.amountEur,
  );
  const maxOblastEur = oblastsSorted[0]?.total.amountEur ?? 0;

  return (
    <div className="rounded-md border bg-muted/30 p-3 my-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="h-4 w-4" />
          {t("municipalities_drilldown_title")}
          <span className="text-xs text-muted-foreground font-normal">
            · {dataYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-muted"
          aria-label={t("municipalities_drilldown_close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Coverage banner — the Article 53 envelope (€4-6B planned transfers)
          covers only part of the КФП "Общини" line (€6-8B executed, which
          also includes municipal own revenue and transfers outside Чл. 53). */}
      {sankeyMunicipalitiesEur != null && (
        <div className="mb-2 text-xs text-muted-foreground">
          {t("municipalities_drilldown_coverage", {
            covered: compactEur(envelopeEur),
            total: compactEur(sankeyMunicipalitiesEur),
            pct:
              sankeyMunicipalitiesEur > 0
                ? ((envelopeEur / sankeyMunicipalitiesEur) * 100).toFixed(1)
                : "0",
          })}
        </div>
      )}

      {/* Transfer-type tiles — the five named envelopes from Чл. 53. */}
      <div className="mb-3">
        <div className="text-xs font-medium mb-1">
          {t("municipalities_by_type")}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {TRANSFER_TYPES.map(({ code, i18nKey, colour }) => {
            const money = totals.totals[code];
            const eur = money?.amountEur ?? 0;
            const pct = envelopeEur > 0 ? (eur / envelopeEur) * 100 : 0;
            return (
              <div
                key={code}
                className="rounded border bg-card p-2 text-xs"
                title={
                  money
                    ? `${money.amount.toLocaleString("bg-BG")} ${money.currency === "BGN" ? "лв." : "EUR"}`
                    : undefined
                }
              >
                <div
                  className="h-1 rounded-full mb-1"
                  style={{ backgroundColor: colour }}
                />
                <div className="text-muted-foreground line-clamp-2">
                  {t(i18nKey)}
                </div>
                <div className="font-medium tabular-nums">
                  {compactEur(eur)}
                </div>
                <div className="text-muted-foreground tabular-nums text-[10px]">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-oblast list — clickable rows route to /municipality/:code. */}
      <div>
        <div className="text-xs font-medium mb-1">
          {t("municipalities_by_oblast")}
        </div>
        <div className="space-y-0.5">
          {oblastsSorted.map((row) => {
            const eur = row.total.amountEur;
            const widthPct = maxOblastEur > 0 ? (eur / maxOblastEur) * 100 : 0;
            const pct = envelopeEur > 0 ? (eur / envelopeEur) * 100 : 0;
            const oblastLabel =
              lang === "bg" ? row.oblastNameBg : row.oblastNameEn;
            // Sofia (capital) is a synthetic oblast code that doesn't route
            // to a region page yet — render as plain row in that case.
            const isRoutable = row.oblastCode !== "SOF";
            const rowInner = (
              <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded px-2 py-1 text-xs hover:bg-muted/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{oblastLabel}</span>
                  <span className="text-muted-foreground tabular-nums text-[10px]">
                    {row.municipalityCount}
                  </span>
                </div>
                <span className="tabular-nums font-medium">
                  {compactEur(eur)}
                </span>
                <span className="tabular-nums text-muted-foreground w-12 text-right">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </span>
                <div
                  className="col-span-3 h-0.5 rounded-full bg-rose-200/60"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            );
            return isRoutable ? (
              <Link
                key={row.oblastCode}
                to={`/municipality/${row.oblastCode}`}
                className="block"
              >
                {rowInner}
              </Link>
            ) : (
              <div key={row.oblastCode}>{rowInner}</div>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("municipalities_drilldown_caveat")}
      </p>
    </div>
  );
};

// Trigger button — appears below the Sankey card header so users can open the
// drill-down without clicking inside the Sankey itself (which is also wired).
export const BudgetFlowMunicipalitiesTrigger: FC<{
  open: boolean;
  onClick: () => void;
}> = ({ open, onClick }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-muted/50"
    >
      <Building2 className="h-3 w-3" />
      {t("municipalities_flow_trigger")}
      <ChevronDown
        className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
};
