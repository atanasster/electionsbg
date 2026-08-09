import React from "react";
import { THEME } from "../theme";
import DATA from "../generated/risk.json";
import type { RiskCanvasState } from "../lib/riskCanvasState";

/**
 * The persistent canvas for the election-risk explainer.
 *
 * Three acts on ONE surface, driven entirely by an interpolated
 * `RiskCanvasState` on ABSOLUTE time (it renders outside every `<Sequence>` so it
 * can persist and accrete — see lib/canvasTimeline.ts):
 *
 *   act 1  five integrity meters fill one at a time
 *   act 2  `mode` crossfades them into the seven comparable elections, with the
 *          04.2026 column arriving FIRST (`avg`) and the other six after
 *          (`history`) — so the collapse reads as "these five became this one,
 *          and here is where it sits"
 *   act 3  the band backgrounds wash in behind the columns; the 40 rule is what
 *          puts 47 in «Висок»
 *   coda   a context strip of five smaller meters drops in below
 *
 * Every number drawn here comes from `generated/risk.json`, whose build script
 * asserts each one and refuses to write when the story moves. Nothing is
 * hard-coded except axis furniture.
 */

const PAD = { l: 92, r: 40, t: 24, b: 52 };

const BAND_COLOR_CALM = "#3d9a72";
const BAND_COLOR_ELEV = "#d9a441";
const BAND_COLOR_HIGH = "#df6b43";
const BAND_COLOR_CRIT = "#c4453d";
/**
 * Height reserved at the bottom for the context strip once `ctx` is up.
 *
 * It has to clear the COLUMN DATE LABELS, which sit 36px under the plot floor —
 * at the first sizing the strip's divider was drawn 16px under it and ran
 * straight through «07.2021 11.2021 …». The offsets below are all measured from
 * the plot floor for exactly that reason.
 */
const CTX_H = 214;
/** Offsets from the plot floor. `CTX_TOP` clears the 36px column labels. */
const CTX_TOP = 64;

/**
 * Bulgarian thousands grouping, applied to EVERY four-digit-and-up number.
 *
 * Not `toLocaleString("bg-BG")`: that locale sets `minimumGroupingDigits: 2`, so
 * it renders 10 773 grouped and 1629 not — the two sat in one sentence on the
 * sections callout while the rail beside them (hand-written) said «1 629». Same
 * number, three spellings on one screen. `useGrouping: "always"` would fix it but
 * is ES2023 and this project's lib types it as a boolean.
 */
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");

type Facts = typeof DATA.facts;
const F: Facts = DATA.facts as Facts;

/**
 * The five integrity meters, in the page's own order. `pct` / `capPct` are what
 * the scale tag draws: every one of these scores is a measured share against a
 * deliberately tight scale end, and the score alone hides that.
 */
const METERS = [
  {
    key: "m1",
    label: "Секционен скрининг",
    what: "Гласове в секции, маркирани за проверка",
    value: F.integrity.sections.score,
    pct: F.integrity.sections.pct,
    capPct: F.integrity.sections.capPct,
  },
  {
    key: "m2",
    label: "Машинна цялост",
    what: "Протоколът срещу флаш паметта на машината",
    value: F.integrity.machine.score,
    pct: F.integrity.machine.pct,
    capPct: F.integrity.machine.capPct,
  },
  {
    key: "m3",
    label: "Липсваща флаш памет",
    what: "Машинни гласове без втори запис",
    value: F.integrity.missingFlash.score,
    pct: F.integrity.missingFlash.pct,
    capPct: F.integrity.missingFlash.capPct,
  },
  {
    key: "m4",
    label: "Концентрация",
    what: "Места, където една партия взема над 80%",
    value: F.integrity.concentration.score,
    pct: F.integrity.concentration.pct,
    capPct: F.integrity.concentration.capPct,
  },
  {
    key: "m5",
    label: "Процедурни аномалии",
    what: "Недействителни бюлетини и дописани избиратели",
    value: F.integrity.procedural.score,
    pct: F.integrity.procedural.pct,
    capPct: F.integrity.procedural.capPct,
  },
] as const;

/**
 * The four screening bands, for the sections callout — ordered LOW → CRITICAL to
 * match the rail's own «ниско · повишено · високо · критично». The bar read
 * worst-first while the words beside it read best-first, which is a free way to
 * make a reader mistrust both.
 */
