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
   *  Two mutually exclusive forms; `benchmarks` wins when both are passed.
   *  `cells` is the profile form — up to three standalone figures. `benchmarks`
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
  ctx.fillStyle = pal.muted;
  ctx.font = `500 25px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(spec.source, PLACE_PAD, SOURCE_Y);
  ctx.fillStyle = pal.accent;
  ctx.textAlign = "right";
  ctx.font = `700 25px ${FONT}`;
  ctx.fillText(spec.cta ?? "виж мястото", W - PLACE_PAD - 30, SOURCE_Y);
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
    const cells = (muni.cells ?? []).slice(0, 3);
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
  // 268 is derived, not chosen. The tightest zone is `people`: it spends
  // 168px on the hero, the sex split and its padding, leaving (h - 168) for the
  // age bands, and an 18px label needs ~20px of pitch to clear the row above.
  // Five bands therefore need 168 + 5×20 = 268. The floor read 190 until
  // 2026-08-06, which let a 202px grid through and overprinted the age bands,
  // the party rows and the mayor's note onto the council label — the exact
  // garbling the guard exists to prevent. A six-band card wants ~288 and is
  // still slightly tight here; widen the constant if one ever ships.
  if (zoneH < 268)
    throw new Error(
      `renderPlaceCard: zones do not fit (${zoneH.toFixed(0)}px each, need >= 268) — drop a zone, shorten the municipality band (a benchmark row costs ${PLACE_BENCH_H}px, a cells row ${132}px), or pass format: "portrait" for 270px more height`,
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
