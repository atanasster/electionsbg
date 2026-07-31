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
    roundRect(ctx, X0, by - barH / 2, w, barH, barH / 2);
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

export type MapCardSpec = {
  kicker?: string;
  title: string; // the claim, 1-2 lines (auto-wrapped)
  points: MapPoint[];
  /**
   * Base-map polygons. Callers pass `loadBulgariaGeo()`; kept a parameter so
   * the renderer stays pure and testable with a stub outline.
   */
  geo?: GeoFeature[];
  legend?: string; // one muted line under the map, e.g. "всяка точка = едно селище"
  footnote?: string;
  source: string;
  cta?: string;
  theme?: Theme;
};

/** The slice of GeoJSON the base map needs — polygons only, no properties. */
export type GeoFeature = {
  type: "Feature";
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

  // ---- base map ----
  const mapTop = y + 24;
  const mapBottom = legendY - 40;
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
  ctx.fillStyle = pal.rule;
  ctx.strokeStyle = pal.bg2;
  ctx.lineWidth = 1;
  for (const f of features) {
    const [[x0, y0], [x1, y1]] = path.bounds(f as never);
    ctx.beginPath();
    path(f as never);
    ctx.fill();
    if ((x1 - x0) * (y1 - y0) >= MIN_STROKE_AREA) ctx.stroke();
  }

  // ---- dots ----
  const plain = spec.points.filter((p) => !p.highlight);
  const marked = spec.points.filter((p) => p.highlight);

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
