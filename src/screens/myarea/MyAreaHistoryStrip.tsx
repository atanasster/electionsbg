// Footer card holding the "deep history" of a place. Two panels sit
// side-by-side on wide screens (stacked on narrow): turnout sparkline
// over recent cycles, and a top-party-per-cycle strip so the reader
// can compare "engagement trend" against "preference trend" without
// leaving the dashboard. The drill-down link to the full canonical
// dashboard sits below both.
//
// Settlement view uses useSettlementStats (one fetch, all cycles for that
// settlement). Município view falls back to a link-only card since
// useMunicipalityStats keys by oblast and would mix cycles across multiple
// settlements; that case can grow into its own variant later.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ResolvedArea } from "@/data/area/useAreaResolver";
import { useSettlementStats } from "@/data/settlements/useSettlementStats";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { Tooltip } from "@/ux/Tooltip";

type Props = {
  area: Extract<
    ResolvedArea,
    { kind: "settlement" } | { kind: "municipality" }
  >;
};

type PartyShare = {
  nickName: string;
  totalVotes: number;
  share: number; // totalVotes / sum-of-valid party votes for that cycle
};

type CyclePoint = {
  cycle: string; // election name (folder slug)
  turnout: number; // 0..1
  registered: number; // numRegisteredVoters
  voters: number; // totalActualVoters
  // Top parties for the cycle, ranked descending by totalVotes. First entry
  // is the winner and drives the bar's colour/height. We keep more than one
  // so the tooltip can show the podium without re-derivation.
  tops: PartyShare[];
};

const formatPct = (n: number, lang: "bg" | "en"): string =>
  (n * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
  }) + "%";

const formatCycleShort = (cycle: string): string => {
  // "2026_04_19" → "04.26", "2024_06_09" → "06.24"
  const m = cycle.match(/^(\d{4})_(\d{2})_/);
  if (!m) return cycle;
  return `${m[2]}.${m[1].slice(2)}`;
};

const MONTHS_BG = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const formatCycleLong = (cycle: string, lang: "bg" | "en"): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return cycle;
  const [, y, mo, d] = m;
  const mi = parseInt(mo, 10) - 1;
  if (lang === "bg") return `${parseInt(d, 10)} ${MONTHS_BG[mi]} ${y}`;
  return `${MONTHS_EN[mi]} ${parseInt(d, 10)}, ${y}`;
};

