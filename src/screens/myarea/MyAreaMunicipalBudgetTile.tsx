// State-budget → община tile for /my-area. Two stacked stories on one card:
//
//   1. Чл.53 трансфери (universal — covers all 265 общини) — per-resident
//      headline + YoY %, fixed-order composition strip (equalization,
//      delegated, capital, otherTargeted, winter), multi-year history. The
//      headline number is the per-капита figure because that's what makes
//      municípios comparable — the absolute total is preserved as the
//      secondary line.
//
//   2. Касово изпълнение (sparse — currently only RSE27 + SZR38 publish a
//      machine-readable B3) — appended as an in-card sub-block ONLY when
//      data is present. No placeholder, no skeleton, no "not available" text
//      on the 263 dashboards that lack it. Coverage is named in a one-liner
//      INSIDE the sub-block so the "2 of 265" contrast is honest where it
//      shows but doesn't nag everywhere.
//
// Auto-hide layers:
//   - Whole tile returns null if the transfers shard has no row for this
//     obshtina (newly-created общини, Sofia районs whose code doesn't match
//     the SOF shard's single Столична row, etc.).
//   - Execution sub-block conditionally renders; nothing structural changes
//     on the 263 muni dashboards without it.
//   - The grid wrapper in MyAreaScreen uses [&>*:only-child]:lg:col-span-2
//     so a paired-null tile lets this one stretch to full width instead of
//     leaving a column gap.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useMunicipalTransfersForOblast,
  useMunicipalExecutionIndex,
  useMunicipalExecution,
} from "@/data/budget/useBudget";
import { useGraoMunicipalitySlice } from "@/data/grao/useGraoPopulation";
import type { MunicipalTransfersOblastShardMuniYear } from "@/data/budget/types";

type Props = {
  obshtina: string;
  oblast?: string;
};

// Derive the 3-letter oblast shard code from an obshtina code, matching the
// helper in MyAreaTaxReceiptTile / MunicipalityTransfersTile. Sofia районs
// (S2xxx) and the Sofia city aliases (SOF, SOFnn) all resolve to the SOF
// shard, which carries Столична by ekatte 68134.
const oblastFromObshtina = (code: string): string | null => {
  if (/^S2\d{3}$/.test(code)) return "SOF";
  if (/^SOF\d*$/.test(code)) return "SOF";
  const m = code.match(/^([A-Z]{3})\d{2}$/);
  return m ? m[1] : null;
};

const isSofiaCapital = (code: string): boolean =>
  /^S2\d{3}$/.test(code) || /^SOF\d*$/.test(code);

// Bulgaria adopted the euro on 2026-01-01 — number-then-€ in BG, €-then-number
// in EN. Match MyAreaTaxReceiptTile / MyAreaProjectsMapTile.
const formatEur = (n: number, lang: "bg" | "en"): string => {
  const num = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
  return lang === "bg" ? `${num} €` : `€${num}`;
};

const compactEur = (n: number, lang: "bg" | "en"): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const fixed = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return lang === "bg" ? `${fixed} млн €` : `€${fixed}M`;
  }
  if (n >= 1_000) {
    return lang === "bg"
      ? `${(n / 1_000).toFixed(0)} хил. €`
      : `€${(n / 1_000).toFixed(0)}k`;
  }
  return formatEur(n, lang);
};

// Fixed ordering — equalization first (the headline egalitarian transfer),
// then the rest in descending share-of-typical-budget order. Stable across
// общини so users comparing two dashboards see categories in the same slots.
type CompositionKey =
  | "equalization"
  | "delegated"
  | "capital"
  | "otherTargeted"
  | "winter";

const COMPOSITION: Array<{
  key: CompositionKey;
  i18nKey: string;
  color: string;
}> = [
  {
    key: "equalization",
    i18nKey: "municipal_transfer_equalization",
    color: "#fb7185",
  },
  {
    key: "delegated",
    i18nKey: "municipal_transfer_delegated",
    color: "#f43f5e",
  },
  { key: "capital", i18nKey: "municipal_transfer_capital", color: "#fdba74" },
  {
    key: "otherTargeted",
    i18nKey: "municipal_transfer_otherTargeted",
    color: "#fcd34d",
  },
  { key: "winter", i18nKey: "municipal_transfer_winter", color: "#fda4af" },
];

const sumPermanent = (
  settlements: Record<string, { permanent: number; current: number }>,
): number =>
  Object.values(settlements).reduce((sum, s) => sum + (s.permanent ?? 0), 0);

