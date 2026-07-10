/**
 * Shared card renderer for Наясно social posts. Reuses the site theme
 * colours (src/index.css): dark navy background + coral-peach accent.
 * Crisp Cyrillic via @napi-rs/canvas (image models mangle Cyrillic).
 *
 * Used by the `naiasno-post` skill via scripts/posts/post_tool.ts.
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

type Ctx = SKRSContext2D;

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
  const rows = [...spec.bars].sort((a, b) => b.value - a.value);
  const GUTTER = 330; // right-aligned label column
  const X0 = 80 + GUTTER + 24; // bars start here
  const VALUE_W = 130; // room for "+10,4%" after the bar
  const MAX_W = S - 80 - X0 - VALUE_W;
  const peak = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  const avail = ruleY - 28 - (y + 40);
  const step = Math.min(64, avail / rows.length);
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
    roundRect(ctx, X0, by - barH / 2, w, barH, barH / 2);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.font = `700 34px ${FONT}`;
    const sign = up ? "+" : "−"; // real minus sign, not a hyphen
    const num = Math.abs(row.value).toFixed(1).replace(".", ",");
    ctx.fillText(`${sign}${num}${unit}`, X0 + w + 18, by);

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
