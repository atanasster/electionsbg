// The /sector/transport (Транспорт) infrastructure map: the physical assets the money
// builds. The state-transport entities are all Sofia-registered, so a seat map is degenerate;
// this maps what the contract TITLES name — the way the НЗОК map draws hospitals and the
// judiciary map draws courts — in two shapes:
//   • rail SECTIONS between two towns (Костенец–Септември, Пловдив–Бургас, Горна Оряховица–
//     Шумен) as coloured LINES;
//   • single-site facilities (ports Варна/Бургас/Русе, stations, junctions) as typed POINTS.
// Coloured by spend (or single-bid share), the line/badge weight scaling with money. A
// contract naming no town — train operations, rolling stock, fuel, fleet-wide insurance
// (network-wide, ~70% of value) — has no single location and is absent.
//
// The map is the shared SectorPointMap (reused from the court-load / МВР maps), extended with
// an optional line layer; this component owns the metric toggle, colour banding, legend and
// caption. Data comes from ONE /api/db/transport-project-map call, folded server-side.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { formatEurCompact } from "@/lib/currency";
import {
  SectorPointMap,
  type SectorMapPoint,
  type SectorMapLine,
} from "@/screens/components/maps/SectorPointMap";
import { TRANSPORT_SECTOR_EIKS } from "@/lib/transportReferenceData";
import {
  useTransportProjectMap,
  type TransportProjectSegment,
  type TransportProjectPoint,
  type ScopeWindow,
} from "@/data/procurement/useTransportProjectMap";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { contractsWord } from "./transportCopy";
import { useSearchParams } from "react-router-dom";
import { projectMapContractsHref } from "./transportMode";

type Metric = "spend" | "singleBid";

const METRICS: { id: Metric; bg: string; en: string }[] = [
  { id: "spend", bg: "Разход", en: "Spend" },
  { id: "singleBid", bg: "С една оферта", en: "Single bid" },
];

const FACILITY_LABEL: Record<string, { bg: string; en: string }> = {
  port: { bg: "Пристанище", en: "Port" },
  station: { bg: "Гара", en: "Station" },
  junction: { bg: "Възел", en: "Junction" },
  rail: { bg: "Жп обект", en: "Rail works" },
  aviation: { bg: "Обект на въздушния транспорт", en: "Aviation site" },
  site: { bg: "Обект", en: "Site" },
};

interface Band {
  max: number;
  color: string;
  label: string;
  /** Line stroke / relative heft for this band. */
  weight: number;
}

// Spend — a single-hue steel/rail sequential ramp (light → dark = low → high €), per the
// dataviz method (sequential, not rainbow, not red-green). Thresholds in €. Heavier money
// draws a thicker rail line.
const SPEND_BANDS: Band[] = [
  { max: 2_000_000, color: "#cdd7e3", label: "≤ €2M", weight: 2.5 },
  { max: 20_000_000, color: "#93a6c0", label: "2–20", weight: 3.5 },
  { max: 100_000_000, color: "#5f779c", label: "20–100", weight: 5 },
  { max: 300_000_000, color: "#3c527a", label: "100–300", weight: 6.5 },
  { max: Infinity, color: "#22314f", label: "> €300M", weight: 8 },
];

// Single-bid share — a risk ramp. Paired with the number on every card.
const BID_BANDS: Band[] = [
  { max: 0.1, color: "#15803d", label: "≤ 10%", weight: 3 },
  { max: 0.3, color: "#65a30d", label: "10–30%", weight: 4 },
  { max: 0.5, color: "#d97706", label: "30–50%", weight: 5 },
  { max: 0.7, color: "#ea580c", label: "50–70%", weight: 6 },
  { max: Infinity, color: "#b91c1c", label: "> 70%", weight: 7 },
];
const NO_DATA = "#94a3b8";

const bandOf = (bands: Band[], v: number) =>
  bands.find((b) => v <= b.max) ?? bands[bands.length - 1];

