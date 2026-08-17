/**
 * Shared card renderer for Наясно social posts. Reuses the site theme
 * colours (src/index.css): dark navy background + coral-peach accent.
 * Crisp Cyrillic via @napi-rs/canvas (image models mangle Cyrillic).
 *
 * Used by the `naiasno-post` skill via scripts/posts/post_tool.ts.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { readdirSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { geoMercator, geoPath } from "d3-geo";

type Ctx = SKRSContext2D;

/** d3-geo's own GeoJSON typings, kept local so cardKit needn't import them. */
type GeoJSONFeatureLike = Parameters<ReturnType<typeof geoPath>>[0];

export const FONT =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", "DejaVu Sans", sans-serif';

export type Theme = "dark" | "light";
type Palette = {
  bg: string;
  bg2: string;
  text: string;
  muted: string;
  accent: string;
  /** Counterpart to `accent` for two-direction charts (falls/decreases). */
  cool: string;
  /** Hairline for axes and rules. */
  rule: string;
};
export const THEME: Record<Theme, Palette> = {
  dark: {
    bg: "#0b1224",
    bg2: "#070b16",
    text: "#f2f5f8",
    muted: "#9aa7bd",
    accent: "#df6b43",
    cool: "#4e9aa6",
    rule: "#22304d",
  },
  light: {
    bg: "#f1ece0",
    bg2: "#e5dbc4",
    text: "#221f1b",
    muted: "#6b6459",
    accent: "#df6b43",
    cool: "#2f7683",
    rule: "#cfc4ac",
  },
};