const SECTION_BANDS = [
  { label: "ниски", n: F.integrity.sections.counts.low, c: BAND_COLOR_CALM },
  {
    label: "повишени",
    n: F.integrity.sections.counts.elevated,
    c: BAND_COLOR_ELEV,
  },
  { label: "високи", n: F.integrity.sections.counts.high, c: BAND_COLOR_HIGH },
  {
    label: "критични",
    n: F.integrity.sections.counts.critical,
    c: BAND_COLOR_CRIT,
  },
] as const;

type CtxPoint = { label: string; value: number; subject: boolean };
const CS = F.contextSeries as unknown as Record<string, CtxPoint[]>;

/**
 * The five context signals. `series` and `rank` are what let the MAIN PLOT show
 * the signal being talked about instead of the index — the scene that says
 * "second of twelve" now draws those twelve.
 */
const CONTEXT = [
  {
    key: "c1",
    label: "Бенфорд",
    value: F.context.benford.score,
    series: CS.benford!,
    rank: F.context.benford.history,
  },
  {
    key: "c2",
    label: "Махали",
    value: F.context.neighborhoodsSwing.score,
    series: CS.neighborhoodsSwing!,
    rank: F.context.neighborhoodsSwing.history,
  },
  {
    key: "c3",
    label: "Волатилност",
    value: F.context.voteSwitching.score,
    series: CS.voteSwitching!,
    rank: F.context.voteSwitching.history,
  },
  {
    key: "c4",
    label: "Социология",
    value: F.context.polls.score,
    series: CS.polls!,
    rank: F.context.polls.history,
  },
  {
    key: "c5",
    label: "Клъстери",
    value: F.context.clusters.score,
    series: CS.clusters!,
    rank: F.context.clusters.history,
  },
] as const;

/** The seven comparable elections, chronological. */
type Cycle = { election: string; label: string; score: number };
const CYCLES = DATA.comparable as Cycle[];

/**
 * Band colour by score. Same four thresholds the page uses, read out of the
 * generated facts rather than restated, so a calibration change cannot leave the
 * video colouring by the old boundaries.
 */
const BAND_FLOORS = F.history.bands.map((b) => b.floor);
const BAND_COLORS = [
  BAND_COLOR_CALM,
  BAND_COLOR_ELEV,
  BAND_COLOR_HIGH,
  BAND_COLOR_CRIT,
];
const bandColor = (score: number): string => {
  let i = 0;
  for (let k = 0; k < BAND_FLOORS.length; k++)
    if (score >= BAND_FLOORS[k]!) i = k;
  return BAND_COLORS[i]!;
};

