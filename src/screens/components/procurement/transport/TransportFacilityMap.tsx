// The /sector/transport facility map: one marker per city where МТС-group
// entities are based, coloured by ЗОП spend (or single-bid share) and badged
// with contract count, each linking to /awarder/:eik. Rebuilt per gaps plan §5
// (the 2026-07-16 original was never committed).
//
// The map itself is the shared SectorPointMap; this component owns the metric
// toggle, universe filter, colour banding, legend and caption. Data comes from
// ONE /api/db/transport-facility-map call with the contracts corpus folded per
// entity server-side — no browser geocoding.
//
// HONEST-CAPTION RULE (T5.6): most entities are Sofia-REGISTERED and the two
// Варна pins are physical-facility overrides (Морска администрация,
// Пристанищна инфраструктура), while ИАППД is genuinely seated in Русе. The
// counts and the city list in the caption are DERIVED from the payload rather
// than restated — the old copy hardcoded "all 11 … registered in Sofia" and the
// 2026-08-13 sector audit falsified both halves at once (15 entities, and a
// third city). Networks (rail, roads) have no single point and
// АПИ roads are a separate sector — the caption says so, because without it
// the map reads as "state transport happens in two places".

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
  TRANSPORT_EIK,
  TRANSPORT_ALIAS_EIKS,
  TRANSPORT_UNIVERSES,
  transportUniverseLabel,
  type TransportUniverse,
} from "@/lib/transportReferenceData";
import {
  useTransportFacilityMap,
  type TransportFacilityPoint,
  type ScopeWindow,
} from "@/data/procurement/useTransportFacilityMap";

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

// Spend — a single-hue sequential ramp (light → dark = low → high €). The МТС
// group spans €k (ДАБДП) to €bn (НКЖИ), so the thresholds are log-ish.
const SPEND_BANDS: Band[] = [
  { max: 5_000_000, color: "#cbd5e8", label: "≤ €5M" },
  { max: 50_000_000, color: "#9fb0cf", label: "5–50" },
  { max: 300_000_000, color: "#6f83ab", label: "50–300" },
  { max: 1_500_000_000, color: "#4a5c85", label: "300M–1.5B" },
  { max: Infinity, color: "#2b3a5e", label: "> €1.5B" },
];

// Single-bid share — a risk ramp; paired with the number on every card so
// colour is never the only signal.
const BID_BANDS: Band[] = [
  { max: 0.1, color: "#15803d", label: "≤ 10%" },
  { max: 0.3, color: "#65a30d", label: "10–30%" },
  { max: 0.5, color: "#d97706", label: "30–50%" },
  { max: 0.7, color: "#ea580c", label: "50–70%" },
  { max: Infinity, color: "#b91c1c", label: "> 70%" },
];
const NO_DATA = "#94a3b8";

const bandColor = (bands: Band[], v: number) =>
  (bands.find((b) => v <= b.max) ?? bands[bands.length - 1]).color;

export const TransportFacilityMap: FC<{
  /** The awarder the pack is mounted on. On the ministry the whole curated
   *  group (TRANSPORT_ENTITIES) is mapped; any other EIK maps just itself. */
  eik?: string;
  scopeWindow?: ScopeWindow;
  periodLabel?: string | null;
}> = ({ eik = TRANSPORT_EIK, scopeWindow, periodLabel }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const groupEiks = useMemo(
    () =>
      eik === TRANSPORT_EIK ? [TRANSPORT_EIK, ...TRANSPORT_ALIAS_EIKS] : [eik],
    [eik],
  );
  const { facilities, isLoading } = useTransportFacilityMap(
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

  const presentUniverses = useMemo(() => {
    const set = new Set(facilities.map((d) => d.universe).filter(Boolean));
    return TRANSPORT_UNIVERSES.filter((u) => set.has(u));
  }, [facilities]);

  // The caption's geography is DERIVED, never restated. It used to hardcode "all 11
  // entities are Sofia-REGISTERED", which the 2026-08-13 audit falsified twice at once:
  // the group grew to 15, and ИАППД's seat is Русе, so the map gained a third city
  // while the caption still explained a two-city one. Counting here means adding a
  // member can never leave the sentence untrue.
  const seats = useMemo(() => {
    const byCity = new Map<string, number>();
    for (const f of facilities)
      if (f.settlement)
        byCity.set(f.settlement, (byCity.get(f.settlement) ?? 0) + 1);
    const sofia = byCity.get("София") ?? 0;
    byCity.delete("София");
    return {
      total: facilities.length,
      sofia,
      outside: [...byCity.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "bg"),
      ),
    };
  }, [facilities]);

  const points = useMemo<SectorMapPoint[]>(() => {
    return facilities
      .filter((d) => !d.universe || !hidden.has(d.universe))
      .map((d: TransportFacilityPoint) => {
        const share = d.bidKnownN > 0 ? d.singleBidN / d.bidKnownN : null;
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
              ? transportUniverseLabel(d.universe, i18n.language)
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
  }, [facilities, hidden, metric, bg, fmtPct, i18n.language]);

  if (isLoading)
    return (
      <div className="h-[420px] animate-pulse rounded-xl border bg-card" />
    );
  if (!facilities.length) return null;

  const toggleUniverse = (u: TransportUniverse) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });

  const bands = metric === "spend" ? SPEND_BANDS : BID_BANDS;

  return (
    <Card data-og="transport-facility-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg
            ? "Транспортни структури по град"
            : "Transport entities, city by city"}
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
                  {transportUniverseLabel(u, i18n.language)}
                </button>
              );
            })}
          </div>
        )}

        <SectorPointMap
          points={points}
          groupNoun={bg ? "структури" : "entities"}
          badgeNoun={bg ? "договори" : "contracts"}
          openLabel={bg ? "Виж структурата" : "Open entity"}
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
            ? `Картата отразява избрания времеви обхват${periodLabel ? ` (${periodLabel})` : ""}. ${seats.sofia} от ${seats.total} структури са РЕГИСТРИРАНИ в София${seats.outside.length ? `; останалите са в ${seats.outside.map(([c, n]) => (n > 1 ? `${c} (${n})` : c)).join(", ")}` : ""}. Двата маркера във Варна (Морска администрация, Пристанищна инфраструктура) са реалното място на дейността, не седалището. Мрежите (жп линии, пътища) нямат една точка — вижте картата на проектите по-горе; пътното строителство (АПИ) е отделен сектор.`
            : `The map reflects the selected time scope${periodLabel ? ` (${periodLabel})` : ""}. ${seats.sofia} of ${seats.total} entities are REGISTERED in Sofia${seats.outside.length ? `; the rest sit in ${seats.outside.map(([c, n]) => (n > 1 ? `${c} (${n})` : c)).join(", ")}` : ""}. The two Варна markers (Maritime Administration, Port Infrastructure) mark where the operation physically sits, not the legal seat. Networks (rail lines, roads) have no single point — see the project map above; road building (АПИ) is a separate sector.`}
        </p>
      </CardContent>
    </Card>
  );
};
