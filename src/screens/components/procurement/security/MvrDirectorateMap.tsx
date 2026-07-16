// The /sector/security (Полиция / МВР) signature map: one marker per CITY where МВР
// budget units are seated (the 28 областни центрове + София's central bodies),
// coloured by each structure's ЗОП spend (or single-bid share) and badged with its
// contract count. София hosts the ministry + main directorates + СДВР/СДПБЗН → a
// paginating popup; every oblast capital hosts its ОДМВР + РДПБЗН.
//
// The map itself is the shared SectorPointMap (reused from /judiciary's court-load
// map); this component owns the metric toggle, universe filter, colour banding,
// legend and caption. Data comes from ONE /api/db/mvr-directorate-map call with the
// contracts corpus folded per structure server-side — no browser geocoding.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { formatEurCompact } from "@/lib/currency";
import {
  SectorPointMap,
  type SectorMapPoint,
} from "@/screens/components/maps/SectorPointMap";
import {
  MVR_EIK,
  SECURITY_ALIAS_EIKS,
  SECURITY_UNIVERSES,
  securityUniverseLabel,
  type SecurityUniverse,
} from "@/lib/securityReferenceData";
import {
  useMvrDirectorateMap,
  type MvrDirectoratePoint,
  type ScopeWindow,
} from "@/data/procurement/useMvrDirectorateMap";

type Metric = "spend" | "singleBid";

const METRICS: { id: Metric; bg: string; en: string }[] = [
  { id: "spend", bg: "Разход", en: "Spend" },
  { id: "singleBid", bg: "С една оферта", en: "Single bid" },
];

interface Band {
  max: number;
  color: string;
  label: string;
}

// Spend — a single-hue police-slate sequential ramp (light → dark = low → high €),
// per the dataviz method (sequential, not rainbow, not red-green). Thresholds in €.
const SPEND_BANDS: Band[] = [
  { max: 1_000_000, color: "#cbd5e8", label: "≤ €1M" },
  { max: 5_000_000, color: "#9fb0cf", label: "1–5" },
  { max: 20_000_000, color: "#6f83ab", label: "5–20" },
  { max: 80_000_000, color: "#4a5c85", label: "20–80" },
  { max: Infinity, color: "#2b3a5e", label: "> €80M" },
];

// Single-bid share — a risk ramp (competitive → single-bidder). Paired with the
// number on every card so colour is never the only signal.
const BID_BANDS: Band[] = [
  { max: 0.1, color: "#15803d", label: "≤ 10%" }, // green-700
  { max: 0.3, color: "#65a30d", label: "10–30%" }, // lime-600
  { max: 0.5, color: "#d97706", label: "30–50%" }, // amber-600
  { max: 0.7, color: "#ea580c", label: "50–70%" }, // orange-600
  { max: Infinity, color: "#b91c1c", label: "> 70%" }, // red-700
];
// No-data (no bid count known) — a neutral grey, ranked last.
const NO_DATA = "#94a3b8";

const bandColor = (bands: Band[], v: number) =>
  (bands.find((b) => v <= b.max) ?? bands[bands.length - 1]).color;