export const RiskCanvas: React.FC<{
  state: RiskCanvasState;
  width: number;
  height: number;
}> = ({ state, width, height }) => {
  const pal = THEME.dark;
  const w = width;
  const h = height;

  const ctxRoom = CTX_H * state.ctx;
  const plotW = w - PAD.l - PAD.r;
  /**
   * A focused context series gets a title band above the bars. Drawn as an
   * overlay it landed ON the columns — and the 100-value bars, of which the
   * volatility series has six, reach the very top of the plot.
   */
  const titleBand = state.ctxFocus != null ? 46 : 0;
  const plotTop = PAD.t + titleBand;
  const plotH = h - plotTop - PAD.b - ctxRoom;

  /** Score 0..100 → y. Shared by both acts, which is what makes them one axis. */
  const y = (v: number) => plotTop + plotH - (v / 100) * plotH;

  const fade = 1 - 0.55 * state.dim;
  const metersOpacity = (1 - state.mode) * fade;
  const columnsOpacity = state.mode * fade;

  const ticks = [0, 20, 40, 60, 80, 100];

  // ── act 1 geometry: horizontal meters ──────────────────────────────────────
  const mRowH = plotH / METERS.length;
  const mBarH = Math.min(58, mRowH * 0.42);
  // The text column has to clear the longest description at 22px, or the track
  // is drawn straight through it — measured against «Недействителни бюлетини и
  // дописани избиратели», the longest of the five.
  const mTextW = 520;
  const mTrackX = PAD.l + mTextW;
  const mTrackW = Math.max(120, plotW - mTextW - 130);

  // ── act 2 geometry: columns ────────────────────────────────────────────────
  const subjectIdx = CYCLES.findIndex((c) => c.election === F.election);

  /**
   * What the main plot is charting right now. While a context signal is focused
   * the columns are ITS series — different length, its own subject column, and
   * none of the index's calibration furniture, which describes the composite and
   * says nothing about a component.
   */
  const focusedCtx =
    state.ctxFocus != null ? CONTEXT[state.ctxFocus - 1] : undefined;
  const plotted: { label: string; value: number; subject: boolean }[] =
    focusedCtx
      ? focusedCtx.series.map((p) => ({ ...p }))
      : CYCLES.map((c, i) => ({
          label: c.label,
          value: Math.round(c.score),
          subject: i === subjectIdx,
        }));
  const nCols = plotted.length;

  // Sized from the CURRENT column set — a context series can be 9, 11 or 13 wide
  // against the index's 7, and a gap tuned for seven leaves 13 overlapping.
  const colGap = nCols > 9 ? 12 : 26;
  const colW = Math.min(150, (plotW - colGap * (nCols - 1)) / nCols);
  const colsW = colW * nCols + colGap * (nCols - 1);
  const colX = (i: number) => PAD.l + (plotW - colsW) / 2 + i * (colW + colGap);

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {/* band backgrounds — behind everything, act 3 */}
      {state.bands > 0.01 && !focusedCtx
        ? BAND_FLOORS.map((floor, i) => {
            const top = BAND_FLOORS[i + 1] ?? 100;
            return (
              <rect
                key={floor}
                x={PAD.l}
                y={y(top)}
                width={plotW}
                height={Math.max(1, y(floor) - y(top))}
                fill={BAND_COLORS[i]}
                opacity={0.22 * state.bands * fade}
              />
            );
          })
        : null}

      {/* Gridlines + score axis — COLUMNS ONLY. On the horizontal meters the
          value is encoded by bar LENGTH, so a vertical 0–100 scale behind them
          invites a reading that does not exist; it fades in with the columns. */}
      {ticks.map((v) => (
        <g key={v} opacity={fade * state.mode}>
          <line
            x1={PAD.l}
            x2={PAD.l + plotW}
            y1={y(v)}
            y2={y(v)}
            stroke={pal.rule}
            strokeWidth={v === 0 ? 2 : 1}
            opacity={v === 0 ? 0.9 : 0.4}
          />
          <text
            x={PAD.l - 18}
            y={y(v) + 9}
            textAnchor="end"
            fill={pal.muted}
            fontSize={24}
            fontWeight={600}
          >
            {v}
          </text>
        </g>
      ))}

      {/* ── ACT 1 · the five integrity meters ─────────────────────────────── */}
      {metersOpacity > 0.01 && state.rows > 0.01 ? (
        <g opacity={metersOpacity}>
          {METERS.map((m, i) => {
            const p = state[m.key as keyof RiskCanvasState] as number;
            const cy = plotTop + mRowH * i + mRowH / 2;
            const lit = state.focus == null || state.focus === i + 1;
            const o = (lit ? 1 : 0.3) * state.rows;
            const filled = p > 0.005;
            const fillW = mTrackW * (m.value / 100) * Math.min(1, p);
            return (
              <g key={m.key} opacity={o}>
                <text
                  x={PAD.l}
                  y={cy - 6}
                  fill={pal.text}
                  fontSize={30}
                  fontWeight={600}
                >
                  {m.label}
                </text>
                {/* What the signal MEASURES. Before this the row was a label
                    beside an empty track, which reads as a chart plotting
                    nothing — the bars looked like data and were placeholders. */}
                <text
                  x={PAD.l}
                  y={cy + 28}
                  fill={pal.muted}
                  fontSize={22}
                  fontWeight={500}
                >
                  {m.what}
                </text>
                {filled ? (
                  <>
                    <rect
                      x={mTrackX}
                      y={cy - mBarH / 2}
                      width={mTrackW}
                      height={mBarH}
                      rx={6}
                      fill={pal.rule}
                      opacity={0.55}
                    />
                    <rect
                      x={mTrackX}
                      y={cy - mBarH / 2}
                      width={Math.max(2, fillW)}
                      height={mBarH}
                      rx={6}
                      fill={bandColor(m.value)}
                    />
                    <text
                      x={mTrackX + mTrackW + 24}
                      y={cy + 12}
                      fill={pal.text}
                      fontSize={38}
                      fontWeight={700}
                    >
                      {Math.round(m.value * Math.min(1, p))}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}

          {/* The focused meter's SCALE END. Applies to any of the five — each is
              a measured share against its own tight cap, and the score alone
              hides that. Scene 16 is what it exists for. */}
          {state.scaleTag > 0.01 && state.focus != null
            ? (() => {
                const m = METERS[state.focus - 1];
                if (!m) return null;
                const cy = plotTop + mRowH * (state.focus - 1) + mRowH / 2;
                return (
                  <g opacity={state.scaleTag}>
                    <line
                      x1={mTrackX + mTrackW}
                      x2={mTrackX + mTrackW}
                      y1={cy - mRowH * 0.44}
                      y2={cy + mRowH * 0.44}
                      stroke={pal.text}
                      strokeWidth={3}
                      strokeDasharray="8 6"
                    />
                    <text
                      x={mTrackX + mTrackW - 14}
                      y={cy - mBarH / 2 - 14}
                      textAnchor="end"
                      fill={pal.text}
                      fontSize={25}
                      fontWeight={700}
                    >
                      скалата свършва на {String(m.capPct).replace(".", ",")}%
                    </text>
                    <text
                      x={mTrackX}
                      y={cy + mBarH / 2 + 32}
                      fill={pal.muted}
                      fontSize={25}
                      fontWeight={600}
                    >
                      измерено: {String(m.pct).replace(".", ",")}%
                    </text>
                  </g>
                );
              })()
            : null}

          {/* The callout panel. Two kinds, snapped rather than cross-dissolved. */}
          {/* A callout is an OPAQUE card, not a tint. Both panels sit over meter
              rows, and a translucent fill lets the labels beneath show through as
              a second layer of text — legible in the Studio preview at 25% and a
              mess at full size. Each is also placed over rows that are still
              unfilled at that beat, so the card never hides a number in play. */}
          {state.inset > 0.01 && state.insetKind === "sections" ? (
            <g opacity={state.inset}>
              <rect
                x={PAD.l}
                y={plotTop + mRowH * 1.16}
                width={plotW}
                height={mRowH * 1.62}
                rx={12}
                fill={pal.bg2}
                stroke={pal.rule}
                strokeWidth={2}
              />
              <text
                x={PAD.l + 26}
                y={plotTop + mRowH * 1.16 + 42}
                fill={pal.muted}
                fontSize={24}
                fontWeight={600}
              >
                {num(F.integrity.sections.totalSections)} секции по нива
              </text>
              {(() => {
                const total = F.integrity.sections.totalSections;
                const barX = PAD.l + 26;
                const barW = plotW - 52;
                const barY = plotTop + mRowH * 1.16 + 62;
                /**
                 * SCHEMATIC, and the caption below says so.
                 *
                 * At true proportion the six critical sections are 0.05% of the
                 * bar — one pixel, invisible — and the whole point of the panel
                 * is that they exist. Each band gets a floor and the remainder is
                 * shared proportionally, so the ordering and the rough shape
                 * survive while the small groups stay visible. A non-proportional
                 * stacked bar that does not admit it is a lie, hence the note.
                 */
                const floor = barW * 0.035;
                const free = barW - floor * SECTION_BANDS.length;
                let acc = 0;
                return SECTION_BANDS.map((b) => {
                  const bw = floor + free * (b.n / total);
                  const x0 = barX + acc;
                  acc += bw;
                  return (
                    <rect
                      key={b.label}
                      x={x0}
                      y={barY}
                      width={bw}
                      height={26}
                      fill={b.c}
                      opacity={0.9}
                    />
                  );
                });
              })()}
              {/* A four-colour bar with no legend leaves the reader guessing
                  which colour is which — and the biggest band here is the SAFE
                  one, so the guess that goes wrong is the alarming one. */}
              <text
                x={PAD.l + 26}
                y={plotTop + mRowH * 1.16 + 128}
                fontSize={26}
                fontWeight={600}
              >
                {SECTION_BANDS.map((b, i) => (
                  <React.Fragment key={b.label}>
                    {i ? <tspan fill={pal.muted}>{"   ·   "}</tspan> : null}
                    <tspan fill={b.c}>{"\u25A0 "}</tspan>
                    <tspan fill={pal.text}>{`${num(b.n)} ${b.label}`}</tspan>
                  </React.Fragment>
                ))}
              </text>
              {/* The bar is NOT to scale (see the floors above) and has to say
                  so — a stacked bar that silently exaggerates its small groups
                  is exactly the chart this video spends twelve minutes against. */}
              <text
                x={PAD.l + 26}
                y={plotTop + mRowH * 1.16 + 166}
                fill={pal.muted}
                fontSize={21}
                fontWeight={500}
              >
                схематично — малките групи са увеличени, за да се виждат
              </text>
            </g>
          ) : null}

          {state.inset > 0.01 && state.insetKind === "concentration" ? (
            <g opacity={state.inset}>
              <rect
                x={PAD.l}
                y={plotTop + mRowH * 3.86}
                width={plotW}
                height={mRowH * 1.1}
                rx={12}
                fill={pal.bg2}
                stroke={pal.rule}
                strokeWidth={2}
              />
              <text
                x={PAD.l + 26}
                y={plotTop + mRowH * 4.2}
                fill={pal.muted}
                fontSize={24}
                fontWeight={600}
              >
                населени места над {F.integrity.concentration.thresholdPct}%
              </text>
              <text
                x={PAD.l + 26}
                y={plotTop + mRowH * 4.66}
                fill={pal.text}
                fontSize={40}
                fontWeight={700}
              >
                {F.integrity.concentration.baseline.settlements} →{" "}
                {F.integrity.concentration.settlements}
              </text>
              <text
                x={PAD.l + plotW - 26}
                y={plotTop + mRowH * 4.2}
                textAnchor="end"
                fill={pal.muted}
                fontSize={24}
                fontWeight={600}
              >
                но и гласували
              </text>
              <text
                x={PAD.l + plotW - 26}
                y={plotTop + mRowH * 4.66}
                textAnchor="end"
                fill={pal.accent}
                fontSize={40}
                fontWeight={700}
              >
                {String(F.integrity.concentration.baseline.turnoutMln).replace(
                  ".",
                  ",",
                )}{" "}
                →{" "}
                {String(F.integrity.concentration.turnoutMln).replace(".", ",")}{" "}
                млн.
              </text>
            </g>
          ) : null}
        </g>
      ) : null}

      {/* ── ACT 2 · the seven comparable elections ────────────────────────── */}
      {columnsOpacity > 0.01 ? (
        <g opacity={columnsOpacity}>
          {plotted.map((c, i) => {
            // The subject column is gated by `avg`; the others by `history`, so
            // the collapse lands on ONE column before the peers arrive. A focused
            // context series has already accreted, so it comes in whole.
            const p = focusedCtx ? 1 : c.subject ? state.avg : state.history;
            if (p < 0.005) return null;
            const barH = (c.value / 100) * plotH * Math.min(1, p);
            const wide = nCols <= 9;
            return (
              <g key={`${focusedCtx?.key ?? "idx"}-${c.label}`}>
                <rect
                  x={colX(i)}
                  y={plotTop + plotH - barH}
                  width={colW}
                  height={Math.max(2, barH)}
                  rx={7}
                  fill={focusedCtx ? pal.cool : bandColor(c.value)}
                  opacity={c.subject ? 1 : 0.62}
                />
                {/* Above the bar normally; INSIDE it when the bar is tall
                    enough that the label would leave the plot — the volatility
                    series has six columns at the 100 ceiling. */}
                <text
                  x={colX(i) + colW / 2}
                  y={
                    barH > plotH - 46
                      ? plotTop + plotH - barH + 40
                      : plotTop + plotH - barH - 14
                  }
                  textAnchor="middle"
                  fill={barH > plotH - 46 ? THEME.dark.bg : pal.text}
                  fontSize={c.subject ? 36 : wide ? 30 : 24}
                  fontWeight={700}
                  opacity={Math.min(1, p)}
                >
                  {c.value}
                </text>
                <text
                  x={colX(i) + colW / 2}
                  y={plotTop + plotH + 34}
                  textAnchor="middle"
                  fill={c.subject ? pal.text : pal.muted}
                  fontSize={wide ? 24 : 17}
                  fontWeight={c.subject ? 700 : 600}
                >
                  {c.label}
                </text>
              </g>
            );
          })}

          {/* Which series this is, and how many cycles carry it — the sentence
              the narration is speaking, on the chart. */}
          {focusedCtx ? (
            <text
              x={PAD.l}
              y={PAD.t + 28}
              fill={pal.cool}
              fontSize={27}
              fontWeight={700}
            >
              {focusedCtx.label} · {focusedCtx.rank.cycles} измервания ·{" "}
              {focusedCtx.rank.rank}-о място
            </text>
          ) : null}

          {/* seven-cycle mean */}
          {state.meanLine > 0.01 && !focusedCtx ? (
            <g opacity={state.meanLine}>
              <line
                x1={PAD.l}
                x2={PAD.l + plotW}
                y1={y(F.history.meanRounded)}
                y2={y(F.history.meanRounded)}
                stroke={pal.cool}
                strokeWidth={3}
                strokeDasharray="14 9"
              />
              <text
                x={PAD.l + 14}
                y={y(F.history.meanRounded) - 14}
                fill={pal.cool}
                fontSize={26}
                fontWeight={700}
              >
                средно за седемте — {F.history.meanRounded}
              </text>
            </g>
          ) : null}

          {/* the 06.2024 peak */}
          {state.peakTag > 0.01 && !focusedCtx ? (
            <text
              x={colX(CYCLES.findIndex((c) => c.label === F.history.peakLabel))}
              y={y(F.history.peakScore) - 54}
              fill={pal.text}
              fontSize={26}
              fontWeight={700}
              opacity={state.peakTag}
            >
              най-голямата стойност
            </text>
          ) : null}
        </g>
      ) : null}

      {/* the «Висок» boundary — act 3's whole point. Drawn AFTER the
          columns, like the mean line: the columns are opaque, so a rule label
          painted before them comes out looking clipped rather than layered. */}
      {state.bandRule > 0.01 && !focusedCtx ? (
        <g opacity={state.bandRule * fade}>
          <line
            x1={PAD.l}
            x2={PAD.l + plotW}
            y1={y(F.history.highBandFloor)}
            y2={y(F.history.highBandFloor)}
            stroke={pal.text}
            strokeWidth={3}
            strokeDasharray="10 8"
          />
          <text
            x={PAD.l + plotW - 14}
            y={y(F.history.highBandFloor) - 14}
            textAnchor="end"
            fill={pal.text}
            fontSize={26}
            fontWeight={700}
          >
            граница «висок» — {F.history.highBandFloor}
          </text>
        </g>
      ) : null}

      {/* ── CODA · the context strip ──────────────────────────────────────── */}
      {state.ctx > 0.01 ? (
        <g opacity={state.ctx * fade}>
          <line
            x1={PAD.l}
            x2={PAD.l + plotW}
            y1={plotTop + plotH + CTX_TOP}
            y2={plotTop + plotH + CTX_TOP}
            stroke={pal.rule}
            strokeWidth={1}
          />
          <text
            x={PAD.l}
            y={plotTop + plotH + CTX_TOP + 34}
            fill={pal.muted}
            fontSize={23}
            fontWeight={700}
            letterSpacing={1.5}
          >
            КОНТЕКСТ — НЕ ВЛИЗА В ОЦЕНКАТА (средно {F.context.average})
          </text>
          {CONTEXT.map((c, i) => {
            const p = state[c.key as keyof RiskCanvasState] as number;
            const cw = (plotW - 18 * (CONTEXT.length - 1)) / CONTEXT.length;
            const cx = PAD.l + i * (cw + 18);
            const top = plotTop + plotH + CTX_TOP + 56;
            const trackH = 14;
            return (
              <g key={c.key} opacity={0.35 + 0.65 * Math.min(1, p)}>
                {/* Label and value share a line, so both are sized to fit the
                    narrowest case — «Волатилност» beside «100» overran its
                    column at the first sizing and the two collided. */}
                <text
                  x={cx}
                  y={top + 22}
                  fill={state.ctxFocus === i + 1 ? pal.cool : pal.muted}
                  fontSize={19}
                  fontWeight={600}
                >
                  {c.label}
                </text>
                <text
                  x={cx + cw}
                  y={top + 22}
                  textAnchor="end"
                  fill={pal.text}
                  fontSize={23}
                  fontWeight={700}
                >
                  {Math.round(c.value * Math.min(1, p))}
                </text>
                <rect
                  x={cx}
                  y={top + 36}
                  width={cw}
                  height={trackH}
                  rx={4}
                  fill={pal.rule}
                  opacity={0.55}
                />
                <rect
                  x={cx}
                  y={top + 36}
                  width={Math.max(2, cw * (c.value / 100) * Math.min(1, p))}
                  height={trackH}
                  rx={4}
                  fill={pal.cool}
                />
                {/* Rank UNDER the track, not beside the label: inline it
                    collided with the value on the narrowest column. By the
                    summary scene the strip reads "four near the top, one near
                    the bottom" on its own. */}
                {p > 0.5 ? (
                  <text
                    x={cx}
                    y={top + 72}
                    fill={pal.muted}
                    fontSize={19}
                    fontWeight={600}
                  >
                    {c.rank.rank}-о от {c.rank.cycles}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
};