const roundRect = (
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Wordmark "наясно" with an accent swipe under the "ясно" half. */
export const drawWordmark = (
  ctx: Ctx,
  x: number,
  baseline: number,
  size: number,
  pal: Palette,
) => {
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const naW = ctx.measureText("на").width;
  const yasnoW = ctx.measureText("ясно").width;
  ctx.fillStyle = pal.accent;
  roundRect(
    ctx,
    x + naW - size * 0.03,
    baseline + size * 0.08,
    yasnoW + size * 0.06,
    size * 0.17,
    size * 0.06,
  );
  ctx.fill();
  ctx.fillStyle = pal.text;
  ctx.fillText("наясно", x, baseline);
};

export type StatCardSpec = {
  value: string; // e.g. "2,4 млрд. лв." or "147"
  label: string; // plain-language claim; use \n for line breaks
  source: string; // e.g. "Източник: АОП"
  kicker?: string; // small label above the number
  cta?: string; // default "виж разбивката"
  theme?: Theme; // default "dark"
};

/** 1080×1080 number-led native post card. Returns a PNG buffer. */
export const renderStatCard = (spec: StatCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 150, 60, pal);

  if (spec.kicker) {
    ctx.fillStyle = pal.muted;
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(spec.kicker.toUpperCase(), 80, 400);
  }

  // big value, auto-shrink to fit
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let size = 210;
  do {
    ctx.font = `800 ${size}px ${FONT}`;
    if (ctx.measureText(spec.value).width <= S - 160) break;
    size -= 6;
  } while (size > 70);
  ctx.fillText(spec.value, 80, 560);

  // plain-language label
  ctx.fillStyle = pal.text;
  ctx.font = `600 46px ${FONT}`;
  let ly = 680;
  for (const line of spec.label.split("\n")) {
    ctx.fillText(line, 80, ly);
    ly += 64;
  }

  // footer: source left, CTA + triangle right
  ctx.fillStyle = pal.muted;
  ctx.font = `500 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(spec.source, 80, 990);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.fillText(spec.cta ?? "виж разбивката", S - 120, 990);
  ctx.beginPath();
  ctx.moveTo(S - 104, 970);
  ctx.lineTo(S - 80, 985);
  ctx.lineTo(S - 104, 1000);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

const wrapText = (
  ctx: Ctx,
  text: string,
  weight: number,
  fontPx: number,
  maxW: number,
): string[] => {
  ctx.font = `${weight} ${fontPx}px ${FONT}`;
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(test).width > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
};

export type BarCardSpec = {
  kicker?: string; // small label above the headline
  title: string; // the claim, 1-2 lines (auto-wrapped)
  bars: { label: string; value: number; note?: string }[]; // value = signed %
  unit?: string; // appended to each bar value, default "%"
  legend?: [string, string]; // [positive, negative], e.g. ["поскъпва", "поевтинява"]
  footnote?: string; // methodology caveat, above the footer
  source: string;
  cta?: string;
  theme?: Theme;
  /**
   * Prefix each value with its sign (+/−). Default true — right for signed
   * change data (gainers/losers). Set false for magnitude/distribution bars
   * (shares, money, counts), where a leading "+" reads as a spurious increase.
   */
  signed?: boolean;
  /**
   * Row order by value. Default "desc" (largest magnitude on top) — right for
   * gainers/losers and shares. Use "asc" when a *smaller* value is the good
   * outcome (e.g. polling error / MAE), so the best row leads the chart.
   * Use "none" to keep the caller's order (e.g. a time series by date).
   */
  sort?: "asc" | "desc" | "none";
  /**
   * Decimal places for the bar values. Default 1 (e.g. "10,4%"). Set 0 for
   * whole-number magnitudes like seat counts, where a trailing ",0" reads
   * wrong ("125" not "125,0").
   */
  decimals?: number;
};

/**
 * 1080×1080 ranked-bar infographic. Bars share a left edge and carry their sign
 * in colour (accent = up, cool = down) plus an explicit +/- in the value, so the
 * direction survives greyscale and thumbnail-size rendering.
 */
export const renderBarCard = (spec: BarCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  const unit = spec.unit ?? "%";

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 120, 52, pal);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  let y = 210;
  if (spec.kicker) {
    ctx.fillStyle = pal.accent;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(spec.kicker.toUpperCase(), 80, y);
    y += 58;
  }

  // headline claim — shrink until it fits 2 lines
  let tSize = 60;
  let tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  while (tLines.length > 2 && tSize > 40) {
    tSize -= 4;
    tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  }
  ctx.fillStyle = pal.text;
  for (const line of tLines) {
    ctx.font = `800 ${tSize}px ${FONT}`;
    ctx.fillText(line, 80, y);
    y += tSize * 1.2;
  }

  if (spec.legend) {
    y += 18;
    ctx.font = `600 27px ${FONT}`;
    let lx = 80;
    for (const [i, text] of spec.legend.entries()) {
      ctx.fillStyle = i === 0 ? pal.accent : pal.cool;
      ctx.fillRect(lx, y - 18, 22, 22);
      ctx.fillStyle = pal.muted;
      ctx.fillText(text, lx + 34, y);
      lx += 34 + ctx.measureText(text).width + 56;
    }
    y += 20;
  }

  // Footer is laid out bottom-up: the source line is anchored, the footnote
  // stacks above it, and the rule sits above that — so a footnote that wraps to
  // three lines pushes the rule up instead of overrunning the source.
  const SOURCE_Y = 1030;
  const FOOT_LINE_H = 34;
  const footLines = spec.footnote
    ? wrapText(ctx, spec.footnote, 500, 26, S - 160)
    : [];
  const footBottom = SOURCE_Y - 44; // baseline of the footnote's last line
  const footTop = footBottom - (footLines.length - 1) * FOOT_LINE_H;
  const ruleY = footLines.length ? footTop - 34 : SOURCE_Y - 40;

  // ---- bars: shared left edge, length proportional to |value| ----
  const rows =
    spec.sort === "none"
      ? spec.bars
      : [...spec.bars].sort((a, b) =>
          spec.sort === "asc" ? a.value - b.value : b.value - a.value,
        );
  const GUTTER = 330; // right-aligned label column
  const X0 = 80 + GUTTER + 24; // bars start here
  const signedW = spec.signed ?? true;
  const unitW = spec.unit ?? "%";
  const decW = spec.decimals ?? 1;
  // Reserve room for the value label after the bar — and, where present, the
  // trailing muted note. Sized to the WIDEST value(+note) string rather than a
  // fixed "+10,4%" guess, so long units (" млн. лв.") and per-bar notes don't
  // clip off the right edge.
  const VALUE_W = Math.max(
    130,
    ...rows.map((r) => {
      const num = Math.abs(r.value).toFixed(decW).replace(".", ",");
      const sign = !signedW ? "" : r.value >= 0 ? "+" : "−";
      ctx.font = `700 34px ${FONT}`;
      let vw = 18 + ctx.measureText(`${sign}${num}${unitW}`).width;
      if (r.note) {
        ctx.font = `600 26px ${FONT}`;
        vw += 18 + ctx.measureText(r.note).width;
      }
      return vw + 12; // small right pad
    }),
  );
  const MAX_W = S - 80 - X0 - VALUE_W;
  const peak = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  // `y` has grown with the kicker, a title that wrapped to two lines and the
  // legend, and `ruleY` has risen with the footnote — nothing floors what's left.
  // Past a certain point `step` goes below the readable minimum, and once `avail`
  // turns negative the bar loop walks UPWARD from `by` and draws the rows over the
  // headline. These cards get published, so refuse rather than emit garbage.
  const avail = ruleY - 28 - (y + 40);
  const step = Math.min(64, avail / rows.length);
  if (step < 34)
    throw new Error(
      `renderBarCard: ${rows.length} bars do not fit (step ${step.toFixed(1)}px, need >= 34) — shorten the title/footnote or drop a bar`,
    );
  const barH = Math.max(18, step * 0.52);

  let by = y + 40 + step / 2;
  for (const row of rows) {
    const w = Math.max(4, (Math.abs(row.value) / peak) * MAX_W);
    const up = row.value >= 0;

    ctx.fillStyle = pal.text;
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(row.label, 80 + GUTTER, by);

    ctx.fillStyle = up ? pal.accent : pal.cool;
    // Radius must not exceed HALF THE SHORTER SIDE. A bar far below the peak is
    // narrower than it is tall, and a barH/2 radius on it makes arcTo double
    // back — the stub renders as an S-squiggle, not a short bar.
    roundRect(ctx, X0, by - barH / 2, w, barH, Math.min(barH, w) / 2);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.font = `700 34px ${FONT}`;
    // Signed by default (change data); magnitude/distribution bars pass
    // signed:false so a share like 30,1% doesn't read as "+30,1%".
    const signed = spec.signed ?? true;
    const sign = !signed ? "" : up ? "+" : "−"; // real minus sign, not a hyphen
    const num = Math.abs(row.value)
      .toFixed(spec.decimals ?? 1)
      .replace(".", ",");
    const valText = `${sign}${num}${unit}`;
    ctx.fillText(valText, X0 + w + 18, by);

    // Optional per-bar note (e.g. a secondary unit-rate) — muted, trailing the value.
    if (row.note) {
      const valW = ctx.measureText(valText).width;
      ctx.fillStyle = pal.muted;
      ctx.font = `600 26px ${FONT}`;
      ctx.fillText(row.note, X0 + w + 18 + valW + 18, by);
    }

    by += step;
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (footLines.length) {
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, ruleY);
    ctx.lineTo(S - 80, ruleY);
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.font = `500 26px ${FONT}`;
    let fy = footTop;
    for (const line of footLines) {
      ctx.fillText(line, 80, fy);
      fy += FOOT_LINE_H;
    }
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(spec.source, 80, SOURCE_Y);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж разбивката", S - 108, 1030);
  ctx.beginPath();
  ctx.moveTo(S - 94, 1014);
  ctx.lineTo(S - 74, 1027);
  ctx.lineTo(S - 94, 1040);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

/**
 * Categorical line-series colours, validated against each theme's surface with
 * the data-viz six-checks (lightness band, chroma floor, CVD separation,
 * normal-vision floor, contrast). Slot 0 is the subject series.
 *
 * Both themes sit in the 6-8 CVD floor band on the coral/green pair, which is
 * legal ONLY with secondary encoding — hence `DASH` below and the end labels:
 * every line is identifiable without colour. Do not add a 5th slot by eye; a
 * 5th series should fold into "other" or become a second card.
 *
 * Light slot 0 is a DARKER coral than `pal.accent` on purpose — the brand
 * accent scores 2.82:1 on the cream surface, under the 3:1 floor.
 */
const LINE_SERIES: Record<Theme, string[]> = {
  dark: ["#df6b43", "#1baf7a", "#9085e9"],
  light: ["#c9552d", "#12805a", "#5243bb"],
};
/** Dash pattern per slot — the secondary encoding that carries identity in greyscale. */
const LINE_DASH: number[][] = [[], [18, 10], [4, 9], [26, 12]];

/** Y-axis tick count. Exported alongside `niceAxisStep` so callers can predict the axis. */
export const LINE_TICKS = 5;

/**
 * Snap an axis span to a round tick step (1, 2, 2.5, 5, 10 × 10^k).
 *
 * Exists because an unsnapped top forces the tick LABELS to be rounded to fit,
 * so they name values the gridlines are not at — a 12-top over 5 ticks draws
 * 2.4/4.8/7.2/9.6 and labels them 2/5/7/10. On a published card that is a chart
 * that lies about its own scale, so the step is chosen first and the top is
 * derived from it.
 */
export const niceAxisStep = (span: number): number => {
  const rough = span / LINE_TICKS;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const snapped =
    norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return snapped * mag;
};

export type LineSeries = {
  label: string;
  /**
   * One value per `labels` entry. `null` = not published — the line BREAKS
   * there rather than interpolating, so an unpublished month cannot read as a
   * real reading. Length must equal `labels.length` or the render throws.
   */
  values: (number | null)[];
  /** Thicker stroke + bold end label. Set on the subject series. Default false. */
  emphasis?: boolean;
};

export type LineCardSpec = {
  kicker?: string; // small label above the headline
  title: string; // the claim, 1-2 lines (auto-wrapped)
  labels: string[]; // x tick labels, one per point
  series: LineSeries[]; // 2-4; the 4th renders in muted ink as a reference series
  unit?: string; // appended to end labels + y ticks, default "%"
  /** Vertical annotated rule at this point index (e.g. a policy date). */
  marker?: { at: number; label: string };
  /** Y-axis top. Default: data max rounded up, with headroom. Always starts at 0. */
  yMax?: number;
  decimals?: number; // end-label / tick precision, default 1
  footnote?: string;
  source: string;
  cta?: string;
  theme?: Theme;
};

/**
 * 1080×1080 multi-series time-series card. Identity is carried three ways —
 * colour, dash pattern, and a direct end label — so the chart survives
 * greyscale, colour-blindness and thumbnail size.
 */
export const renderLineCard = (spec: LineCardSpec): Buffer => {
  const S = 1080;
  const theme = spec.theme ?? "dark";
  const pal = THEME[theme];
  const unit = spec.unit ?? "%";
  const dec = spec.decimals ?? 1;
  const N = spec.labels.length;

  if (spec.series.length < 2 || spec.series.length > 4)
    throw new Error(
      `renderLineCard: ${spec.series.length} series — expected 2-4 (fold extras into "other" or split the card)`,
    );
  if (N < 2) throw new Error("renderLineCard: need >= 2 x labels");
  for (const s of spec.series) {
    // A short row would silently render as a series that stops early — read as
    // "stopped reporting" when it is really a caller bug.
    if (s.values.length !== N)
      throw new Error(
        `renderLineCard: series "${s.label}" has ${s.values.length} values but there are ${N} labels`,
      );
    if (!s.values.some((v) => v != null))
      throw new Error(`renderLineCard: series "${s.label}" is entirely null`);
  }

  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 120, 52, pal);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  let y = 210;
  if (spec.kicker) {
    ctx.fillStyle = pal.accent;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(spec.kicker.toUpperCase(), 80, y);
    y += 58;
  }

  let tSize = 60;
  let tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  while (tLines.length > 2 && tSize > 40) {
    tSize -= 4;
    tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  }
  ctx.fillStyle = pal.text;
  for (const line of tLines) {
    ctx.font = `800 ${tSize}px ${FONT}`;
    ctx.fillText(line, 80, y);
    y += tSize * 1.2;
  }

  // The 4th slot is a reference series (an average / benchmark), drawn in muted
  // ink so it reads as context rather than as a competitor.
  const colourOf = (i: number) =>
    i < LINE_SERIES[theme].length ? LINE_SERIES[theme][i] : pal.muted;

  // ---- legend: dash sample + name, wrapping to a second row if needed ----
  y += 20;
  ctx.font = `600 27px ${FONT}`;
  const SAMPLE_W = 40;
  let lx = 80;
  for (const [i, s] of spec.series.entries()) {
    const w = SAMPLE_W + 14 + ctx.measureText(s.label).width;
    if (lx + w > S - 80) {
      lx = 80;
      y += 44;
    }
    ctx.save();
    ctx.strokeStyle = colourOf(i);
    ctx.lineWidth = s.emphasis ? 6 : 4;
    ctx.lineCap = "butt";
    ctx.setLineDash(LINE_DASH[i] ?? []);
    ctx.beginPath();
    ctx.moveTo(lx, y - 9);
    ctx.lineTo(lx + SAMPLE_W, y - 9);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = pal.muted;
    ctx.font = `600 27px ${FONT}`;
    ctx.fillText(s.label, lx + SAMPLE_W + 14, y);
    lx += w + 40;
  }
  y += 16;

  // Footer laid out bottom-up, same contract as renderBarCard.
  const SOURCE_Y = 1030;
  const FOOT_LINE_H = 34;
  const footLines = spec.footnote
    ? wrapText(ctx, spec.footnote, 500, 26, S - 160)
    : [];
  const footBottom = SOURCE_Y - 44;
  const footTop = footBottom - (footLines.length - 1) * FOOT_LINE_H;
  const ruleY = footLines.length ? footTop - 34 : SOURCE_Y - 40;

  // ---- plot geometry ----
  // Right gutter holds the end labels; size it to the widest one actually drawn.
  ctx.font = `700 30px ${FONT}`;
  const END_W =
    18 +
    Math.max(
      ...spec.series.map((s) => {
        const last = [...s.values].reverse().find((v) => v != null) as number;
        return ctx.measureText(`${last.toFixed(dec).replace(".", ",")}${unit}`)
          .width;
      }),
    );
  const PLOT_L = 80 + 92; // y tick labels live in this left gutter
  const PLOT_R = S - 80 - END_W;
  const PLOT_T = y + 34;
  const PLOT_B = ruleY - 34 - 42; // 42px for the x tick label row
  const plotH = PLOT_B - PLOT_T;
  if (plotH < 260)
    throw new Error(
      `renderLineCard: plot area ${plotH.toFixed(0)}px tall (need >= 260) — shorten the title/footnote or drop a legend row`,
    );

  const allVals = spec.series.flatMap((s) =>
    s.values.filter((v): v is number => v != null),
  );
  const rawMax = Math.max(...allVals);
  // Step first, top derived from it — see `niceAxisStep`. An explicit yMax is
  // the caller's business, so it is divided evenly and trusted.
  const step = spec.yMax ? spec.yMax / LINE_TICKS : niceAxisStep(rawMax * 1.05);
  const yMax = spec.yMax ?? Math.ceil((rawMax * 1.02) / step) * step;
  // A step of 2.5 needs one decimal on the tick label; 2 needs none.
  const tickDec = Math.max(0, -Math.floor(Math.log10(step % 1 || 1)));
  const xAt = (i: number) => PLOT_L + (i / (N - 1)) * (PLOT_R - PLOT_L);
  const yAt = (v: number) => PLOT_B - (v / yMax) * plotH;

  // ---- gridlines + y ticks (horizontal only; none vertical on a time axis) ----
  ctx.textBaseline = "middle";
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const gy = yAt(v);
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PLOT_L, gy);
    ctx.lineTo(PLOT_R, gy);
    ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.font = `500 26px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(
      `${v.toFixed(tickDec).replace(".", ",")}${unit}`,
      PLOT_L - 20,
      gy,
    );
  }

  // ---- optional vertical marker ----
  if (spec.marker && spec.marker.at >= 0 && spec.marker.at < N) {
    const mx = xAt(spec.marker.at);
    ctx.save();
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(mx, PLOT_T - 12);
    ctx.lineTo(mx, PLOT_B);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = pal.muted;
    ctx.font = `600 24px ${FONT}`;
    ctx.textBaseline = "alphabetic";
    // Keep the label inside the frame at either edge.
    const mw = ctx.measureText(spec.marker.label).width;
    ctx.textAlign =
      mx + mw / 2 > PLOT_R ? "right" : mx - mw / 2 < 80 ? "left" : "center";
    ctx.fillText(spec.marker.label, mx, PLOT_T - 22);
    ctx.textBaseline = "middle";
  }

  // ---- x tick labels ----
  ctx.fillStyle = pal.muted;
  ctx.font = `500 25px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const [i, lab] of spec.labels.entries()) {
    ctx.fillText(lab, xAt(i), PLOT_B + 40);
  }

  // ---- series: break at null, never interpolate across a gap ----
  const ends: {
    yPix: number;
    text: string;
    colour: string;
    x: number;
    bold: boolean;
  }[] = [];
  for (const [i, s] of spec.series.entries()) {
    const colour = colourOf(i);
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = s.emphasis ? 7 : 4.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(LINE_DASH[i] ?? []);
    let pen = false;
    ctx.beginPath();
    for (let p = 0; p < N; p++) {
      const v = s.values[p];
      if (v == null) {
        pen = false;
        continue;
      }
      if (!pen) {
        ctx.moveTo(xAt(p), yAt(v));
        pen = true;
      } else {
        ctx.lineTo(xAt(p), yAt(v));
      }
    }
    ctx.stroke();
    ctx.restore();

    let lastIdx = -1;
    for (let p = N - 1; p >= 0; p--)
      if (s.values[p] != null) {
        lastIdx = p;
        break;
      }
    const lastVal = s.values[lastIdx] as number;
    const ex = xAt(lastIdx);
    const ey = yAt(lastVal);
    // End dot with a surface-colour ring, so overlapping marks stay separable.
    ctx.beginPath();
    ctx.arc(ex, ey, 11, 0, Math.PI * 2);
    ctx.fillStyle = pal.bg;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, ey, 8, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    ends.push({
      yPix: ey,
      text: `${lastVal.toFixed(dec).replace(".", ",")}${unit}`,
      colour,
      x: ex,
      bold: !!s.emphasis,
    });
  }

  // ---- end labels, nudged apart so two close finishes stay legible ----
  const MIN_GAP = 38;
  ends.sort((a, b) => a.yPix - b.yPix);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].yPix - ends[i - 1].yPix < MIN_GAP)
      ends[i].yPix = ends[i - 1].yPix + MIN_GAP;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const e of ends) {
    // Values wear text ink; the line and dot arriving at them carry identity.
    ctx.fillStyle = pal.text;
    ctx.font = `${e.bold ? 800 : 700} 30px ${FONT}`;
    ctx.fillText(e.text, e.x + 20, e.yPix);
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (footLines.length) {
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, ruleY);
    ctx.lineTo(S - 80, ruleY);
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.font = `500 26px ${FONT}`;
    let fy = footTop;
    for (const line of footLines) {
      ctx.fillText(line, 80, fy);
      fy += FOOT_LINE_H;
    }
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(spec.source, 80, SOURCE_Y);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж разбивката", S - 108, 1030);
  ctx.beginPath();
  ctx.moveTo(S - 94, 1014);
  ctx.lineTo(S - 74, 1027);
  ctx.lineTo(S - 94, 1040);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

export type TableCell = {
  /** Primary text, e.g. "10,6%". */
  value: string;
  /** Secondary muted line under the value, e.g. the winning party. */
  note?: string;
  /**
   * 0..1 shading intensity for the cell pill. Lets a grid read as a heat map
   * without a legend — the eye sees the pattern before it reads the numbers.
   * Omit for an unshaded cell.
   */
  heat?: number;
};

export type TableCardSpec = {
  kicker?: string; // small label above the headline
  title: string; // the claim, 1-2 lines (auto-wrapped)
  /** Header labels. `columns[0]` heads the row-label column. */
  columns: string[];
  rows: { label: string; sub?: string; cells: TableCell[] }[];
  /** Caption under the grid explaining what the shading encodes. */
  heatLabel?: string;
  footnote?: string; // methodology caveat, above the footer
  source: string;
  cta?: string;
  theme?: Theme;
};

/**
 * 1080×1080 small-multiples table. For claims that ARE a grid — a handful of
 * entities across a handful of periods — where a bar chart would have to throw
 * away either the entity or the time axis. Cells carry an optional `heat` so
 * the pattern reads before the numbers do.
 *
 * Deliberately narrow: ≤6 rows and ≤7 columns. Past that the cells fall below
 * readable size at thumbnail scale, so it throws rather than emitting a card
 * nobody can read on a phone.
 */
export const renderTableCard = (spec: TableCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 120, 52, pal);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const dataCols = spec.columns.length - 1;
  if (spec.rows.length > 6 || dataCols > 6 || dataCols < 1)
    throw new Error(
      `renderTableCard: ${spec.rows.length} rows × ${dataCols} data columns is out of range (max 6 × 6) — split the card`,
    );
  for (const r of spec.rows)
    if (r.cells.length !== dataCols)
      throw new Error(
        `renderTableCard: row "${r.label}" has ${r.cells.length} cells, expected ${dataCols}`,
      );

  let y = 210;
  if (spec.kicker) {
    ctx.fillStyle = pal.accent;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(spec.kicker.toUpperCase(), 80, y);
    y += 58;
  }

  let tSize = 60;
  let tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  while (tLines.length > 2 && tSize > 40) {
    tSize -= 4;
    tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  }
  ctx.fillStyle = pal.text;
  for (const line of tLines) {
    ctx.font = `800 ${tSize}px ${FONT}`;
    ctx.fillText(line, 80, y);
    y += tSize * 1.2;
  }

  // Footer laid out bottom-up, as in renderBarCard: the source line is
  // anchored and everything above it stacks upward, so a wrapping footnote
  // pushes the grid up instead of overrunning the source.
  const SOURCE_Y = 1030;
  const FOOT_LINE_H = 34;
  const footLines = spec.footnote
    ? wrapText(ctx, spec.footnote, 500, 26, S - 160)
    : [];
  const footBottom = SOURCE_Y - 44;
  const footTop = footBottom - (footLines.length - 1) * FOOT_LINE_H;
  const ruleY = footLines.length ? footTop - 34 : SOURCE_Y - 40;

  // ---- geometry: row-label column sized to its widest entry, rest split evenly
  const PAD = 80;
  const GRID_W = S - PAD * 2;
  ctx.font = `700 32px ${FONT}`;
  const labelW = Math.min(
    340,
    Math.max(
      170,
      ...spec.rows.map((r) => ctx.measureText(r.label).width + 20),
      ctx.measureText(spec.columns[0]).width + 20,
    ),
  );
  const colW = (GRID_W - labelW) / dataCols;

  const heatCap = spec.heatLabel ? 40 : 0;
  const gridTop = y + 34;
  const gridBottom = ruleY - 24 - heatCap;
  const HEAD_H = 52;
  const avail = gridBottom - gridTop - HEAD_H;
  const rowH = avail / spec.rows.length;
  if (rowH < 76)
    throw new Error(
      `renderTableCard: rows do not fit (${rowH.toFixed(1)}px, need >= 76) — shorten the title/footnote or drop a row`,
    );

  // header
  ctx.fillStyle = pal.muted;
  ctx.font = `700 28px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(spec.columns[0], PAD, gridTop + HEAD_H / 2);
  ctx.textAlign = "center";
  for (let c = 0; c < dataCols; c += 1)
    ctx.fillText(
      spec.columns[c + 1],
      PAD + labelW + colW * (c + 0.5),
      gridTop + HEAD_H / 2,
    );

  // rows
  const accentRGB = hexToRgb(pal.accent);
  for (const [i, row] of spec.rows.entries()) {
    const top = gridTop + HEAD_H + rowH * i;
    const mid = top + rowH / 2;

    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, top);
    ctx.lineTo(S - PAD, top);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = pal.text;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(row.label, PAD, row.sub ? mid - 16 : mid);
    if (row.sub) {
      ctx.fillStyle = pal.muted;
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText(row.sub, PAD, mid + 20);
    }

    ctx.textAlign = "center";
    for (const [c, cell] of row.cells.entries()) {
      const cx = PAD + labelW + colW * (c + 0.5);
      if (cell.heat != null) {
        const a = 0.1 + Math.max(0, Math.min(1, cell.heat)) * 0.75;
        // Sized to its own text, not a fixed guess — a two-part label like
        // "ГЕРБ-СДС 69%" overflows any constant that still looks right for "6%".
        ctx.font = `700 30px ${FONT}`;
        const pillW = Math.min(
          colW - 10,
          Math.max(96, ctx.measureText(cell.value).width + 28),
        );
        ctx.fillStyle = `rgba(${accentRGB}, ${a})`;
        const pillH = cell.note ? 46 : 52;
        roundRect(
          ctx,
          cx - pillW / 2,
          (cell.note ? mid - 18 : mid) - pillH / 2,
          pillW,
          pillH,
          12,
        );
        ctx.fill();
      }
      ctx.fillStyle = pal.text;
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(cell.value, cx, cell.note ? mid - 18 : mid);
      if (cell.note) {
        ctx.fillStyle = pal.muted;
        ctx.font = `600 23px ${FONT}`;
        ctx.fillText(cell.note, cx, mid + 22);
      }
    }
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  if (spec.heatLabel) {
    ctx.fillStyle = pal.muted;
    ctx.font = `500 25px ${FONT}`;
    ctx.fillText(
      spec.heatLabel,
      PAD,
      gridTop + HEAD_H + rowH * spec.rows.length + 34,
    );
  }

  if (footLines.length) {
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, ruleY);
    ctx.lineTo(S - 80, ruleY);
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.font = `500 26px ${FONT}`;
    let fy = footTop;
    for (const line of footLines) {
      ctx.fillText(line, 80, fy);
      fy += FOOT_LINE_H;
    }
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(spec.source, 80, SOURCE_Y);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж разбивката", S - 108, 1030);
  ctx.beginPath();
  ctx.moveTo(S - 94, 1014);
  ctx.lineTo(S - 74, 1027);
  ctx.lineTo(S - 94, 1040);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