export const MvrDirectorateMap: FC<{
  /** The awarder the pack is mounted on. On the ministry (000695235) the whole
   *  74-unit group is mapped; any other EIK maps just itself. */
  eik?: string;
  scopeWindow?: ScopeWindow;
  periodLabel?: string | null;
}> = ({ eik = MVR_EIK, scopeWindow, periodLabel }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const groupEiks = useMemo(
    () => (eik === MVR_EIK ? [MVR_EIK, ...SECURITY_ALIAS_EIKS] : [eik]),
    [eik],
  );
  const { directorates, isLoading } = useMvrDirectorateMap(
    groupEiks,
    scopeWindow,
  );

  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const fmtPct = useCallback(
    (v: number) =>
      `${(v * 100).toLocaleString(bg ? "bg-BG" : "en-US", {
        maximumFractionDigits: 0,
      })}%`,
    [bg],
  );

  // Which universes are actually present, in display order (so the filter chips
  // only show tiers that exist in the current scope).
  const presentUniverses = useMemo(() => {
    const set = new Set(directorates.map((d) => d.universe).filter(Boolean));
    return SECURITY_UNIVERSES.filter((u) => set.has(u));
  }, [directorates]);

  const points = useMemo<SectorMapPoint[]>(() => {
    return directorates
      .filter((d) => !d.universe || !hidden.has(d.universe))
      .map((d: MvrDirectoratePoint) => {
        const share = d.bidKnownN > 0 ? d.singleBidN / d.bidKnownN : null;
        // `value` ranks units within a city (busiest first → marker colour) and, for
        // single-bid, pushes the no-data units to the back with a neutral grey.
        const value =
          metric === "spend" ? d.totalEur : share == null ? -1 : share;
        const color =
          metric === "spend"
            ? bandColor(SPEND_BANDS, d.totalEur)
            : share == null
              ? NO_DATA
              : bandColor(BID_BANDS, share);
        return {
          id: d.eik,
          loc: d.loc,
          value,
          color,
          badge: d.contractCount,
          title: d.name,
          subtitle: [
            d.universe
              ? securityUniverseLabel(d.universe, i18n.language)
              : null,
            d.settlement,
          ]
            .filter(Boolean)
            .join(" · "),
          detail: (
            <>
              <span className="font-semibold tabular-nums">
                {formatEurCompact(d.totalEur, i18n.language)}
              </span>{" "}
              <span className="opacity-70">
                {bg ? "· договори" : "· contracts"}{" "}
                <span className="tabular-nums">{d.contractCount}</span>
              </span>
              {share != null && (
                <div className="opacity-70">
                  {bg ? "С една оферта: " : "Single bid: "}
                  <span className="font-medium tabular-nums">
                    {fmtPct(share)}
                  </span>{" "}
                  <span className="opacity-70">
                    ({d.singleBidN}/{d.bidKnownN})
                  </span>
                </div>
              )}
            </>
          ),
          href: `/awarder/${d.eik}`,
        };
      });
  }, [directorates, hidden, metric, bg, fmtPct, i18n.language]);

  if (isLoading)
    return (
      <div className="h-[420px] animate-pulse rounded-xl border bg-card" />
    );
  if (!directorates.length) return null;

  const toggleUniverse = (u: SecurityUniverse) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });

  const bands = metric === "spend" ? SPEND_BANDS : BID_BANDS;

  return (
    <Card data-og="mvr-directorate-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg ? "Структури на МВР по град" : "МВР structures, city by city"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Metric selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {bg ? "Оцветяване по" : "Colour by"}
          </span>
          <div className="inline-flex rounded-lg border p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetric(m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metric === m.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {bg ? m.bg : m.en}
              </button>
            ))}
          </div>
        </div>

        {/* Universe toggles */}
        {presentUniverses.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {presentUniverses.map((u) => {
              const on = !hidden.has(u);
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => toggleUniverse(u)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground/60 line-through",
                  )}
                >
                  {securityUniverseLabel(u, i18n.language)}
                </button>
              );
            })}
          </div>
        )}

        <SectorPointMap
          points={points}
          groupNoun={bg ? "структури" : "structures"}
          badgeNoun={bg ? "договори" : "contracts"}
          openLabel={bg ? "Виж структурата" : "Open structure"}
        />

        {/* Legend + caption */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {metric === "spend"
              ? bg
                ? "Разход (ЗОП):"
                : "Spend (public procurement):"
              : bg
                ? "Дял с една оферта:"
                : "Single-bid share:"}
          </span>
          {bands.map((b) => (
            <span key={b.label} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: b.color }}
              />
              {b.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Картата отразява избрания времеви обхват${periodLabel ? ` (${periodLabel})` : ""}: показани са само структурите с договори в тях — разширете обхвата горе за повече. Всеки маркер е един град; числото е броят договори там, а цветът — ${
                metric === "spend"
                  ? "договорената стойност на най-голямата структура"
                  : "делът поръчки с една оферта на най-рисковата структура"
              }. Класифицираните доставки за сигурност не са в регистъра.`
            : `The map reflects the selected time scope${periodLabel ? ` (${periodLabel})` : ""}: only structures with contracts in it are shown — widen the scope above for more. Each marker is one city; the number is its contract count and the colour is the ${
                metric === "spend"
                  ? "contracted value of the biggest structure"
                  : "single-bid share of the highest-risk structure"
              } there. Classified security buys are not in the register.`}
        </p>
      </CardContent>
    </Card>
  );
};
