// Multi-indicator snapshot table above peer-aware sections on /indicators.
//
// Replaces stacked PeerSnapshotStrip rows when several indicators share a
// peer-comparison column set (Economy: GDP growth + inflation + unemployment;
// Fiscal: govDebt + budgetBalance + currentAccount). Uses CSS Grid so all
// numeric columns line up vertically, which the flex-based strip cannot
// guarantee when values have different decimal widths.
//
// Layout:
//
//   Indicator       Period       BG    EU    RO    GR    HU    HR    Position
//   GDP growth      Q1 2026      2.9%  1.0%  -1.5% 2.4%  1.7%  3.6%  4/21
//   Inflation       Q1 2026      2.4%  2.3%  8.6%  3.1%  2.0%  4.0%  14/27
//   Unemployment    Q4 2025      3.2%  5.9%  6.3%  8.3%  4.4%  5.0%  2/27

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  usePeerIndicator,
  type PeerGeo,
  type PeerQuarterlyPoint,
} from "@/data/macro/useMacroPeers";
import {
  useMacro,
  type MacroIndicatorKey,
  type MacroIndicatorMeta,
} from "@/data/macro/useMacro";
import { cn } from "@/lib/utils";

const STRIP_ORDER: PeerGeo[] = ["BG", "EU27_2020", "RO", "GR", "HU", "HR"];

const GEO_LABEL_EN: Record<PeerGeo, string> = {
  BG: "BG",
  EU27_2020: "EU",
  RO: "RO",
  GR: "GR",
  HU: "HU",
  HR: "HR",
};

const GEO_LABEL_BG: Record<PeerGeo, string> = {
  BG: "БГ",
  EU27_2020: "ЕС",
  RO: "РО",
  GR: "ГР",
  HU: "УН",
  HR: "ХР",
};

// Same snapshot-picking logic as PeerSnapshotStrip — find the latest BG
// period and read each peer's matching (or nearest-prior, ≤4 quarters)
// point. Returns null when BG itself has no data.
const pickLatestSnapshot = (
  series: Partial<Record<PeerGeo, PeerQuarterlyPoint[]>>,
): {
  period: string;
  values: Partial<Record<PeerGeo, { value: number; periodLag: number }>>;
} | null => {
  const bg = series.BG ?? [];
  if (bg.length === 0) return null;
  const bgLatest = bg[bg.length - 1];
  const result: Partial<Record<PeerGeo, { value: number; periodLag: number }>> =
    {};
  for (const geo of STRIP_ORDER) {
    const arr = series[geo] ?? [];
    if (arr.length === 0) continue;
    let bestIdx = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (
        p.year < bgLatest.year ||
        (p.year === bgLatest.year && p.quarter <= bgLatest.quarter)
      ) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx < 0) continue;
    const point = arr[bestIdx];
    const lag =
      (bgLatest.year - point.year) * 4 + (bgLatest.quarter - point.quarter);
    if (lag > 4) continue;
    result[geo] = { value: point.value, periodLag: lag };
  }
  return { period: bgLatest.period, values: result };
};

export type PeerSnapshotTableRow = {
  /** Key into macro_peers.json `indicators` and macro.json `indicators`. */
  indicatorKey: string;
  /** Per-row formatter override (e.g., the budget balance row may want a
      signed format). Falls back to the table's `formatValue`, then to
      one-decimal percent. */
  format?: (value: number) => string;
};