/** "#df6b43" -> "223, 107, 67", for rgba() heat fills. */
const hexToRgb = (hex: string): string => {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

export type AnnounceCardSpec = {
  eyebrow?: string; // e.g. "НОВА ФУНКЦИЯ" / "НОВИ ДАННИ"
  title: string; // the feature / dataset name
  subtitle: string; // one line on what it does / what's new (use \n)
  cta?: string; // default "виж"
  theme?: Theme; // default "dark"
};

/** 1080×1080 announcement card (feature launch / new data). PNG buffer. */
export const renderAnnounceCard = (spec: AnnounceCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 150, 60, pal);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  if (spec.eyebrow) {
    ctx.fillStyle = pal.accent;
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(spec.eyebrow.toUpperCase(), 80, 380);
  }

  // title — wrapped, auto-shrunk to fit up to 3 lines
  let titleSize = 100;
  let lines = wrapText(ctx, spec.title, 800, titleSize, S - 160);
  while (lines.length > 3 && titleSize > 56) {
    titleSize -= 6;
    lines = wrapText(ctx, spec.title, 800, titleSize, S - 160);
  }
  ctx.fillStyle = pal.text;
  let ty = 470;
  for (const line of lines) {
    ctx.font = `800 ${titleSize}px ${FONT}`;
    ctx.fillText(line, 80, ty);
    ty += titleSize * 1.15;
  }

  // subtitle
  ctx.fillStyle = pal.muted;
  ctx.font = `500 44px ${FONT}`;
  let sy = ty + 24;
  for (const line of spec.subtitle.split("\n")) {
    ctx.fillText(line, 80, sy);
    sy += 58;
  }

  // footer CTA (right) + triangle
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж", S - 120, 990);
  ctx.beginPath();
  ctx.moveTo(S - 104, 970);
  ctx.lineTo(S - 80, 985);
  ctx.lineTo(S - 104, 1000);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

export type MapPoint = {
  lon: number;
  lat: number;
  /** Drawn beside the dot. Only honoured for a `highlight` point. */
  label?: string;
  /** Larger, ringed and labelled — the one place the post is about. */
  highlight?: boolean;
};

/** Fill tones a choropleth region may take, resolved against the theme. */
export type MapTone = "accent" | "cool" | "muted";

export type MapCardSpec = {
  kicker?: string;
  title: string; // the claim, 1-2 lines (auto-wrapped)
  points?: MapPoint[];
  /**
   * Base-map polygons. Callers pass `loadBulgariaGeo()`; kept a parameter so
   * the renderer stays pure and testable with a stub outline.
   */
  geo?: GeoFeature[];
  /**
   * Choropleth: polygon `nuts4` code → fill tone. Codes absent from the map
   * keep the flat landmass fill, so a partial map degrades to "uncoloured"
   * rather than to a hole. Callers own any rollup (e.g. painting Sofia-city's
   * 24 rayon codes with one município's tone) — this stays geography-agnostic.
   */
  regionTones?: Record<string, MapTone>;
  /** Legend swatches for `regionTones`, drawn as a row under the map. */
  swatches?: { label: string; tone: MapTone }[];
  legend?: string; // one muted line under the map, e.g. "всяка точка = едно селище"
  footnote?: string;
  source: string;
  cta?: string;
  theme?: Theme;
};

/** The slice of GeoJSON the base map needs: polygons, plus the choropleth key. */
export type GeoFeature = {
  type: "Feature";
  properties?: { nuts4?: string };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

/**
 * Municipality polygons for the 31 real oblasts, from `data/maps/regions/`.
 * `32.json` is the admin synthetic holding the abroad "continents" — excluded,
 * or the projection would fit Bulgaria plus Oceania into the frame.
 */
export const loadBulgariaGeo = (rootDir: string): GeoFeature[] => {
  const dir = pathResolve(rootDir, "data/maps/regions");
  const out: GeoFeature[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "32.json") continue;
    const fc = JSON.parse(readFileSync(pathResolve(dir, file), "utf8")) as {
      features: GeoFeature[];
    };
    out.push(...fc.features);
  }
  return out;
};

/**
 * 1080×1080 dot-map infographic: a muted Bulgaria built from municipality
 * polygons, with one dot per place and an optional highlighted, labelled one.
 * Use when the STORY is the geography (how few places, how they cluster) —
 * a bar chart of the same rows would lose exactly that.
 */
export const renderMapCard = (spec: MapCardSpec): Buffer => {
  const S = 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  drawWordmark(ctx, 80, 120, 52, pal);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let y = 210;
  if (spec.kicker) {
    ctx.fillStyle = pal.accent;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(spec.kicker.toUpperCase(), 80, y);
    y += 58;
  }

  let tSize = 60;
  let tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  while (tLines.length > 2 && tSize > 40) {
    tSize -= 4;
    tLines = wrapText(ctx, spec.title, 800, tSize, S - 160);
  }
  ctx.fillStyle = pal.text;
  for (const line of tLines) {
    ctx.font = `800 ${tSize}px ${FONT}`;
    ctx.fillText(line, 80, y);
    y += tSize * 1.2;
  }

  // Footer laid out bottom-up, as in renderBarCard: the source line is
  // anchored and the footnote/legend stack above it, so a wrapping footnote
  // shrinks the map instead of overrunning the source.
  const SOURCE_Y = 1030;
  const FOOT_LINE_H = 34;
  const footLines = spec.footnote
    ? wrapText(ctx, spec.footnote, 500, 26, S - 160)
    : [];
  const footBottom = SOURCE_Y - 44;
  const footTop = footBottom - (footLines.length - 1) * FOOT_LINE_H;
  const ruleY = footLines.length ? footTop - 34 : SOURCE_Y - 40;
  const legendY = spec.legend ? ruleY - 26 : ruleY;
  const swatchY = spec.swatches?.length
    ? legendY - (spec.legend ? 44 : 18)
    : legendY;

  // ---- base map ----
  const mapTop = y + 24;
  const mapBottom = swatchY - 40;
  const avail = mapBottom - mapTop;
  if (avail < 260)
    throw new Error(
      `renderMapCard: map area ${avail.toFixed(0)}px is too short (need >= 260) — shorten the title or footnote`,
    );

  const features = spec.geo ?? [];
  const collection = {
    type: "FeatureCollection" as const,
    features: features as unknown as GeoJSONFeatureLike[],
  };
  const projection = geoMercator().fitExtent(
    [
      [80, mapTop],
      [S - 80, mapTop + avail],
    ],
    collection as never,
  );
  const path = geoPath(projection, ctx as never);

  // Municipality fills read as one landmass with hairline internal borders —
  // enough shape to recognise Bulgaria without competing with the dots.
  //
  // Borders are skipped on polygons too small to hold one: Sofia-city's 24
  // rayons project to a few px each, and at 1px stroke they collapse into a
  // scribble in the middle of the country that reads as a rendering defect.
  // They still get filled, so the landmass stays whole with no hole punched
  // where the capital is.
  const MIN_STROKE_AREA = 400; // px², i.e. roughly 20×20
  const toneFill: Record<MapTone, string> = {
    accent: pal.accent,
    cool: pal.cool,
    muted: pal.muted,
  };
  ctx.strokeStyle = pal.bg2;
  ctx.lineWidth = 1;
  for (const f of features) {
    const [[x0, y0], [x1, y1]] = path.bounds(f as never);
    const tone = spec.regionTones?.[f.properties?.nuts4 ?? ""];
    ctx.fillStyle = tone ? toneFill[tone] : pal.rule;
    ctx.beginPath();
    path(f as never);
    ctx.fill();
    if ((x1 - x0) * (y1 - y0) >= MIN_STROKE_AREA) ctx.stroke();
  }

  // ---- dots ----
  const points = spec.points ?? [];
  const plain = points.filter((p) => !p.highlight);
  const marked = points.filter((p) => p.highlight);

  ctx.fillStyle = pal.text;
  for (const p of plain) {
    const xy = projection([p.lon, p.lat]);
    if (!xy) continue;
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], 7, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of marked) {
    const xy = projection([p.lon, p.lat]);
    if (!xy) continue;
    const [px, py] = xy;
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(px, py, 12, 0, Math.PI * 2);
    ctx.fill();

    if (!p.label) continue;
    // Label flips to the left near the right edge so it never runs off-card.
    ctx.font = `700 34px ${FONT}`;
    const lw = ctx.measureText(p.label).width;
    const right = px + 44 + lw <= S - 80;
    ctx.textAlign = right ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillText(p.label, right ? px + 44 : px - 44, py);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  if (spec.swatches?.length) {
    ctx.font = `600 27px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let sx = 80;
    for (const sw of spec.swatches) {
      ctx.fillStyle = toneFill[sw.tone];
      ctx.fillRect(sx, swatchY - 20, 24, 24);
      ctx.fillStyle = pal.muted;
      ctx.fillText(sw.label, sx + 36, swatchY);
      sx += 36 + ctx.measureText(sw.label).width + 52;
    }
  }

  if (spec.legend) {
    ctx.fillStyle = pal.muted;
    ctx.font = `500 27px ${FONT}`;
    ctx.fillText(spec.legend, 80, legendY);
  }

  if (footLines.length) {
    ctx.strokeStyle = pal.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, ruleY);
    ctx.lineTo(S - 80, ruleY);
    ctx.stroke();

    ctx.fillStyle = pal.muted;
    ctx.font = `500 26px ${FONT}`;
    let fy = footTop;
    for (const line of footLines) {
      ctx.fillText(line, 80, fy);
      fy += FOOT_LINE_H;
    }
  }

  ctx.fillStyle = pal.muted;
  ctx.font = `500 28px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(spec.source, 80, SOURCE_Y);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж разбивката", S - 108, 1030);
  ctx.beginPath();
  ctx.moveTo(S - 94, 1014);
  ctx.lineTo(S - 74, 1027);
  ctx.lineTo(S - 94, 1040);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};

// ---------------------------------------------------------------------------
// Place card — the settlement profile.
//
// Every other renderer here answers ONE question with ONE visual form. This one
// is a composite: a place is not a number, it is a handful of unrelated facts
// that only mean something together. It exists because the settlement-post
// skill specified this card and then, lacking a renderer, fell back to a plain
// bar chart — which published a national school ranking where a place profile
// was wanted.
//
// Two rules the layout enforces rather than documents:
//
//  1. NO DOT-PER-UNIT MARKS. Council seats and cohorts are drawn as proportional
//     bars with the counts written in, so the card renders identically for an
//     11-seat village and a 61-seat Sofia council. A dot row bleeds at both.
//  2. THE MUNICIPALITY BAND IS FENCED. Settlement-grain zones sit above its
//     rule, obshtina-grain cells below, and the band carries its own label and
//     population. Mixing grains is fine; leaving the reader unsure which one
//     they are reading is not.
//
// Every zone is optional — the settlement coverage cliff is real (a matura zone
// exists for 12% of settlements, procurement for 870 nationally), so the grid
// lays out whichever zones are present rather than reserving holes for the rest.
// ---------------------------------------------------------------------------

/** A party/category colour straight out of cik_parties.json, made safe to use.
 *
 *  The hazard this guards is real but narrower than it looks. Canvas silently
 *  keeps the PREVIOUS fillStyle when handed a string it cannot parse — it does
 *  not throw and does not fall back to black — so an unparseable or absent
 *  colour paints a bar in whatever colour was set last, which reads as a real
 *  (wrong) party colour rather than as a fault. Hence: always resolve to
 *  SOMETHING, never pass a raw field through.
 *
 *  What it does NOT guard: `rgba(190, 0, 52)` (МЕЧ's colour, and the shape that
 *  looks malformed) is VALID — CSS Color 4 made rgba() an alias of rgb() with
 *  optional alpha, and @napi-rs/canvas accepts it, verified against the parser.
 *  The rewrite below is belt-and-braces for older parsers, not a bug fix. */
export const safeColor = (c: string | undefined, fallback: string): string => {
  if (!c) return fallback;
  const s = c.trim();
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(s);
  if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^rgba?\(/i.test(s)) return s;
  if (/^[a-z]+$/i.test(s)) return s; // named css colour, e.g. lightslategrey
  return fallback;
};

export type PlaceAgeBand = { label: string; value: number };
export type PlaceShare = { label: string; value: number; color?: string };

/** One "this place against the country" row in the municipality band.
 *
 *  `value` and `reference` must be in the SAME units — the row is drawn on a
 *  scale derived from the pair, so a share against a count silently rescales
 *  into nonsense. Both labels are pre-formatted BG strings; the renderer never
 *  formats a benchmark number, because the caller is the only one that knows
 *  whether it is a percentage, a euro figure or a rate per 1 000. */
export type PlaceBenchmark = {
  label: string;
  value: number;
  valueLabel: string;
  reference: number;
  referenceLabel: string;
  /** Right-hand annotation — a rank ("№1 от 265 общини"), never a verdict. */
  note?: string;
};

export type PlaceCardSpec = {
  /** Discriminator: the presence of `place` routes a spec to this renderer. */
  place: { name: string; context: string };
  /** Settlement-grain zones. Up to four render, in this order. */
  people?: {
    total: string;
    totalLabel: string;
    ageBands: PlaceAgeBand[];
    sex?: {
      male: number;
      female: number;
      maleLabel: string;
      femaleLabel: string;
    };
  };
  vote?: {
    title: string;
    turnoutPct: number;
    turnoutNote: string;
    parties: PlaceShare[];
    note?: string;
  };
  government?: {
    title?: string;
    mayors: {
      role: string;
      name: string;
      note: string;
      pct: number;
      color?: string;
    }[];
    council?: { label: string; seats: PlaceShare[]; majorityLabel: string };
  };
  /** The zone the post is actually about — matura, funds, whatever. */
  focus?: {
    title: string;
    value: string;
    valueNote: string;
    scale?: {
      min: number;
      max: number;
      value: number;
      reference: number;
      valueLabel: string;
      referenceLabel: string;
    };
    caption?: string;
    captionNote?: string;
  };
  /** Municipality-grain band, fenced off below its own rule.
   *
   *  Two forms that STACK under one header — pass either or both. (This said
   *  "mutually exclusive; benchmarks wins" until 2026-08-13, which the code
   *  below has never done; a caller who believed it would drop their cells.)
   *  `cells` is the profile form — up to four standalone figures. `benchmarks`
   *  is the comparison form — full-width rows measuring this municipality
   *  against a national reference. The band header names the grain either way,
   *  which is what lets a municipality-grain KPI sit under a settlement-grain
   *  grid without the reader mistaking one for the other. */
  municipality?: {
    label: string;
    cells?: {
      label: string;
      value?: string;
      note?: string;
      split?: PlaceShare[];
      splitCaption?: [string, string];
    }[];
    benchmarks?: PlaceBenchmark[];
  };
  source: string;
  cta?: string;
  theme?: Theme;
  /** Canvas shape. `square` is 1080×1080; `portrait` is 1080×1350 — Facebook's
   *  tallest uncropped feed ratio (4:5), and the only way to carry a full
   *  four-zone grid AND a band with both cells and benchmarks. Anything taller
   *  than 4:5 gets cropped in feed, so this is a two-value choice, not a knob. */
  format?: "square" | "portrait";
};

const PLACE_PAD = 64;
const PLACE_GAP = 16;
/** Row pitch in the benchmark band. Three lines (label+value, track, captions)
 *  land at +20 / +30 / +62, so 68 leaves the descender clear of the next row.
 *  Four rows plus a 2×2 grid clears the 190px zone floor by 12px — widening
 *  this is what starves the grid, not adding a zone. */
const PLACE_BENCH_H = 68;

/** Thousands-grouped integer, BG convention (non-breaking space). The hero
 *  total arrives pre-formatted as a string, but an age band's value has to stay
 *  a number because it drives the bar width — so the renderer groups it here,
 *  or one card prints "3 477" and "1248" side by side. */
export const placeInt = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Muted text that must not overflow its box — shrinks, then hard-truncates
 *  with an ellipsis. A clipped label reads as a rendering fault; an elided one
 *  reads as an abbreviation. */
const fitText = (
  ctx: Ctx,
  text: string,
  weight: number,
  fontPx: number,
  maxW: number,
  minPx = 18,
): { text: string; px: number } => {
  let px = fontPx;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxW) return { text, px };
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > maxW)
    cut = cut.slice(0, -1);
  return { text: cut + "…", px };
};