const SettlementHistoryBody: FC<{ ekatte: string; lang: "bg" | "en" }> = ({
  ekatte,
  lang,
}) => {
  const { stats } = useSettlementStats(ekatte);
  // National turnout per cycle — from the statically-imported
  // elections.json (no fetch). Lets us tag the latest settlement cycle
  // with a "vs national" comparison.
  const { stats: nationalStats } = useElectionContext();
  const { colorFor } = useCanonicalParties();
  const nationalTurnoutByCycle = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const e of nationalStats ?? []) {
      const p = e.results?.protocol;
      const reg = p?.numRegisteredVoters ?? 0;
      const voters = p?.totalActualVoters ?? 0;
      if (reg > 0 && voters > 0) m.set(e.name, voters / reg);
    }
    return m;
  }, [nationalStats]);

  const points = useMemo<CyclePoint[]>(() => {
    if (!stats || stats.length === 0) return [];
    const out: CyclePoint[] = [];
    for (const e of stats) {
      const p = e.results?.protocol;
      const reg = p?.numRegisteredVoters ?? 0;
      const voters = p?.totalActualVoters ?? 0;
      if (!(reg > 0 && voters > 0)) continue;

      const votes = e.results?.votes ?? [];
      let sum = 0;
      for (const v of votes) sum += v.totalVotes ?? 0;
      const tops: PartyShare[] =
        sum > 0
          ? votes
              .filter((v) => (v.totalVotes ?? 0) > 0)
              .map((v) => ({
                nickName: v.nickName,
                totalVotes: v.totalVotes ?? 0,
                share: (v.totalVotes ?? 0) / sum,
              }))
              .sort((a, b) => b.totalVotes - a.totalVotes)
              .slice(0, 3)
          : [];

      out.push({
        cycle: e.name,
        turnout: voters / reg,
        registered: reg,
        voters,
        tops,
      });
    }
    // Sort ascending by cycle name (date-shaped folder slugs sort
    // naturally). Cap at the last 8 cycles — beyond that the sparkline
    // gets too noisy at this small size.
    out.sort((a, b) => a.cycle.localeCompare(b.cycle));
    return out.slice(-8);
  }, [stats]);

  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        {lang === "bg"
          ? "Не достатъчно данни за тренд."
          : "Not enough data for a trend."}
      </p>
    );
  }

  const turnoutVals = points.map((p) => p.turnout);
  const minT = Math.min(...turnoutVals);
  const maxT = Math.max(...turnoutVals);
  const spread = maxT - minT || 0.001;
  const W = 240;
  const H = 48;
  const padY = 6;
  const pathD = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - padY - ((p.turnout - minT) / spread) * (H - padY * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.turnout - first.turnout;

  // "vs national turnout" for the latest cycle. Higher turnout reads as
  // stronger civic engagement → green when above the national figure.
  const nationalLast = nationalTurnoutByCycle.get(last.cycle) ?? null;
  const vsNational =
    nationalLast != null
      ? {
          diff: last.turnout - nationalLast,
          nationalPct: formatPct(nationalLast, lang),
        }
      : null;

  // Top-party panel: how often the current cycle's leader has carried
  // this area in the same window, and whether the latest leader is on
  // a streak.
  const lastTop = last.tops[0] ?? null;
  const winCount = lastTop
    ? points.filter((p) => p.tops[0]?.nickName === lastTop.nickName).length
    : 0;
  let streak = 0;
  if (lastTop) {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].tops[0]?.nickName === lastTop.nickName) streak++;
      else break;
    }
  }

  // Fallback color for parties not in the canonical color table — the
  // muted-foreground swatch keeps the row legible without picking a
  // colour that could be confused with a known brand.
  const colorOrFallback = (nickName: string): string =>
    colorFor(nickName) ?? "rgb(156 163 175)";

  const numLocale = lang === "bg" ? "bg-BG" : "en-GB";

  return (
    <div className="grid gap-4 lg:gap-6 grid-cols-1 lg:grid-cols-2">
      {/* Left — turnout panel */}
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-4">
          <div className="flex flex-col">
            <span className="text-2xl font-bold tabular-nums leading-tight">
              {formatPct(last.turnout, lang)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {lang === "bg" ? "избирателна активност" : "voter turnout"} ·{" "}
              {formatCycleShort(last.cycle)}
            </span>
            {vsNational ? (
              <span
                className={`text-[10px] font-medium mt-0.5 ${
                  Math.abs(vsNational.diff) < 0.01
                    ? "text-muted-foreground"
                    : vsNational.diff > 0
                      ? "text-emerald-600"
                      : "text-rose-600"
                }`}
              >
                {Math.abs(vsNational.diff) < 0.01
                  ? lang === "bg"
                    ? `≈ ср. за страната (${vsNational.nationalPct})`
                    : `≈ national (${vsNational.nationalPct})`
                  : `${vsNational.diff > 0 ? "+" : ""}${(vsNational.diff * 100).toFixed(1)} ${
                      lang === "bg" ? "пр.пр. спрямо" : "pp vs"
                    } ${vsNational.nationalPct} ${
                      lang === "bg" ? "нац." : "nat."
                    }`}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col">
            <div className="relative" style={{ width: W, height: H }}>
              <svg
                width={W}
                height={H}
                aria-hidden
                className="text-primary block"
              >
                <path
                  d={pathD}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((p, i) => {
                  const x = (i / (points.length - 1)) * W;
                  const y =
                    H - padY - ((p.turnout - minT) / spread) * (H - padY * 2);
                  return (
                    <circle
                      key={p.cycle}
                      cx={x}
                      cy={y}
                      r={2}
                      fill="currentColor"
                    />
                  );
                })}
              </svg>
              {/* Invisible per-cycle hover bands stacked on top of the SVG
                  — each one tooltips the cycle's turnout + counts. Kept
                  absolutely positioned so they don't shift the SVG. */}
              <div className="absolute inset-0 flex">
                {points.map((p) => {
                  const nat = nationalTurnoutByCycle.get(p.cycle) ?? null;
                  const diffPp = nat != null ? (p.turnout - nat) * 100 : null;
                  const content = (
                    <div className="text-left">
                      <div className="text-[10px] uppercase tracking-wide opacity-70 text-center mb-1">
                        {formatCycleLong(p.cycle, lang)}
                      </div>
                      <div className="text-[11px] leading-tight space-y-0.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="opacity-80">
                            {lang === "bg"
                              ? "избирателна активност"
                              : "voter turnout"}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatPct(p.turnout, lang)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="opacity-80">
                            {lang === "bg" ? "гласували" : "voters"}
                          </span>
                          <span className="tabular-nums">
                            {p.voters.toLocaleString(numLocale)}
                            <span className="opacity-60">
                              {" / "}
                              {p.registered.toLocaleString(numLocale)}
                            </span>
                          </span>
                        </div>
                        {diffPp != null && Math.abs(diffPp) >= 0.05 ? (
                          <div
                            className={`flex items-baseline justify-between gap-3 ${
                              diffPp > 0 ? "text-emerald-500" : "text-rose-500"
                            }`}
                          >
                            <span className="opacity-80">
                              {lang === "bg" ? "спрямо нац." : "vs national"}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {diffPp > 0 ? "+" : ""}
                              {diffPp.toFixed(1)}
                              {lang === "bg" ? " пр.пр." : " pp"}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                  return (
                    <Tooltip key={p.cycle} content={content}>
                      <div className="flex-1 h-full cursor-default" />
                    </Tooltip>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
              <span>{formatCycleShort(first.cycle)}</span>
              <span>{formatCycleShort(last.cycle)}</span>
            </div>
          </div>
          <div
            className={`text-xs tabular-nums ${
              delta >= 0 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {delta >= 0 ? "+" : ""}
            {(delta * 100).toFixed(1)}
            {lang === "bg" ? " пр.пр." : " pp"}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {lang === "bg"
            ? `Базирано на протоколите от ${points.length} цикъла. Само за това населено място.`
            : `Based on protocols from ${points.length} cycles. This settlement only.`}
        </p>
      </div>

      {/* Right — top-party-per-cycle panel */}
      {lastTop ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-2xl font-bold leading-tight">
                <span
                  className="inline-block size-3 rounded-sm shrink-0"
                  style={{ background: colorOrFallback(lastTop.nickName) }}
                  aria-hidden
                />
                <span className="truncate">{lastTop.nickName}</span>
              </span>
              <span className="text-[10px] text-muted-foreground">
                {lang === "bg" ? "първа партия" : "top party"} ·{" "}
                {formatPct(lastTop.share, lang)} ·{" "}
                {formatCycleShort(last.cycle)}
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {lang === "bg"
                  ? `Печели в ${winCount} от ${points.length} цикъла`
                  : `Wins ${winCount} of ${points.length} cycles`}
                {streak >= 2
                  ? lang === "bg"
                    ? ` · ${streak} поредни`
                    : ` · ${streak} consecutive`
                  : ""}
              </span>
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-end gap-[3px]" style={{ height: H }}>
                {points.map((p) => {
                  const winner = p.tops[0];
                  const name = winner?.nickName ?? "";
                  const share = winner?.share ?? 0;
                  // Bar height proportional to share so the chip carries
                  // two facts at once: who won (colour) + how decisive
                  // the win was (height). Clamp at 6px so a tiny share
                  // still renders a tappable bar.
                  const h = Math.max(6, Math.round((H - 6) * share));
                  const tooltipContent = (
                    <div className="text-left">
                      <div className="text-[10px] uppercase tracking-wide opacity-70 text-center mb-1">
                        {formatCycleLong(p.cycle, lang)}
                      </div>
                      {p.tops.length > 0 ? (
                        <table className="w-full border-collapse text-[11px] leading-tight">
                          <tbody>
                            {p.tops.map((row) => (
                              <tr key={row.nickName} className="font-medium">
                                <td className="py-0.5 pr-2">
                                  <div className="flex items-center gap-1.5 max-w-[140px]">
                                    <span
                                      aria-hidden
                                      className="inline-block h-2 w-2 rounded-sm shrink-0"
                                      style={{
                                        backgroundColor: colorOrFallback(
                                          row.nickName,
                                        ),
                                      }}
                                    />
                                    <span className="truncate">
                                      {row.nickName}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                                  {row.totalVotes.toLocaleString(numLocale)}
                                </td>
                                <td className="py-0.5 text-right tabular-nums font-semibold">
                                  {formatPct(row.share, lang)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="text-[11px] opacity-70">
                          {lang === "bg" ? "Няма данни" : "No data"}
                        </div>
                      )}
                    </div>
                  );
                  return (
                    <Tooltip key={p.cycle} content={tooltipContent}>
                      <div
                        className="flex-1 min-w-[6px] rounded-sm cursor-default"
                        style={{
                          height: h,
                          background: name ? colorOrFallback(name) : undefined,
                          opacity:
                            lastTop && name === lastTop.nickName ? 1 : 0.7,
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums">
                <span>{formatCycleShort(first.cycle)}</span>
                <span>{formatCycleShort(last.cycle)}</span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {lang === "bg"
              ? "Височина = дял за партията-победител в цикъла."
              : "Bar height = winning party's share in that cycle."}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const MyAreaHistoryStrip: FC<Props> = ({ area }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  return (
    <Card className="p-4 mt-2 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold flex-1">
          {lang === "bg"
            ? "История на парламентарния вот"
            : "Parliamentary vote history"}
        </h2>
        <Trophy
          className="size-3.5 text-muted-foreground shrink-0"
          aria-hidden
        />
      </div>
      {area.kind === "settlement" ? (
        <SettlementHistoryBody ekatte={area.ekatte} lang={lang} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {lang === "bg"
            ? "Историята на парламентарния вот за общината е достъпна на пълното табло."
            : "Cycle-by-cycle parliamentary results for the municipality are available on the full dashboard."}
        </p>
      )}
      {/* Reference `t` so future translatable copy lands here without
          re-adding the import — same pattern as elsewhere. */}
      <span hidden aria-hidden>
        {t("my_area_dashboard")}
      </span>
    </Card>
  );
};