const PeerRow: FC<{
  row: PeerSnapshotTableRow;
  defaultFormat: (value: number) => string;
  lang: "bg" | "en";
}> = ({ row, defaultFormat, lang }) => {
  const block = usePeerIndicator(row.indicatorKey);
  const { data: macro } = useMacro();
  const fmt = row.format ?? defaultFormat;
  if (!block) return null;
  const snapshot = pickLatestSnapshot(block.series);
  if (!snapshot) return null;

  // The peer indicator key set is a superset of MacroIndicatorKey at the
  // type level (we accept arbitrary strings so the table can be reused with
  // future indicators) — narrow with an explicit lookup that returns
  // undefined for keys macro.json doesn't know about.
  const meta: MacroIndicatorMeta | undefined =
    macro?.indicators[row.indicatorKey as MacroIndicatorKey];
  const title = meta
    ? lang === "bg"
      ? meta.titleBg
      : meta.titleEn
    : row.indicatorKey;

  const periodLabel = (() => {
    const m = /^(\d{4})-Q([1-4])$/.exec(snapshot.period);
    if (!m) return snapshot.period;
    return lang === "bg" ? `${m[2]} тр. ${m[1]}` : `${m[1]} Q${m[2]}`;
  })();

  const dist = block.latestDistribution;
  const distAligned = dist != null && dist.period === snapshot.period;

  // Color values vs EU27 average using the indicator's direction metadata.
  // `lower` better: inflation, unemployment, debt → BG/peer < EU is good.
  // `higher` better: GDP growth, balance → BG/peer > EU is good.
  // `none`: current account, house prices → no coloring (ambiguous direction).
  const euValue = snapshot.values.EU27_2020?.value;
  const direction = block.direction;
  const colorClassFor = (geo: PeerGeo, v: number): string => {
    if (geo === "EU27_2020") return ""; // EU itself stays neutral (it's the reference)
    if (direction === "none" || euValue == null) return "";
    const epsilon = 0.05; // ignore visually-identical values within 0.05pp
    const diff = v - euValue;
    if (Math.abs(diff) < epsilon) return "";
    const isBetter = direction === "lower" ? diff < 0 : diff > 0;
    return isBetter
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";
  };

  return (
    <>
      <div className="text-foreground font-medium truncate" title={title}>
        {title}
      </div>
      <div className="text-muted-foreground/80 tabular-nums">{periodLabel}</div>
      {STRIP_ORDER.map((geo) => {
        const v = snapshot.values[geo];
        const isBg = geo === "BG";
        const color = v ? colorClassFor(geo, v.value) : "";
        return (
          <div
            key={geo}
            className={cn(
              "tabular-nums text-right",
              isBg ? "font-semibold" : "",
              color
                ? color
                : isBg
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
            title={
              v && v.periodLag > 0
                ? lang === "bg"
                  ? `данни от ${v.periodLag} тр. по-рано`
                  : `${v.periodLag} quarters earlier`
                : undefined
            }
          >
            {v ? fmt(v.value) : "—"}
          </div>
        );
      })}
      <div className="text-right">
        {distAligned && dist ? (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted/40 text-foreground tabular-nums"
            title={
              lang === "bg"
                ? dist.direction === "lower"
                  ? "позиция 1 = най-ниската стойност (по-ниско е по-добре)"
                  : "позиция 1 = най-високата стойност (по-високо е по-добре)"
                : dist.direction === "lower"
                  ? "rank 1 = lowest value (lower is better)"
                  : "rank 1 = highest value (higher is better)"
            }
          >
            <span className="font-semibold">
              {dist.rank}/{dist.total}
            </span>
          </span>
        ) : null}
      </div>
    </>
  );
};

export const PeerSnapshotTable: FC<{
  rows: PeerSnapshotTableRow[];
  /** Default per-cell formatter. Defaults to one-decimal percent. */
  formatValue?: (value: number) => string;
  className?: string;
}> = ({ rows, formatValue, className }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const defaultFormat = formatValue ?? ((v: number) => `${v.toFixed(1)}%`);
  const geoLabel = lang === "bg" ? GEO_LABEL_BG : GEO_LABEL_EN;

  return (
    <div
      className={cn(
        // 9 columns: title | period | BG | EU | RO | GR | HU | HR | position
        // First two columns are auto-sized (longest title + period wins),
        // then 6 equal-width numeric columns, then the position pill.
        "grid gap-x-3 gap-y-0.5 text-[11px] mb-3 items-baseline",
        className,
      )}
      style={{
        gridTemplateColumns:
          "minmax(0, max-content) minmax(0, max-content) repeat(6, minmax(48px, 1fr)) minmax(0, max-content)",
      }}
    >
      {/* Header row */}
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70" />
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70" />
      {STRIP_ORDER.map((geo) => (
        <div
          key={`h-${geo}`}
          className={cn(
            "text-[10px] uppercase tracking-wide text-right",
            geo === "BG"
              ? "text-foreground/70 font-semibold"
              : "text-muted-foreground/70",
          )}
        >
          {geoLabel[geo]}
        </div>
      ))}
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 text-right">
        {lang === "bg" ? "позиция" : "rank"}
      </div>

      {rows.map((row) => (
        <PeerRow
          key={row.indicatorKey}
          row={row}
          defaultFormat={defaultFormat}
          lang={lang}
        />
      ))}
    </div>
  );
};