export const TransportProjectMap: FC<{
  /** The bodies to map — the whole roll-up, or one mode's (?mode= on
   *  /sector/transport/network). */
  eiks?: readonly string[];
  scopeWindow?: ScopeWindow;
  periodLabel?: string | null;
}> = ({ eiks = TRANSPORT_SECTOR_EIKS, scopeWindow, periodLabel }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const [params] = useSearchParams();
  // Every feature links to the contracts browser over the SAME bodies the card draws
  // (the `eiks` prop) and the page's scope (A8); ?mode never leaks into it.
  const contractsHref = useCallback(
    (q: string) => projectMapContractsHref(params, eiks, q),
    [params, eiks],
  );
  const { segments, points, coverage, isLoading } = useTransportProjectMap(
    eiks,
    scopeWindow,
  );

  const [metric, setMetric] = useState<Metric>("spend");

  const fmtPct = useCallback(
    (v: number) =>
      `${(v * 100).toLocaleString(bg ? "bg-BG" : "en-US", {
        maximumFractionDigits: 0,
      })}%`,
    [bg],
  );

  // Shared metric renderer — spend colour/weight, or single-bid colour/weight (grey if the
  // bid count is unknown). Returns the band-derived colour + weight and the resolved share.
  const styleOf = useCallback(
    (d: {
      totalEur: number;
      bidKnownN: number;
      singleBidN: number;
    }): { color: string; weight: number; share: number | null } => {
      const share = d.bidKnownN > 0 ? d.singleBidN / d.bidKnownN : null;
      if (metric === "spend") {
        const b = bandOf(SPEND_BANDS, d.totalEur);
        return { color: b.color, weight: b.weight, share };
      }
      if (share == null) return { color: NO_DATA, weight: 3, share };
      const b = bandOf(BID_BANDS, share);
      return { color: b.color, weight: b.weight, share };
    },
    [metric],
  );

  // A shared detail block (spend · contracts · single-bid) for both lines and points.
  const detailOf = useCallback(
    (d: {
      totalEur: number;
      contractCount: number;
      bidKnownN: number;
      singleBidN: number;
    }) => {
      const share = d.bidKnownN > 0 ? d.singleBidN / d.bidKnownN : null;
      return (
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
      );
    },
    [bg, fmtPct, i18n.language],
  );

  const lines = useMemo<SectorMapLine[]>(
    () =>
      segments.map((s: TransportProjectSegment) => {
        const { color, weight } = styleOf(s);
        const label = `${s.aTown} – ${s.bTown}`;
        return {
          id: `${s.aTown}|${s.bTown}`,
          a: s.a,
          b: s.b,
          color,
          weight,
          title: label,
          subtitle: s.lineOnly
            ? bg
              ? `Проект по линията · ${s.contractCount} ${contractsWord(s.contractCount, true)}`
              : `Project on the line · ${s.contractCount} ${contractsWord(s.contractCount, false)}`
            : bg
              ? `Жп участък · ${s.contractCount} ${contractsWord(s.contractCount, true)}`
              : `Rail section · ${s.contractCount} ${contractsWord(s.contractCount, false)}`,
          detail: detailOf(s),
          href: contractsHref(`${s.aTown} ${s.bTown}`),
        };
      }),
    [segments, styleOf, detailOf, bg, contractsHref],
  );

  const mapPoints = useMemo<SectorMapPoint[]>(
    () =>
      points.map((d: TransportProjectPoint) => {
        const { color, share } = styleOf(d);
        const fac = d.facility ? FACILITY_LABEL[d.facility] : null;
        const value = metric === "spend" ? d.totalEur : (share ?? -1);
        return {
          id: d.town,
          loc: d.loc,
          value,
          color,
          badge: d.contractCount,
          title: d.town,
          subtitle: fac
            ? `${bg ? fac.bg : fac.en} · ${d.contractCount} ${contractsWord(d.contractCount, bg)}`
            : bg
              ? `${d.contractCount} ${contractsWord(d.contractCount, true)}`
              : `${d.contractCount} ${contractsWord(d.contractCount, false)}`,
          detail: detailOf(d),
          href: contractsHref(d.town),
        };
      }),
    [points, styleOf, detailOf, metric, bg, contractsHref],
  );

  const placedPct =
    coverage && coverage.totalEur > 0
      ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
          maximumFractionDigits: 1,
        }).format((coverage.placedEur / coverage.totalEur) * 100)
      : null;

  if (isLoading) return <ChartGhost className="h-[460px]" shape="map" />;
  if (!segments.length && !points.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        {bg
          ? "В избрания период няма договори, в чието наименование е назовано място."
          : "No contracts in the selected window name a place in their title."}
      </p>
    );

  const bands = metric === "spend" ? SPEND_BANDS : BID_BANDS;

  return (
    <Card data-og="transport-map">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          {bg
            ? "Къде отиват парите за инфраструктура"
            : "Where the infrastructure money goes"}
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
                aria-pressed={metric === m.id}
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

        <SectorPointMap
          points={mapPoints}
          lines={lines}
          groupNoun={bg ? "обекта" : "sites"}
          badgeNoun={bg ? "договори" : "contracts"}
          openLabel={bg ? "Виж договорите" : "See contracts"}
        />

        {/* Legend: shape key + colour bands */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-5 rounded"
              style={{ background: "#3c527a" }}
            />
            {bg ? "жп участък" : "rail section"}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "#3c527a" }}
            />
            {Object.values(FACILITY_LABEL)
              .map((l) => (bg ? l.bg : l.en).toLowerCase())
              .join(" / ")}
          </span>
        </div>
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
        {coverage && coverage.totalEur > 0 ? (
          <p className="text-xs text-muted-foreground">
            {bg
              ? `На картата са ${placedPct}% от средствата в периода (${formatEurCompact(coverage.placedEur, i18n.language)} от ${formatEurCompact(coverage.totalEur, i18n.language)}) — договорите, в чието наименование е назовано място. Останалите са мрежови или не посочват място.`
              : `The map places ${placedPct}% of the window's money (${formatEurCompact(coverage.placedEur, i18n.language)} of ${formatEurCompact(coverage.totalEur, i18n.language)}) — the contracts whose title names a place. The rest are network-wide or name none.`}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Картата показва физическата инфраструктура, посочена в наименованията на договорите, в избрания обхват${periodLabel ? ` (${periodLabel})` : ""}. Линиите са жп участъци между два града (напр. Костенец–Септември) и са схематични — между населените места, не по трасето; точките са единични обекти — гари, пристанища, летища, възли — и може да се застъпват; „проект по линията“ е линия, чийто конкретен участък не може да бъде разпознат. Дебелината и цветът следват размера на разхода. Превозите, подвижният състав и горивата са мрежови, нямат една точка и не са тук. Пътищата (АПИ) са отделен сектор.`
            : `The map shows the physical infrastructure named in the contract titles, in the selected scope${periodLabel ? ` (${periodLabel})` : ""}. Lines are rail sections between two towns (e.g. Костенец–Септември) and are schematic — between the places, not along the route; points are single sites — stations, ports, airports, junctions — and can overlap; a "project on the line" is a line whose specific section could not be placed. Line width and colour follow the spend. Train operations, rolling stock and fuel are network-wide, have no single point and are not shown. Roads (АПИ) are a separate sector.`}
        </p>
      </CardContent>
    </Card>
  );
};