/** 1080×1080 settlement profile. Returns a PNG buffer. */
export const renderPlaceCard = (spec: PlaceCardSpec): Buffer => {
  const W = 1080;
  const H = spec.format === "portrait" ? 1350 : 1080;
  const pal = THEME[spec.theme ?? "dark"];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  drawWordmark(ctx, PLACE_PAD, 96, 40, pal);

  // ---- header: place name left, hierarchy right, on one baseline ----
  const headBase = 166;
  ctx.textAlign = "right";
  ctx.fillStyle = pal.muted;
  const ctxFit = fitText(ctx, spec.place.context, 600, 26, 420, 20);
  ctx.font = `600 ${ctxFit.px}px ${FONT}`;
  ctx.fillText(ctxFit.text, W - PLACE_PAD, headBase);
  const ctxW = ctx.measureText(ctxFit.text).width;

  ctx.textAlign = "left";
  ctx.fillStyle = pal.text;
  const nameFit = fitText(
    ctx,
    spec.place.name,
    800,
    58,
    W - PLACE_PAD * 2 - ctxW - 40,
    32,
  );
  ctx.font = `800 ${nameFit.px}px ${FONT}`;
  ctx.fillText(nameFit.text, PLACE_PAD, headBase);

  ctx.fillStyle = pal.rule;
  ctx.fillRect(PLACE_PAD, headBase + 26, W - PLACE_PAD * 2, 1);

  // ---- footer is anchored; everything above flexes into what is left ----
  const SOURCE_Y = H - 48;
  ctx.fillStyle = pal.rule;
  ctx.fillRect(PLACE_PAD, SOURCE_Y - 54, W - PLACE_PAD * 2, 1);
  // The CTA is right-aligned and drawn after, so a long source used to run
  // straight under it and its arrow — silently, since neither is measured
  // against the other. Bound the source by the gap the CTA actually leaves.
  const ctaText = spec.cta ?? "виж мястото";
  ctx.font = `700 25px ${FONT}`;
  const ctaW = ctx.measureText(ctaText).width + 30 + 22;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "left";
  const srcFit = fitText(
    ctx,
    spec.source,
    500,
    25,
    W - PLACE_PAD * 2 - ctaW - 24,
    17,
  );
  ctx.font = `500 ${srcFit.px}px ${FONT}`;
  ctx.fillText(srcFit.text, PLACE_PAD, SOURCE_Y);
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `700 25px ${FONT}`;
  ctx.fillText(ctaText, W - PLACE_PAD - 30, SOURCE_Y);
  ctx.beginPath();
  ctx.moveTo(W - PLACE_PAD - 22, SOURCE_Y - 16);
  ctx.lineTo(W - PLACE_PAD, SOURCE_Y - 5);
  ctx.lineTo(W - PLACE_PAD - 22, SOURCE_Y + 6);
  ctx.closePath();
  ctx.fill();

  // ---- municipality band, laid out bottom-up from the footer rule ----
  const muni = spec.municipality;
  let gridBottom = SOURCE_Y - 54 - 20;
  if (muni) {
    const CELL_H = 132;
    const bench = muni.benchmarks?.slice(0, 4) ?? [];
    // Four is the cap because cells divide the width, not the height: a 4th
    // costs nothing vertically but takes every cell from 316px to 226px inner
    // 186px, which is below what "17 зрелостници · 4,33 страната" needs at its
    // minimum size. Four short labels read fine; four long ones elide.
    const cells = (muni.cells ?? []).slice(0, 4);
    // The two forms stack rather than exclude each other: cells carry the
    // absolute figures ("3,91 млн. €, 44 проекта"), benchmarks carry the same
    // municipality measured against the country. A card that drops the cells to
    // fit the benchmarks loses the magnitudes the ranking is a ranking OF.
    const bandH =
      (cells.length ? CELL_H : 0) +
      (cells.length && bench.length ? PLACE_GAP : 0) +
      bench.length * PLACE_BENCH_H;
    const cellTop = SOURCE_Y - 54 - 22 - bandH;
    const benchTop = cellTop + (cells.length ? CELL_H + PLACE_GAP : 0);
    const cellW = cells.length
      ? (W - PLACE_PAD * 2 - PLACE_GAP * (cells.length - 1)) / cells.length
      : 0;

    ctx.textAlign = "left";
    ctx.fillStyle = pal.muted;
    ctx.font = `700 21px ${FONT}`;
    const labelY = cellTop - 20;
    ctx.fillText(muni.label.toUpperCase(), PLACE_PAD, labelY);
    const lw = ctx.measureText(muni.label.toUpperCase()).width;
    ctx.fillStyle = pal.rule;
    ctx.fillRect(
      PLACE_PAD + lw + 18,
      labelY - 7,
      W - PLACE_PAD * 2 - lw - 18,
      1,
    );

    bench.forEach((b, i) => {
      const ry = benchTop + i * PLACE_BENCH_H;
      const ix = PLACE_PAD;
      const iw = W - PLACE_PAD * 2;
      // Each row carries its own units, so each gets its own scale. The
      // headroom above the larger of the pair keeps the reference tick off the
      // right edge, where it would read as the end of the axis rather than as a
      // benchmark the bar can pass.
      const max = Math.max(b.value, b.reference) * 1.18 || 1;

      ctx.textAlign = "right";
      ctx.fillStyle = pal.accent;
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(b.valueLabel, ix + iw, ry + 20);
      const vlw = ctx.measureText(b.valueLabel).width;
      ctx.textAlign = "left";
      ctx.fillStyle = pal.text;
      const lab = fitText(ctx, b.label, 600, 22, iw - vlw - 24, 16);
      ctx.font = `600 ${lab.px}px ${FONT}`;
      ctx.fillText(lab.text, ix, ry + 20);

      const ty = ry + 30;
      ctx.fillStyle = pal.rule;
      roundRect(ctx, ix, ty, iw, 14, 4);
      ctx.fill();
      ctx.fillStyle = pal.accent;
      roundRect(ctx, ix, ty, Math.max(4, (b.value / max) * iw), 14, 4);
      ctx.fill();
      // The reference is a TICK, not a second bar. Two bars read as two
      // readings of the same thing; a tick reads as the line being measured
      // against — which is the whole claim of a benchmark row.
      ctx.fillStyle = pal.text;
      ctx.fillRect(ix + (b.reference / max) * iw - 1.5, ty - 5, 3, 24);

      ctx.font = `500 18px ${FONT}`;
      ctx.fillStyle = pal.muted;
      const noteW = b.note ? ctx.measureText(b.note).width + 16 : 0;
      ctx.textAlign = "left";
      ctx.fillText(
        fitText(ctx, b.referenceLabel, 500, 18, iw - noteW, 13).text,
        ix,
        ry + 62,
      );
      if (b.note) {
        ctx.textAlign = "right";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 18px ${FONT}`;
        ctx.fillText(b.note, ix + iw, ry + 62);
      }
    });

    cells.forEach((cell, i) => {
      const cx = PLACE_PAD + i * (cellW + PLACE_GAP);
      ctx.fillStyle = pal.bg2;
      roundRect(ctx, cx, cellTop, cellW, CELL_H, 12);
      ctx.fill();

      const ix = cx + 20;
      const iw = cellW - 40;
      ctx.textAlign = "left";
      ctx.fillStyle = pal.muted;
      const cl = fitText(ctx, cell.label, 600, 22, iw, 16);
      ctx.font = `600 ${cl.px}px ${FONT}`;
      ctx.fillText(cl.text, ix, cellTop + 34);

      if (cell.split && cell.split.length) {
        const total = cell.split.reduce((a, s) => a + s.value, 0) || 1;
        let sx = ix;
        const sy = cellTop + 56;
        cell.split.forEach((s, si) => {
          const w = (s.value / total) * iw - (si ? 2 : 0);
          ctx.fillStyle = safeColor(
            s.color,
            si === 0
              ? pal.cool
              : si === cell.split!.length - 1
                ? pal.rule
                : pal.accent,
          );
          ctx.fillRect(sx + (si ? 2 : 0), sy, Math.max(2, w), 18);
          sx += (s.value / total) * iw;
        });
        if (cell.splitCaption) {
          ctx.fillStyle = pal.muted;
          ctx.font = `500 20px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(
            fitText(ctx, cell.splitCaption[0], 500, 20, iw * 0.55, 15).text,
            ix,
            sy + 42,
          );
          ctx.textAlign = "right";
          ctx.fillText(
            fitText(ctx, cell.splitCaption[1], 500, 20, iw * 0.42, 15).text,
            ix + iw,
            sy + 42,
          );
        }
        if (cell.value) {
          ctx.textAlign = "left";
          ctx.fillStyle = pal.accent;
          ctx.font = `800 30px ${FONT}`;
          ctx.fillText(cell.value, ix, cellTop + CELL_H - 16);
        }
      } else {
        ctx.textAlign = "left";
        ctx.fillStyle = pal.text;
        const v = fitText(ctx, cell.value ?? "", 800, 38, iw, 22);
        ctx.font = `800 ${v.px}px ${FONT}`;
        ctx.fillText(v.text, ix, cellTop + 82);
        if (cell.note) {
          ctx.fillStyle = pal.muted;
          const n = fitText(ctx, cell.note, 500, 21, iw, 15);
          ctx.font = `500 ${n.px}px ${FONT}`;
          ctx.fillText(n.text, ix, cellTop + 112);
        }
      }
    });

    gridBottom = labelY - 30;
  }

  // ---- settlement-grain zones, a 2×2 grid of whatever is present ----
  const zones: ((x: number, y: number, w: number, h: number) => void)[] = [];
  /** Minimum readable height for the tallest zone on this card. Starts at the
   *  `people` floor (derived at the guard below) and is raised by any zone that
   *  needs more — see `government`. */
  let zoneFloor = 268;

  const zoneTitle = (t: string, x: number, y: number) => {
    ctx.textAlign = "left";
    ctx.fillStyle = pal.muted;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(t.toUpperCase(), x, y);
  };

  if (spec.people) {
    const p = spec.people;
    zones.push((x, y, w, h) => {
      const ix = x + 22;
      const iw = w - 44;
      zoneTitle("Хората", ix, y + 34);
      ctx.textAlign = "left";
      ctx.fillStyle = pal.text;
      ctx.font = `800 46px ${FONT}`;
      ctx.fillText(p.total, ix, y + 84);
      const tw = ctx.measureText(p.total).width;
      ctx.fillStyle = pal.muted;
      ctx.font = `500 19px ${FONT}`;
      for (const [i, l] of p.totalLabel.split("\n").slice(0, 2).entries())
        ctx.fillText(
          fitText(ctx, l, 500, 19, iw - tw - 16, 14).text,
          ix + tw + 16,
          y + 64 + i * 23,
        );

      const bands = p.ageBands.slice(0, 6);
      const peak = Math.max(...bands.map((b) => b.value), 1);
      const sexH = p.sex ? 52 : 0;
      const top = y + 102;
      const avail = h - (top - y) - 14 - sexH;
      const step = avail / bands.length;
      const LAB_W = 58;
      const VAL_W = 42;
      const barMax = iw - LAB_W - VAL_W - 18;
      // The bar is thinner than the row so consecutive rows never touch, and the
      // label/value sit on the bar's own centre line rather than a second line —
      // five age bands have to fit a quarter of the card.
      const barH = Math.max(9, Math.min(15, step - 9));
      bands.forEach((b, i) => {
        const by = top + step * i + step / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 18px ${FONT}`;
        ctx.fillText(
          fitText(ctx, b.label, 500, 18, LAB_W, 13).text,
          ix,
          by + 6,
        );
        const bw = Math.max(3, (b.value / peak) * barMax);
        ctx.fillStyle = i === bands.length - 1 ? pal.accent : pal.cool;
        roundRect(ctx, ix + LAB_W, by - barH / 2, bw, barH, 3);
        ctx.fill();
        ctx.textAlign = "right";
        ctx.fillStyle = pal.text;
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText(placeInt(b.value), ix + iw, by + 6);
      });

      if (p.sex) {
        const tot = p.sex.male + p.sex.female || 1;
        const sy = y + h - 46;
        ctx.fillStyle = pal.rule;
        ctx.fillRect(ix, sy, iw, 14);
        ctx.fillStyle = pal.cool;
        ctx.fillRect(ix, sy, (p.sex.male / tot) * iw - 2, 14);
        ctx.fillStyle = pal.muted;
        ctx.font = `500 20px ${FONT}`;
        ctx.textAlign = "left";
        ctx.fillText(p.sex.maleLabel, ix, sy + 36);
        ctx.textAlign = "right";
        ctx.fillText(p.sex.femaleLabel, ix + iw, sy + 36);
      }
    });
  }

  if (spec.vote) {
    const v = spec.vote;
    zones.push((x, y, w, h) => {
      const ix = x + 22;
      const iw = w - 44;
      zoneTitle(v.title, ix, y + 34);

      ctx.textAlign = "left";
      ctx.fillStyle = pal.muted;
      ctx.font = `500 19px ${FONT}`;
      ctx.fillText("избирателна активност", ix, y + 62);
      ctx.textAlign = "right";
      ctx.fillStyle = pal.text;
      ctx.font = `800 27px ${FONT}`;
      ctx.fillText(
        `${v.turnoutPct.toFixed(1).replace(".", ",")}%`,
        ix + iw,
        y + 64,
      );
      ctx.fillStyle = pal.rule;
      roundRect(ctx, ix, y + 74, iw, 10, 3);
      ctx.fill();
      ctx.fillStyle = pal.text;
      roundRect(
        ctx,
        ix,
        y + 74,
        Math.max(4, (Math.min(100, v.turnoutPct) / 100) * iw),
        10,
        3,
      );
      ctx.fill();
      ctx.fillStyle = pal.muted;
      ctx.font = `500 18px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(
        fitText(ctx, v.turnoutNote, 500, 18, iw, 13).text,
        ix,
        y + 104,
      );

      // One row per party — label, bar and share share a baseline. A stacked
      // label-over-bar needs ~33px a row and four parties do not fit that in a
      // quarter card; they overprinted each other and the footnote.
      const parties = v.parties.slice(0, 4);
      const peak = Math.max(...parties.map((p) => p.value), 1);
      const noteH = v.note ? 26 : 0;
      const top = y + 116;
      const avail = h - (top - y) - 14 - noteH;
      const step = avail / parties.length;
      const P_LAB = 96;
      const P_VAL = 62;
      const P_GAP = 12; // keeps a long label off its own bar
      const pBarMax = iw - P_LAB - P_GAP - P_VAL - 16;
      const pBarH = Math.max(9, Math.min(16, step - 10));
      parties.forEach((p, i) => {
        const by = top + step * i + step / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = pal.text;
        ctx.font = `600 19px ${FONT}`;
        ctx.fillText(
          fitText(ctx, p.label, 600, 19, P_LAB, 13).text,
          ix,
          by + 6,
        );
        ctx.fillStyle = safeColor(p.color, i === 0 ? pal.accent : pal.cool);
        roundRect(
          ctx,
          ix + P_LAB + P_GAP,
          by - pBarH / 2,
          Math.max(4, (p.value / peak) * pBarMax),
          pBarH,
          3,
        );
        ctx.fill();
        ctx.textAlign = "right";
        ctx.fillStyle = pal.text;
        ctx.font = `700 19px ${FONT}`;
        ctx.fillText(
          `${p.value.toFixed(1).replace(".", ",")}%`,
          ix + iw,
          by + 6,
        );
      });
      if (v.note) {
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 18px ${FONT}`;
        ctx.fillText(
          fitText(ctx, v.note, 500, 18, iw, 13).text,
          ix,
          y + h - 14,
        );
      }
    });
  }

  if (spec.government) {
    const gv = spec.government;
    // The government zone can need MORE than the `people` floor below, and it
    // is the one zone whose need grows with its content. Its mayor rows are
    // laid out top-down at a hard 86px floor (the `Math.max(86, …)` on mayorH)
    // while the council block is pinned to the zone's BOTTOM, so the two
    // collide silently when the zone is short.
    //
    // Derived, both ends measured against the drawing code below: the last
    // mayor's note has its baseline at y + 48 + n×86 and descends ~6px past it,
    // while the council block's topmost ink is its label's ascender at
    // y + h − 89 (baseline y + h − 74). Clearing one past the other needs
    // h >= 143 + n×86 — 315 for the two-mayor case, which is why a settlement
    // with its own кметство plus a council overprinted at the 268 baseline.
    // Declaring it per-card rather than widening the global constant keeps a
    // one-mayor card (229) at the cheaper floor.
    if (gv.council)
      zoneFloor = Math.max(zoneFloor, 143 + Math.min(2, gv.mayors.length) * 86);
    zones.push((x, y, w, h) => {
      const ix = x + 22;
      const iw = w - 44;
      zoneTitle(gv.title ?? "Управлението", ix, y + 34);

      const mayors = gv.mayors.slice(0, 2);
      const councilH = gv.council ? 96 : 0;
      let my = y + 48;
      const mayorH = Math.max(
        86,
        (h - 56 - councilH) / Math.max(1, mayors.length),
      );
      for (const m of mayors) {
        const col = safeColor(m.color, pal.accent);
        ctx.fillStyle = col;
        // The rule marks the mayor's text block, so it is capped at that block's
        // own height rather than stretched to the row pitch. A one-row grid
        // gives the zone ~420px, and an uncapped rule ran the full 254px of it
        // beside three lines of text, reading as a bar with nothing in it.
        roundRect(ctx, ix, my, 4, Math.min(mayorH, 100) - 14, 2);
        ctx.fill();
        const tx = ix + 16;
        const tw = iw - 16;
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 19px ${FONT}`;
        ctx.fillText(fitText(ctx, m.role, 500, 19, tw, 14).text, tx, my + 18);
        ctx.fillStyle = pal.text;
        const nm = fitText(ctx, m.name, 700, 25, tw, 16);
        ctx.font = `700 ${nm.px}px ${FONT}`;
        ctx.fillText(nm.text, tx, my + 46);
        ctx.fillStyle = pal.rule;
        roundRect(ctx, tx, my + 56, tw - 62, 10, 3);
        ctx.fill();
        ctx.fillStyle = col;
        roundRect(
          ctx,
          tx,
          my + 56,
          Math.max(4, (Math.min(100, m.pct) / 100) * (tw - 62)),
          10,
          3,
        );
        ctx.fill();
        ctx.textAlign = "right";
        ctx.fillStyle = pal.text;
        ctx.font = `600 20px ${FONT}`;
        ctx.fillText(
          `${m.pct.toFixed(1).replace(".", ",")}%`,
          tx + tw,
          my + 66,
        );
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 19px ${FONT}`;
        ctx.fillText(fitText(ctx, m.note, 500, 19, tw, 14).text, tx, my + 86);
        my += mayorH;
      }

      const c = gv.council;
      if (c) {
        const total = c.seats.reduce((a, s) => a + s.value, 0) || 1;
        const by = y + h - 62;
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        ctx.font = `500 20px ${FONT}`;
        ctx.fillText(fitText(ctx, c.label, 500, 20, iw, 14).text, ix, by - 12);
        let sx = ix;
        c.seats.forEach((s, i) => {
          const segW = (s.value / total) * iw;
          ctx.fillStyle = safeColor(s.color, i === 0 ? pal.accent : pal.cool);
          ctx.fillRect(
            sx + (i ? 2 : 0),
            by,
            Math.max(2, segW - (i ? 2 : 0)),
            30,
          );
          ctx.fillStyle = pal.text;
          ctx.font = `700 20px ${FONT}`;
          ctx.textAlign = "left";
          if (segW > 34) ctx.fillText(String(s.value), sx + 10, by + 21);
          sx += segW;
        });
        // majority line — the reason a segmented bar beats a dot row: it lands
        // at the same place whether the council has 11 seats or 61.
        ctx.fillStyle = pal.text;
        ctx.fillRect(ix + iw / 2 - 1, by - 5, 2, 40);
        ctx.fillStyle = pal.muted;
        ctx.font = `500 19px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(c.majorityLabel, ix + iw / 2, by + 54);
      }
    });
  }

  if (spec.focus) {
    const f = spec.focus;
    zones.push((x, y, w, h) => {
      const ix = x + 22;
      const iw = w - 44;
      zoneTitle(f.title, ix, y + 34);

      ctx.textAlign = "left";
      ctx.fillStyle = pal.accent;
      const val = fitText(ctx, f.value, 800, 46, iw * 0.42, 28);
      ctx.font = `800 ${val.px}px ${FONT}`;
      ctx.fillText(val.text, ix, y + 86);
      const vw = ctx.measureText(val.text).width;
      ctx.fillStyle = pal.muted;
      ctx.font = `500 19px ${FONT}`;
      for (const [i, l] of f.valueNote.split("\n").slice(0, 2).entries())
        ctx.fillText(
          fitText(ctx, l, 500, 19, iw - vw - 16, 13).text,
          ix + vw + 16,
          y + 66 + i * 23,
        );

      if (f.scale) {
        const s = f.scale;
        const span = s.max - s.min || 1;
        const at = (n: number) =>
          ix + ((Math.min(s.max, Math.max(s.min, n)) - s.min) / span) * iw;
        const ty = y + 142;
        ctx.fillStyle = pal.rule;
        ctx.fillRect(ix, ty - 2, iw, 4);
        const a = at(s.value);
        const b = at(s.reference);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(Math.min(a, b), ty - 2, Math.abs(b - a), 4);
        // reference: hollow, so it reads as a benchmark not a second reading
        ctx.beginPath();
        ctx.arc(b, ty, 11, 0, Math.PI * 2);
        ctx.fillStyle = pal.bg2;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = pal.text;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(a, ty, 11, 0, Math.PI * 2);
        ctx.fillStyle = pal.accent;
        ctx.fill();

        ctx.font = `700 21px ${FONT}`;
        ctx.fillStyle = pal.accent;
        ctx.textAlign = a < iw * 0.5 + ix ? "left" : "right";
        ctx.fillText(s.valueLabel, a + (a < iw * 0.5 + ix ? -8 : 8), ty - 24);
        ctx.font = `500 21px ${FONT}`;
        ctx.fillStyle = pal.muted;
        ctx.textAlign = b > iw * 0.5 + ix ? "right" : "left";
        ctx.fillText(
          s.referenceLabel,
          b + (b > iw * 0.5 + ix ? 8 : -8),
          ty - 24,
        );

        ctx.fillStyle = pal.rule;
        ctx.fillRect(ix, ty + 22, iw, 1);
        ctx.font = `500 18px ${FONT}`;
        ctx.fillStyle = pal.muted;
        const ticks = s.max - s.min;
        for (let t = 0; t <= ticks; t++) {
          const tv = s.min + t;
          ctx.textAlign = t === 0 ? "left" : t === ticks ? "right" : "center";
          ctx.fillText(String(tv), at(tv), ty + 42);
        }
      }

      // With a scale, the caption is the zone's footer and belongs at its foot.
      // Without one there is nothing between the hero and that foot, so the
      // caption rides up under the value instead of leaving a ~150px void that
      // reads as a zone that failed to load.
      let cy = f.scale ? y + h - (f.captionNote ? 46 : 20) : y + 138;
      if (f.caption) {
        ctx.textAlign = "left";
        ctx.fillStyle = pal.text;
        const cap = fitText(ctx, f.caption, 600, 22, iw, 15);
        ctx.font = `600 ${cap.px}px ${FONT}`;
        ctx.fillText(cap.text, ix, cy);
        cy += 28;
      }
      if (f.captionNote) {
        ctx.textAlign = "left";
        ctx.fillStyle = pal.muted;
        const cn = fitText(ctx, f.captionNote, 500, 20, iw, 14);
        ctx.font = `500 ${cn.px}px ${FONT}`;
        ctx.fillText(cn.text, ix, cy);
      }
    });
  }

  if (!zones.length)
    throw new Error(
      "renderPlaceCard: no zones — pass at least one of people/vote/government/focus",
    );

  const gridTop = headBase + 26 + 22;
  const cols = zones.length === 1 ? 1 : 2;
  const rows = Math.ceil(zones.length / cols);
  const zoneW = (W - PLACE_PAD * 2 - PLACE_GAP * (cols - 1)) / cols;
  const zoneH = (gridBottom - gridTop - PLACE_GAP * (rows - 1)) / rows;

  // These cards get published. A zone squeezed below the readable floor draws
  // its rows over the one above it, so refuse rather than emit garbage — same
  // contract as renderBarCard.
  //
  // The 268 baseline is derived, not chosen. The tightest zone is `people`: it
  // spends 168px on the hero, the sex split and its padding, leaving (h - 168)
  // for the age bands, and an 18px label needs ~20px of pitch to clear the row
  // above. Five bands therefore need 168 + 5×20 = 268. The floor read 190 until
  // 2026-08-06, which let a 202px grid through and overprinted the age bands,
  // the party rows and the mayor's note onto the council label — the exact
  // garbling the guard exists to prevent. A six-band card wants ~288 and is
  // still slightly tight here; widen the constant if one ever ships.
  //
  // But 268 alone was ALSO a lie, for the same reason and in the same place: a
  // `government` zone carrying two mayors and a council needs 315, and at 268
  // it printed the second mayor's note across the council label — garbling that
  // this guard passed. Zones that need more than the baseline now say so when
  // they are pushed, so the floor is per-card rather than a single constant.
  if (zoneH < zoneFloor)
    throw new Error(
      `renderPlaceCard: zones do not fit (${zoneH.toFixed(0)}px each, need >= ${zoneFloor}) — drop a zone, shorten the municipality band (a benchmark row costs ${PLACE_BENCH_H}px, a cells row ${132}px), or pass format: "portrait" for 270px more height`,
    );

  zones.forEach((draw, i) => {
    const cx = PLACE_PAD + (i % cols) * (zoneW + PLACE_GAP);
    const cy = gridTop + Math.floor(i / cols) * (zoneH + PLACE_GAP);
    ctx.fillStyle = pal.bg2;
    roundRect(ctx, cx, cy, zoneW, zoneH, 14);
    ctx.fill();
    draw(cx, cy, zoneW, zoneH);
  });

  return canvas.toBuffer("image/png");
};

// ---------------------------------------------------------------------------
// Versus card — two people's declared estate, side by side.
//
// Built for `person-compare-post` (docs/plans/person-compare-post-v1.md). The
// whole point of this renderer is that a comparison card is a SENTENCE about
// two named living people, so the shapes that would make it a false sentence
// are throws rather than warnings.
// ---------------------------------------------------------------------------

/** Which declaration form a side was filed on.
 *
 *  `annual` = Annualy; `inventory` = Entry | Vacate. They are different
 *  instruments, not variants: measured over the whole corpus, an annual carries
 *  1.41 real-estate rows and 93.3% carry an income table, while an
 *  entry/vacate carries 6.27-6.38 real-estate rows and **0%** carry income. A
 *  card mixing them prints "17 имота срещу 0" and "€66 015 срещу —", both of
 *  which are artifacts of the form. */
export type VersusFormClass = "annual" | "inventory";

/** The metric table — the ONE definition of which row is legal on which form,
 *  and which scale band it belongs to. A renderer-side copy of the gate's rule,
 *  deliberately: the gate can be bypassed by a hand-written spec, and this is
 *  the last place before a PNG that a false row can be stopped.
 *
 *  `real_estate` is `inventory`-only, and that is the single most load-bearing
 *  entry here. Measured over the 3,090 person-years where the same person filed
 *  BOTH forms for the same period, the annual shows ZERO properties while the
 *  inventory shows some in 1,568 of them — 50.7%. On an annual card "0 имота"
 *  is a coin flip, published about a named person.
 *
 *  `income` is `annual`-only for the mirror reason: no inventory filing in the
 *  corpus carries an income table, so a "—" there would read as "declared no
 *  income" rather than "this form has no such table".
 *
 *  `credit_limit` is deliberately ABSENT. A declared credit LINE is what the
 *  holder could draw, not money owed (089's own note), and the serving SQL
 *  excludes it from both the asset and the debt arm. Naming it here would let
 *  a caller render it as one or the other.
 *
 *  `band` selects the scale group, and its consequences reach further than the
 *  name suggests. `stock` rows (money held, money owed) share one scale and are
 *  the rows the total band sums; `flow` rows (a year's income) share another and
 *  are NOT in the total — drawing €475,114 of assets and €77,684 of income on one
 *  scale would invite the reader to subtract them. Each band draws its own
 *  caption. Note a one-row band is self-normalising: `income` is the only `flow`
 *  metric today, so the larger side's income bar is always full-length by
 *  construction and carries no information beyond the number beside it. */
export const VERSUS_METRICS = {
  real_estate: { label: "имоти", classes: ["inventory"], band: "stock" },
  bank: {
    label: "банкови сметки",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  cash: {
    label: "пари в брой",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  vehicle: {
    label: "автомобили",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  investment: {
    label: "инвестиции",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  security: {
    label: "ценни книжа",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  receivable: {
    label: "вземания",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  debt: {
    label: "задължения",
    classes: ["annual", "inventory"],
    band: "stock",
  },
  income: { label: "деклариран доход", classes: ["annual"], band: "flow" },
} as const satisfies Record<
  string,
  { label: string; classes: readonly VersusFormClass[]; band: "stock" | "flow" }
>;

/** A key of {@link VERSUS_METRICS}. TypeScript callers (the gate CLI) get a
 *  compile-time check; the runtime throws stay as they are, because the JSON
 *  path through `post_tool.ts` parses an unchecked file. */
export type VersusMetricKey = keyof typeof VERSUS_METRICS;

type VersusMetricDef = {
  label: string;
  classes: readonly VersusFormClass[];
  band: "stock" | "flow";
};

/** Widened lookup into {@link VERSUS_METRICS}.
 *
 *  Two reasons it exists rather than a bare index. The spec reaching the
 *  renderer may come from a JSON file (`post_tool.ts` parses one and casts), so
 *  the key must be treated as `string` at runtime however it is typed at the
 *  boundary — that is what the "unknown metric" throw is for. And `as const`
 *  gives each entry its own literal tuple type, under which
 *  `classes.includes(klass)` narrows the argument to `never` and fails to
 *  compile. */
export const versusMetric = (key: string): VersusMetricDef | undefined =>
  (VERSUS_METRICS as Record<string, VersusMetricDef>)[key];

export type VersusRow = {
  key: VersusMetricKey;
  /** Pre-formatted for display — the caller owns € vs count vs "0". */
  value: string;
  /** Muted second line, e.g. "17 имота". */
  note?: string;
  /** Drives the bar length. Always a magnitude (>= 0), never signed: a debt is
   *  drawn as its size, and the basis line says how it enters the total. */
  magnitude: number;
};

/** A count of declared properties by kind — never a money figure.
 *
 *  It exists because the card DROPS a property table whose prices are substantially
 *  unstated, which would otherwise remove the property information altogether even though
 *  the count and the kind are perfectly well known. Somebody who declared 24 properties
 *  without prices has still declared 24 properties.
 *
 *  `parts` arrives pre-formatted and pre-ordered from `summariseProperties`
 *  (scripts/person/propertyKind.ts), because the Bulgarian counting form („2 апартамента",
 *  never „2 апартаменти") is a property of the label, not of the renderer. */
export type VersusProperties = {
  total: number;
  parts: { label: string; n: number }[];
};

export type VersusSide = {
  /** As the register spells it — never a normalised or shortened form. */
  name: string;
  /** Position/institution AT THE TIME OF FILING, not today's. */
  role?: string;
  /** Human label for the form ("годишна декларация"). */
  formLabel: string;
  formClass: VersusFormClass;
  rows: VersusRow[];
  total: { label: string; value: string };
  /** INVENTORY cards only — see the throw in the renderer. */
  properties?: VersusProperties;
  /** The year THIS side's filing covers. Required when the two sides differ — a card whose
   *  figures come from different years and does not say so per side is unreadable. */
  periodYear?: number;
};

export type VersusCardSpec = {
  /** Discriminator: the presence of `versus` routes a spec to this renderer. */
  versus: { left: VersusSide; right: VersusSide };
  /** The shared year, when both sides filed for the same one. Omit it and pass `kicker`
   *  instead when they did not — a role-matched card compares two people in the same OFFICE
   *  at whatever year each held it, so there is no single year to put in the header. */
  year?: number;
  /** Overrides the default „ДЕКЛАРАЦИИ ЗА <year>" header. */
  kicker?: string;
  /** Shown when the year is not either person's latest — see the gate. */
  yearNote?: string;
  /** e.g. "активи = всичко без задължения и кредитни лимити". */
  basis: string;
  /** The row order, SHARED by both sides. Both sides must carry EXACTLY these
   *  keys — see the throw below for why a missing row may not be inferred. */
  metrics: VersusMetricKey[];
  source: string;
  cta?: string;
  theme?: Theme;
  /** Overrides {@link VERSUS_SEP_DEFAULT}. Whatever it is, its MEASURED width comes out of
   *  both name budgets — see the header layout. */
  separator?: string;
};

/** Canvas width. Module-scope so the derived geometry below cannot drift from
 *  the `W` the renderer uses — it reads this constant rather than its own copy. */
const VERSUS_W = 1080;
/** Canvas height. Portrait only — see renderVersusCard's header for why. */
const VERSUS_H = 1350;
const VERSUS_PAD = 56;
/** Half-width of the centre gutter that holds the metric label. */
const VERSUS_GUT = 134;
/** Outer column reserved for the value text, per side. */
const VERSUS_VALUE_COL = 150;
/** Longest a bar may grow from the gutter edge. */
const VERSUS_BAR_MAX =
  VERSUS_W / 2 - VERSUS_GUT - (VERSUS_PAD + VERSUS_VALUE_COL + 16);
const VERSUS_ROW_H = 76;
const VERSUS_BAND_CAPTION_H = 40;
const VERSUS_TOTAL_H = 90;
/** Bar ink per side, theme-resolved. The light-theme LEFT ink is NOT `pal.accent`:
 *  the brand coral scores 2.81:1 on the cream surface, under WCAG 1.4.11's 3:1 for
 *  graphical objects, and `LINE_SERIES.light[0]` is the darker coral this file
 *  already adopted for exactly that reason. On a two-sided card the asymmetry is
 *  the sharper problem — one named person's bars rendering weaker than the other's
 *  is an editorial thumb on the scale in a renderer whose premise is even-handedness. */
export const VERSUS_SIDE_INK: Record<Theme, [string, string]> = {
  dark: [THEME.dark.accent, THEME.dark.cool],
  light: [LINE_SERIES.light[0], THEME.light.cool],
};

/** Baseline of the rule under the two headers; the content box starts below it. */
const VERSUS_HEAD_RULE_Y = 336;
/** Default separator drawn centred between the two names. Abbreviated („с/у", not „срещу")
 *  because the names are the content: the full word costs ~36px of name budget on a card
 *  whose subjects are routinely spelled with three words each.
 *
 *  Its width is MEASURED and reserved out of each side's budget rather than assumed — see
 *  the header layout. That the current default happens to be narrow enough for an assumed
 *  reserve to work is luck, not design, which is why `separator` is overridable and the
 *  gate test drives a long one. */
export const VERSUS_SEP_DEFAULT = "с/у";
/** Height of the declared-property band, when one is present: the count plus THREE
 *  breakdown lines. Three rather than two because the elision is not free — a filing spread
 *  over seven kinds collapses to „+4 др." at two lines, which is honest but tells the reader
 *  almost nothing, and the card has the room. */
const VERSUS_PROP_H = 124;
/** Line pitch of the wrapped basis block, which grows UPWARD from `basisY`. */
const VERSUS_BASIS_LINE_H = 30;

/**
 * 1080×1350 butterfly comparison of two declarations.
 *
 * PORTRAIT ONLY, with no `format` knob. Facebook's tallest uncropped feed ratio
 * is 4:5, and a versus card carries two headers, up to nine rows, a total band
 * and a basis line — offering a square variant would just move the overflow
 * throw below from "never fires" to "fires on the common case".
 *
 * Position is the identity encoding: a side's bars always grow away from the
 * centre on that side's half, so who-is-who survives greyscale and a thumbnail
 * without depending on the accent/cool hue pair.
 *
 * THE TWO BANDS ARE SCALED SEPARATELY, and that is not a cosmetic choice.
 * `stock` rows (money held, money owed) and `flow` rows (a year's income) are
 * different quantities; drawing €475,114 of assets and €77,684 of income on one
 * scale invites the reader to subtract them. Each band carries its own caption
 * naming what it measures.
 */
export const renderVersusCard = (spec: VersusCardSpec): Buffer => {
  const W = VERSUS_W;
  const H = VERSUS_H;
  const pal = THEME[spec.theme ?? "dark"];
  const { left, right } = spec.versus;

  // ---- validation: every check here is a false sentence, not a layout bug ----
  if (left.formClass !== right.formClass)
    throw new Error(
      `renderVersusCard: sides are on different forms (${left.formClass} vs ` +
        `${right.formClass}). An annual and an entry/vacate filing measure ` +
        `different things — see VERSUS_METRICS.`,
    );
  const klass = left.formClass;
  // The total's label is drawn once, in the centre gutter, so it speaks for both
  // sides. Two different labels would silently publish the left side's basis
  // over the right side's number.
  if (left.total.label !== right.total.label)
    throw new Error(
      `renderVersusCard: sides disagree on the total's label ` +
        `("${left.total.label}" vs "${right.total.label}"); it is rendered once ` +
        `for both.`,
    );

  // Exactly one header source. `year` is validated rather than coerced because a spec parsed
  // from JSON is not type-checked, and `${undefined}` reaches the card as „ДЕКЛАРАЦИИ ЗА NaN".
  if (spec.year !== undefined && !Number.isInteger(spec.year))
    throw new Error(
      `renderVersusCard: \`year\` must be an integer, got ${JSON.stringify(spec.year)}.`,
    );
  if (spec.year !== undefined && spec.kicker)
    throw new Error(
      "renderVersusCard: pass `year` OR `kicker`, not both — the kicker replaces the year " +
        "header, so a spec with both silently drops the year from the card entirely.",
    );
  if (spec.year === undefined && !spec.kicker)
    throw new Error(
      "renderVersusCard: pass `year` (both sides filed for the same one) or `kicker` " +
        "(they did not, e.g. a role-matched card) — a card with no header states no period.",
    );
  // Differing years must be stated PER SIDE. Two figures from different years under one
  // header is the same class of false sentence as two different declaration forms: the
  // reader has no way to tell which number belongs to when.
  const sideYears = [left.periodYear, right.periodYear];
  if (spec.year === undefined && sideYears.some((y) => !Number.isInteger(y)))
    throw new Error(
      "renderVersusCard: a card without a shared `year` needs `periodYear` on BOTH sides, " +
        "or its two figures cannot be dated.",
    );
  if (!spec.metrics.length)
    throw new Error("renderVersusCard: `metrics` is empty");
  const seen = new Set<string>();
  for (const key of spec.metrics) {
    if (seen.has(key))
      throw new Error(`renderVersusCard: duplicate metric "${key}"`);
    seen.add(key);
    const def = versusMetric(key);
    if (!def)
      throw new Error(
        `renderVersusCard: unknown metric "${key}". Known: ` +
          `${Object.keys(VERSUS_METRICS).join(", ")}.`,
      );
    if (!def.classes.includes(klass))
      throw new Error(
        `renderVersusCard: metric "${key}" (${def.label}) is not measurable on ` +
          `a ${klass} filing — legal on: ${def.classes.join(", ")}.`,
      );
  }

  // Both sides must carry EXACTLY the declared metric set. A missing row is
  // never inferred as zero: within one form class the caller is the only party
  // that knows whether a category is absent because nothing was declared or
  // because its query did not ask, and those render identically.
  for (const [who, side] of [
    ["left", left],
    ["right", right],
  ] as const) {
    const keys = side.rows.map((r) => r.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup)
      throw new Error(`renderVersusCard: ${who} side repeats metric "${dup}"`);
    for (const key of spec.metrics)
      if (!keys.includes(key))
        throw new Error(
          `renderVersusCard: ${who} side ("${side.name}") is missing metric ` +
            `"${key}". Emit an explicit zero rather than omitting the row.`,
        );
    for (const key of keys)
      if (!seen.has(key))
        throw new Error(
          `renderVersusCard: ${who} side carries metric "${key}", which is not ` +
            `in \`metrics\` and so would render on one side only.`,
        );
    for (const r of side.rows) {
      if (!(r.magnitude >= 0) || !Number.isFinite(r.magnitude))
        throw new Error(
          `renderVersusCard: ${who} side metric "${r.key}" has a non-finite or ` +
            `negative magnitude (${r.magnitude}); pass the size, not the sign.`,
        );
      // An empty string draws a bar with no number beside it, which reads as a
      // value the card failed to print rather than one nobody declared.
      if (!r.value)
        throw new Error(
          `renderVersusCard: ${who} side metric "${r.key}" has an empty \`value\`; ` +
            `pass "0 €" or "—" explicitly.`,
        );
    }
  }

  // Safe to assert: the loop above threw on any key that does not resolve.
  // A property COUNT is an inventory claim, for the same reason `real_estate` is an
  // inventory metric: on an annual filing „0 имота" is a coin flip — 50.7% of people who
  // filed both forms for one period show zero property on the annual and real property on
  // the inventory. And like every row it is symmetric, so one side cannot show a count while
  // the other silently shows nothing.
  if ((left.properties || right.properties) && klass !== "inventory")
    throw new Error(
      "renderVersusCard: a property count is only meaningful on an inventory filing — " +
        "an annual one is not a property inventory.",
    );
  if (Boolean(left.properties) !== Boolean(right.properties))
    throw new Error(
      "renderVersusCard: one side carries a property count and the other does not; " +
        "pass both (a side with none gets total 0) or neither.",
    );

  const stock = spec.metrics.filter((k) => versusMetric(k)!.band === "stock");
  const flow = spec.metrics.filter((k) => versusMetric(k)!.band === "flow");
  // The total band is drawn from the stock rows, so a flow-only card would take
  // both sides' required, caller-computed `total` and silently not draw it —
  // while `basis`, which exists to explain that very figure, stayed at the foot.
  if (!stock.length)
    throw new Error(
      "renderVersusCard: `metrics` carries no stock row, so the total band — and " +
        "the basis line that explains it — would not render. Add a stock metric.",
    );

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as Ctx;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.bg2);
  g.addColorStop(1, pal.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  drawWordmark(ctx, VERSUS_PAD, 96, 40, pal);

  // ---- kicker: which year, and whether it is anybody's latest ----
  ctx.textAlign = "left";
  ctx.fillStyle = pal.accent;
  ctx.font = `700 28px ${FONT}`;
  // Bounded like every other run on the card. A role-matched header carries a ministry name
  // („ДЕКЛАРАЦИИ КАТО МИНИСТЪР · МИНИСТЕРСТВО НА ВЪТРЕШНИТЕ РАБОТИ") and ran off the canvas
  // unmeasured — the one string here that used to be a bare fillText.
  const kickerFit = fitText(
    ctx,
    (spec.kicker ?? `ДЕКЛАРАЦИИ ЗА ${spec.year}`).toLocaleUpperCase("bg-BG"),
    700,
    28,
    W - VERSUS_PAD * 2,
    17,
  );
  ctx.font = `700 ${kickerFit.px}px ${FONT}`;
  ctx.fillText(kickerFit.text, VERSUS_PAD, 158);

  // ---- the two headers ----
  const cx = W / 2;
  // The separator is centred at cx, so it eats into BOTH name budgets. Measuring
  // it is what stops `fitText` from shrinking a name to exactly the width that
  // collides: the register spells full three-part Bulgarian names (see
  // VersusSide.name), and anything from ~18 Cyrillic characters up overprints it.
  const sep = spec.separator ?? VERSUS_SEP_DEFAULT;
  ctx.font = `600 24px ${FONT}`;
  const sepHalf = ctx.measureText(sep).width / 2;
  const colW = cx - VERSUS_PAD - sepHalf - 20;
  const drawHead = (side: VersusSide, align: "left" | "right") => {
    const x = align === "left" ? VERSUS_PAD : W - VERSUS_PAD;
    ctx.textAlign = align;
    ctx.fillStyle = pal.text;
    const nameFit = fitText(ctx, side.name, 800, 42, colW, 26);
    ctx.font = `800 ${nameFit.px}px ${FONT}`;
    ctx.fillText(nameFit.text, x, 224);
    if (side.role) {
      ctx.fillStyle = pal.muted;
      const roleFit = fitText(ctx, side.role, 500, 25, colW, 17);
      ctx.font = `500 ${roleFit.px}px ${FONT}`;
      ctx.fillText(roleFit.text, x, 258);
    }
    // The form badge is on the card, not in the footnote: it is the single most
    // load-bearing word here, because it says what the numbers below can mean.
    // The year rides IN the badge rather than beside the name: the badge already says what
    // KIND of filing this is, and „кой отчет, от кога" is one thought.
    const badgeText =
      side.periodYear !== undefined && spec.year === undefined
        ? `${side.formLabel} · ${side.periodYear}`
        : side.formLabel;
    ctx.font = `600 23px ${FONT}`;
    const badgeFit = fitText(ctx, badgeText, 600, 23, colW - 28, 16);
    ctx.font = `600 ${badgeFit.px}px ${FONT}`;
    const bw = ctx.measureText(badgeFit.text).width + 28;
    const bx = align === "left" ? x : x - bw;
    ctx.fillStyle = pal.rule;
    roundRect(ctx, bx, 274, bw, 36, 18);
    ctx.fill();
    ctx.fillStyle = pal.muted;
    ctx.textAlign = "left";
    ctx.fillText(badgeFit.text, bx + 14, 299);
  };
  drawHead(left, "left");
  drawHead(right, "right");

  // "срещу" sits on the name baseline, between the two headers.
  ctx.textAlign = "center";
  ctx.fillStyle = pal.muted;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(sep, cx, 224);

  ctx.fillStyle = pal.rule;
  ctx.fillRect(VERSUS_PAD, VERSUS_HEAD_RULE_Y, W - VERSUS_PAD * 2, 1);

  // ---- footer anchored; the bands flex into what is left ----
  const SOURCE_Y = H - 48;
  const basisY = SOURCE_Y - 96;
  // Wrap the basis BEFORE sizing the content box. The block grows upward from
  // `basisY`, so every extra line eats 30px out of the space `need` is checked
  // against — measuring it after the guard is how a 3-line basis printed itself
  // straight through the last metric row's label and both euro values, at exit 0.
  // The other four renderers in this file each derive their footer this way and
  // each carry a comment saying why; this one is on the same contract.
  const basisLines = wrapText(ctx, spec.basis, 500, 24, W - VERSUS_PAD * 2);
  const basisTop = basisY - (basisLines.length - 1) * VERSUS_BASIS_LINE_H;
  const contentTop = VERSUS_HEAD_RULE_Y + 26;
  const contentBottom = basisTop - 34;

  const hasProps = Boolean(left.properties);
  const need =
    (stock.length
      ? VERSUS_BAND_CAPTION_H + stock.length * VERSUS_ROW_H + VERSUS_TOTAL_H
      : 0) +
    (flow.length ? VERSUS_BAND_CAPTION_H + flow.length * VERSUS_ROW_H : 0) +
    (hasProps ? VERSUS_BAND_CAPTION_H + VERSUS_PROP_H : 0);
  if (need > contentBottom - contentTop)
    throw new Error(
      `renderVersusCard: ${spec.metrics.length} metrics need ${need}px but only ` +
        `${contentBottom - contentTop}px are free. Drop a metric, or shorten the ` +
        `basis (${basisLines.length} line(s)) or the header.`,
    );

  // Top-anchored. Centring put half the free space directly under the two names, which left
  // them reading as a header belonging to nothing; the footer is anchored regardless, so the
  // slack is better spent at the bottom, where it is just margin.
  let y =
    contentTop +
    Math.min(24, Math.max(0, (contentBottom - contentTop - need) / 4));

  const drawBandCaption = (text: string) => {
    ctx.textAlign = "center";
    ctx.fillStyle = pal.muted;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(text.toUpperCase(), cx, y + 22);
    y += VERSUS_BAND_CAPTION_H;
  };

  const drawBand = (keys: VersusMetricKey[]) => {
    // One scale per band, shared by both sides, so a row's two bars are
    // comparable to each other AND to every other row in the band.
    const max = Math.max(
      ...keys.flatMap((k) => [
        left.rows.find((r) => r.key === k)!.magnitude,
        right.rows.find((r) => r.key === k)!.magnitude,
      ]),
      0,
    );
    for (const key of keys) {
      const mid = y + VERSUS_ROW_H / 2;
      ctx.textAlign = "center";
      ctx.fillStyle = pal.text;
      const labFit = fitText(
        ctx,
        versusMetric(key)!.label,
        600,
        25,
        VERSUS_GUT * 2 - 16,
        16,
      );
      ctx.font = `600 ${labFit.px}px ${FONT}`;
      ctx.fillText(labFit.text, cx, mid + 8);

      for (const [side, dir] of [
        [left, -1],
        [right, 1],
      ] as const) {
        const row = side.rows.find((r) => r.key === key)!;
        const len = max > 0 ? (row.magnitude / max) * VERSUS_BAR_MAX : 0;
        const barStart = cx + dir * VERSUS_GUT;
        // The branch is on the MAGNITUDE, never on the drawn length. A row worth
        // 0.5% of the band max is ~1px long, and branching on that painted a real
        // declared sum in the same "declared zero" grey as an actual zero — three
        // different states (zero, small, not-on-this-form) reduced to one mark,
        // in the encoding the card leads with. The 6px floor keeps a small real
        // value visible; the gutter has the clearance for it.
        if (row.magnitude > 0) {
          const w = Math.max(6, len);
          ctx.fillStyle =
            VERSUS_SIDE_INK[spec.theme ?? "dark"][dir < 0 ? 0 : 1];
          roundRect(ctx, dir < 0 ? barStart - w : barStart, mid - 13, w, 26, 6);
          ctx.fill();
        } else {
          // A declared zero still gets a mark, so an empty row cannot be read as
          // a row the card forgot to draw — in `muted` rather than `rule`, which
          // is 1.42:1 on the dark surface and so nearly invisible itself.
          ctx.fillStyle = pal.muted;
          ctx.fillRect(dir < 0 ? barStart - 4 : barStart, mid - 13, 4, 26);
        }
        const vx =
          dir < 0
            ? VERSUS_PAD + VERSUS_VALUE_COL
            : W - VERSUS_PAD - VERSUS_VALUE_COL;
        ctx.textAlign = dir < 0 ? "right" : "left";
        ctx.fillStyle = pal.text;
        const vFit = fitText(ctx, row.value, 700, 27, VERSUS_VALUE_COL, 17);
        ctx.font = `700 ${vFit.px}px ${FONT}`;
        ctx.fillText(vFit.text, vx, row.note ? mid + 1 : mid + 9);
        if (row.note) {
          ctx.fillStyle = pal.muted;
          const nFit = fitText(ctx, row.note, 500, 21, VERSUS_VALUE_COL, 14);
          ctx.font = `500 ${nFit.px}px ${FONT}`;
          ctx.fillText(nFit.text, vx, mid + 25);
        }
      }
      y += VERSUS_ROW_H;
    }
  };

  if (stock.length) {
    drawBandCaption("притежавано и дължимо");
    drawBand(stock);

    // ---- total row ----
    ctx.fillStyle = pal.rule;
    ctx.fillRect(VERSUS_PAD, y + 6, W - VERSUS_PAD * 2, 1);
    const tMid = y + VERSUS_TOTAL_H / 2 + 8;
    ctx.textAlign = "center";
    ctx.fillStyle = pal.muted;
    const tlFit = fitText(
      ctx,
      left.total.label.toUpperCase(),
      700,
      22,
      VERSUS_GUT * 2 + 4,
      15,
    );
    ctx.font = `700 ${tlFit.px}px ${FONT}`;
    ctx.fillText(tlFit.text, cx, tMid + 6);
    for (const [side, align] of [
      [left, "right"],
      [right, "left"],
    ] as const) {
      const x = align === "right" ? cx - VERSUS_GUT - 16 : cx + VERSUS_GUT + 16;
      ctx.textAlign = align;
      ctx.fillStyle = pal.text;
      const tFit = fitText(
        ctx,
        side.total.value,
        800,
        44,
        cx - VERSUS_GUT - VERSUS_PAD - 32,
        24,
      );
      ctx.font = `800 ${tFit.px}px ${FONT}`;
      ctx.fillText(tFit.text, x, tMid + 12);
    }
    y += VERSUS_TOTAL_H;
  }

  if (flow.length) {
    drawBandCaption("получено през годината");
    drawBand(flow);
  }

  if (hasProps) {
    // Explicitly „(брой)" in the caption. This band sits under a euro total on a card whose
    // other bands are all money, and the whole reason it exists is that the property MONEY
    // was withheld — so a number here that could be read as euros would be the worst
    // possible misunderstanding.
    drawBandCaption("декларирани имоти (брой)");
    const mid = y + 34;
    for (const [side, dir] of [
      [left, -1],
      [right, 1],
    ] as const) {
      const p = side.properties!;
      const x = dir < 0 ? cx - VERSUS_GUT - 16 : cx + VERSUS_GUT + 16;
      ctx.textAlign = dir < 0 ? "right" : "left";
      ctx.fillStyle = p.total > 0 ? pal.text : pal.muted;
      ctx.font = `800 40px ${FONT}`;
      ctx.fillText(String(p.total), x, mid);

      // The breakdown, stacked under the count. Two lines at most: a filing with six kinds
      // would otherwise push into the basis, and the tail is the least informative part.
      ctx.fillStyle = pal.muted;
      const colWidth = cx - VERSUS_GUT - VERSUS_PAD - 24;
      ctx.font = `500 21px ${FONT}`;
      const wrap = (parts: string[]): string[] => {
        const out: string[] = [];
        let cur = "";
        for (const part of parts) {
          const test = cur ? `${cur} · ${part}` : part;
          if (cur && ctx.measureText(test).width > colWidth) {
            out.push(cur);
            cur = part;
          } else cur = test;
        }
        if (cur) out.push(cur);
        return out;
      };
      // Three lines is the space there is, but a kind that does not fit is NEVER dropped in
      // silence — it is counted into a „+N др." tail. A card that simply stopped listing
      // said one man held three kinds of property when he had declared seven.
      const PROP_LINES = 3;
      const all = p.parts.map((q) => `${q.n} ${q.label}`);
      let lines = wrap(all);
      for (
        let keep = all.length - 1;
        lines.length > PROP_LINES && keep >= 1;
        keep--
      )
        lines = wrap([...all.slice(0, keep), `+${all.length - keep} др.`]);
      let ly = mid + 26;
      for (const line of lines.slice(0, PROP_LINES)) {
        const fit = fitText(ctx, line, 500, 21, colWidth, 15);
        ctx.font = `500 ${fit.px}px ${FONT}`;
        ctx.fillText(fit.text, x, ly);
        ly += 24;
      }
    }
    // The centre gutter names what the two numbers are, as the metric rows do.
    ctx.textAlign = "center";
    ctx.fillStyle = pal.text;
    const pFit = fitText(ctx, "имоти", 600, 25, VERSUS_GUT * 2 - 16, 16);
    ctx.font = `600 ${pFit.px}px ${FONT}`;
    ctx.fillText(pFit.text, cx, mid - 6);
    y += VERSUS_PROP_H;
  }

  // ---- basis + the year caveat, both above the footer rule ----
  ctx.textAlign = "left";
  ctx.fillStyle = pal.muted;
  let by = basisTop;
  ctx.font = `500 24px ${FONT}`;
  for (const line of basisLines) {
    ctx.fillText(line, VERSUS_PAD, by);
    by += VERSUS_BASIS_LINE_H;
  }
  if (spec.yearNote) {
    const noteFit = fitText(
      ctx,
      spec.yearNote,
      600,
      23,
      W - VERSUS_PAD * 2,
      16,
    );
    ctx.fillStyle = pal.accent;
    ctx.font = `600 ${noteFit.px}px ${FONT}`;
    ctx.fillText(noteFit.text, VERSUS_PAD, by);
  }

  ctx.fillStyle = pal.rule;
  ctx.fillRect(VERSUS_PAD, SOURCE_Y - 54, W - VERSUS_PAD * 2, 1);

  const ctaText = spec.cta ?? "виж декларациите";
  ctx.font = `700 25px ${FONT}`;
  const ctaW = ctx.measureText(ctaText).width + 30 + 22;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "left";
  const srcFit = fitText(
    ctx,
    spec.source,
    500,
    25,
    W - VERSUS_PAD * 2 - ctaW - 24,
    17,
  );
  ctx.font = `500 ${srcFit.px}px ${FONT}`;
  ctx.fillText(srcFit.text, VERSUS_PAD, SOURCE_Y);

  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `700 25px ${FONT}`;
  ctx.fillText(ctaText, W - VERSUS_PAD - 30, SOURCE_Y);
  ctx.beginPath();
  ctx.moveTo(W - VERSUS_PAD - 22, SOURCE_Y - 16);
  ctx.lineTo(W - VERSUS_PAD, SOURCE_Y - 5);
  ctx.lineTo(W - VERSUS_PAD - 22, SOURCE_Y + 6);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer("image/png");
};