export const MyAreaMunicipalBudgetTile: FC<Props> = ({ obshtina, oblast }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const oblastCode = oblast || oblastFromObshtina(obshtina) || undefined;
  const { data: shard } = useMunicipalTransfersForOblast(oblastCode);
  const { data: graoSlice } = useGraoMunicipalitySlice(obshtina);

  const sofiaCapital = isSofiaCapital(obshtina);
  type Point = {
    year: number;
    row: MunicipalTransfersOblastShardMuniYear;
  };
  const seriesByYear: Point[] = useMemo(() => {
    if (!shard) return [];
    return shard.years
      .map((y) => {
        const row = y.municipalities.find((m) =>
          sofiaCapital ? m.ekatte === "68134" : m.obshtinaCode === obshtina,
        );
        return row ? { year: y.fiscalYear, row } : null;
      })
      .filter((x): x is Point => x !== null);
  }, [shard, obshtina, sofiaCapital]);

  // Execution coverage — index is small (~1 KB), so we always fetch it to
  // decide whether to mount the sub-block. The per-(slug, year) file only
  // fetches once we know this município is covered.
  const { data: executionIndex } = useMunicipalExecutionIndex();
  const executionEntry = useMemo(
    () => executionIndex?.municipalities.find((m) => m.obshtina === obshtina),
    [executionIndex, obshtina],
  );
  const executionYear = executionEntry?.latestFullYear ?? undefined;
  const executionSlug = executionEntry?.muniSlug;
  const { data: execution } = useMunicipalExecution(
    executionSlug,
    executionYear,
  );

  if (!shard || seriesByYear.length === 0) return null;

  const latest = seriesByYear[seriesByYear.length - 1];
  const prior =
    seriesByYear.length >= 2 ? seriesByYear[seriesByYear.length - 2] : null;
  const totalEur = latest.row.total?.amountEur ?? 0;
  if (totalEur <= 0) return null;

  const priorEur = prior?.row.total?.amountEur ?? null;
  const yoyDelta =
    priorEur != null && priorEur > 0
      ? ((totalEur - priorEur) / priorEur) * 100
      : null;

  const population = graoSlice ? sumPermanent(graoSlice.settlements) : 0;
  // Sofia районs don't have a single-row match in the SOF shard, so they're
  // already filtered out above. For everything else we expect a population
  // number; if GRAO is still loading, fall back to absolute total + omit
  // per-capita rather than show a half-baked card.
  const perCapita = population > 0 ? totalEur / population : null;

  const maxTotalEur = Math.max(
    ...seriesByYear.map((p) => p.row.total?.amountEur ?? 0),
  );

  const balanceEur =
    execution && execution.revenue?.actual && execution.expense?.actual
      ? execution.revenue.actual.amountEur - execution.expense.actual.amountEur
      : null;

  const coveredCount = executionIndex?.municipalities.length ?? 0;

  // Detail-link target for the sub-block. Canonical município page renders
  // the full per-paragraph execution table; the my-area block is the teaser.
  const detailHref = executionEntry ? `/municipality/${obshtina}` : null;

  return (
    <Card id="myarea-municipal-budget" className="p-4 scroll-mt-24">
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_municipal_budget_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {latest.year}
          {lang === "bg" ? " г." : ""}
        </span>
      </div>

      {/* Headline row — per-capita on the left (the comparable number),
          YoY % on the right (the trend signal). Absolute total drops under
          the per-capita figure as the secondary line. */}
      <div className="flex items-baseline gap-4">
        <div className="flex-1 min-w-0">
          {perCapita != null ? (
            <>
              <div className="text-3xl font-bold tabular-nums">
                {formatEur(perCapita, lang)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("my_area_municipal_budget_per_capita")}
                {" · "}
                {t("my_area_municipal_budget_total", {
                  value: compactEur(totalEur, lang),
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold tabular-nums">
                {compactEur(totalEur, lang)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("my_area_municipal_budget_total_only")}
              </div>
            </>
          )}
        </div>
        {yoyDelta != null && (
          <div className="text-right">
            <div
              className={`text-sm font-semibold tabular-nums ${
                yoyDelta >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {yoyDelta >= 0 ? "+" : ""}
              {yoyDelta.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("my_area_municipal_budget_yoy", { year: prior?.year })}
            </div>
          </div>
        )}
      </div>

      {/* Composition strip — fixed order (equalization first), single
          horizontal stacked bar with absolute + % per category. The colour
          dot prefixing each row matches the bar segment so the legend reads
          like a labelled chart, not a separate key. */}
      <div className="mt-4">
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={t("my_area_municipal_budget_composition_aria")}
        >
          {COMPOSITION.map(({ key, color }) => {
            const eur = latest.row[key]?.amountEur ?? 0;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <div
                key={key}
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            );
          })}
        </div>
        <ul className="mt-2 space-y-0.5">
          {COMPOSITION.map(({ key, i18nKey, color }) => {
            const eur = latest.row[key]?.amountEur ?? 0;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            if (eur <= 0) return null;
            return (
              <li
                key={key}
                className="flex items-center gap-2 text-xs border-b border-dashed border-border/40 py-1 last:border-0"
              >
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0 truncate">{t(i18nKey)}</span>
                <span className="font-semibold tabular-nums shrink-0">
                  {compactEur(eur, lang)}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-12 text-right">
                  {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Multi-year history — compact horizontal bars. 2021 has no Чл.53
          ingest, so it's simply absent from seriesByYear (honest gap, no
          placeholder row). */}
      {seriesByYear.length > 1 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("my_area_municipal_budget_history")}
          </div>
          <div className="space-y-0.5">
            {seriesByYear.map((p) => {
              const eur = p.row.total?.amountEur ?? 0;
              const widthPct = maxTotalEur > 0 ? (eur / maxTotalEur) * 100 : 0;
              return (
                <div
                  key={p.year}
                  className="grid grid-cols-[auto_1fr_auto] items-baseline gap-2 text-[11px]"
                >
                  <span className="tabular-nums text-muted-foreground w-9">
                    {p.year}
                  </span>
                  <div
                    className="h-1 rounded-full bg-rose-300/70"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="tabular-nums font-medium w-16 text-right">
                    {compactEur(eur, lang)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Касово изпълнение sub-block — ONLY mounts when this município
          publishes a machine-readable execution report. Dashboards for the
          263 общини without one render exactly the same up to this point;
          no divider, no placeholder, no layout shift. */}
      {execution && executionYear != null ? (
        <>
          <hr className="my-4 border-dashed" />
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">
              {t("my_area_municipal_budget_execution", { year: executionYear })}
            </h3>
            {detailHref ? (
              <Link
                to={detailHref}
                className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
              >
                {t("my_area_municipal_budget_details")}
                <ArrowRight className="size-3" />
              </Link>
            ) : null}
          </div>
          <ul className="space-y-1 text-xs">
            <ExecutionRow
              label={t("my_area_municipal_budget_revenue")}
              actualEur={execution.revenue?.actual?.amountEur ?? 0}
              planEur={execution.revenue?.plan?.amountEur ?? 0}
              executionPct={execution.revenue?.executionPct ?? null}
              lang={lang}
            />
            <ExecutionRow
              label={t("my_area_municipal_budget_expenditure")}
              actualEur={execution.expense?.actual?.amountEur ?? 0}
              planEur={execution.expense?.plan?.amountEur ?? 0}
              executionPct={execution.expense?.executionPct ?? null}
              lang={lang}
            />
          </ul>
          <div className="mt-2 flex items-baseline justify-between text-[11px] text-muted-foreground gap-3 flex-wrap">
            {balanceEur != null ? (
              <span>
                {balanceEur >= 0
                  ? t("my_area_municipal_budget_surplus")
                  : t("my_area_municipal_budget_deficit")}{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {balanceEur >= 0 ? "+" : "−"}
                  {compactEur(Math.abs(balanceEur), lang)}
                </span>
              </span>
            ) : (
              <span />
            )}
            <span>
              {t("my_area_municipal_budget_coverage", { n: coveredCount })}
            </span>
          </div>
        </>
      ) : null}

      <p className="text-[10px] text-muted-foreground mt-3">
        {t("municipal_transfers_tile_caveat")}
      </p>
    </Card>
  );
};

const ExecutionRow: FC<{
  label: string;
  actualEur: number;
  planEur: number;
  executionPct: number | null;
  lang: "bg" | "en";
}> = ({ label, actualEur, planEur, executionPct, lang }) => {
  // Color the % chip: green within ±10 of plan (good discipline), amber
  // 10-30 off (notable variance), red beyond. Symmetrical because both
  // under- and over-execution are signal.
  const pct = executionPct;
  const off = pct != null ? Math.abs(pct - 100) : null;
  const chipColor =
    off == null
      ? "#9CA3AF"
      : off <= 10
        ? "#56A86F"
        : off <= 30
          ? "#E0A22C"
          : "#D74A56";
  return (
    <li className="flex items-center gap-3 border-b border-dashed border-border/40 py-1 last:border-0">
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="tabular-nums shrink-0 text-muted-foreground">
        {formatEurCompact(actualEur, lang)}
        <span className="text-[10px]">
          {" "}
          / {formatEurCompact(planEur, lang)}
        </span>
      </span>
      {pct != null ? (
        <span
          className="text-xs font-semibold tabular-nums shrink-0 w-12 text-right"
          style={{ color: chipColor }}
        >
          {pct.toFixed(0)}%
        </span>
      ) : (
        <span className="w-12" />
      )}
    </li>
  );
};

// Tighter compact format for the execution sub-block — actual+plan share
// one line so each figure needs to be as short as possible without losing
// the magnitude signal.
const formatEurCompact = (n: number, lang: "bg" | "en"): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const fixed = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return lang === "bg" ? `${fixed} млн €` : `€${fixed}M`;
  }
  if (n >= 1_000) {
    return lang === "bg"
      ? `${(n / 1_000).toFixed(0)} хил. €`
      : `€${(n / 1_000).toFixed(0)}k`;
  }
  const num = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
  return lang === "bg" ? `${num} €` : `€${num}`;
};
