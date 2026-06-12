// Client-side share card for the policy simulator: draws the scenario
// (headline + band, deficit gauge, decile strip, auto-sentence) on a
// 1200×630 canvas in the Наясно brand palette and triggers a PNG download.
// Browser twin of the offline scripts/brand/generate_og_simulator.ts —
// system fonts only (Cyrillic-safe), no external assets.

// Brand tokens mirrored from scripts/posts/cardKit.ts THEME.
const NAVY = "#0b1224";
const CORAL = "#df6b43";
const WHITE = "#f2f5f8";
const MUTED = "#9aa7bd";
const MINT = "#7ae2c0";
const RED = "#e25b5b";

const W = 1200;
const H = 630;

export interface ShareCardData {
  lang: "bg" | "en";
  title: string;
  /** Auto-generated scenario sentence (null → "current law" placeholder). */
  sentence: string | null;
  headlineLabel: string;
  headline: string;
  /** "p5 … p95" uncertainty line (null in static mode). */
  band: string | null;
  citizenLabel: string;
  citizen: string;
  gauge: {
    beforePct: number;
    afterPct: number;
    targetPct: number;
    min: number;
    max: number;
    /** Mission state from the screen (the def mission has a second
     *  condition the gauge values alone can't express). */
    met: boolean;
    labelBefore: string;
    labelAfter: string;
    labelTarget: string;
  };
  /** Mean Δ EUR/month per wage decile, poorest first. */
  deciles: number[];
  decileLabel: string;
  url: string;
}

const font = (px: number, weight = 400): string =>
  `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = probe;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines)
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, "") + "…";
  return lines;
};

const drawCard = (ctx: CanvasRenderingContext2D, d: ShareCardData): void => {
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, H);

  // Wordmark + title
  ctx.fillStyle = CORAL;
  ctx.font = font(34, 700);
  ctx.fillText("Наясно", 64, 84);
  const wmW = ctx.measureText("Наясно").width;
  ctx.fillStyle = MUTED;
  ctx.font = font(22);
  ctx.fillText(d.title, 64 + wmW + 18, 84);
  ctx.strokeStyle = "rgba(154,167,189,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 104);
  ctx.lineTo(W - 64, 104);
  ctx.stroke();

  // Scenario sentence (up to 3 lines)
  ctx.fillStyle = WHITE;
  ctx.font = font(26);
  const sentence = d.sentence ?? "";
  const lines = sentence ? wrapText(ctx, sentence, W - 128, 3) : [];
  lines.forEach((l, i) => ctx.fillText(l, 64, 152 + i * 36));

  // Headline block
  const headY = 296;
  ctx.fillStyle = MUTED;
  ctx.font = font(20);
  ctx.fillText(d.headlineLabel, 64, headY);
  ctx.fillStyle = d.headline.startsWith("−") ? RED : MINT;
  ctx.font = font(64, 700);
  ctx.fillText(d.headline, 64, headY + 70);
  if (d.band) {
    ctx.fillStyle = MUTED;
    ctx.font = font(20);
    ctx.fillText(d.band, 64, headY + 104);
  }

  // Citizen block (right column)
  ctx.fillStyle = MUTED;
  ctx.font = font(20);
  ctx.fillText(d.citizenLabel, 720, headY);
  ctx.fillStyle = WHITE;
  ctx.font = font(44, 700);
  ctx.fillText(d.citizen, 720, headY + 56);

  // Deficit gauge
  const gx = 64;
  const gw = 560;
  const gy = 480;
  const g = d.gauge;
  const span = g.max - g.min || 1;
  const px = (v: number) =>
    gx + Math.max(0, Math.min(1, (v - g.min) / span)) * gw;
  ctx.strokeStyle = "rgba(154,167,189,0.35)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + gw, gy);
  ctx.stroke();
  const met = g.met;
  ctx.strokeStyle = met ? MINT : CORAL;
  ctx.beginPath();
  ctx.moveTo(px(g.beforePct), gy);
  ctx.lineTo(px(g.afterPct), gy);
  ctx.stroke();
  // target tick
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px(g.targetPct), gy - 16);
  ctx.lineTo(px(g.targetPct), gy + 16);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = font(16);
  ctx.textAlign = "center";
  ctx.fillText(g.labelTarget, px(g.targetPct), gy - 24);
  ctx.fillText(g.labelBefore, px(g.beforePct), gy + 38);
  ctx.fillStyle = met ? MINT : CORAL;
  ctx.fillText(g.labelAfter, px(g.afterPct), gy + 60);
  // before/after dots
  ctx.fillStyle = MUTED;
  ctx.beginPath();
  ctx.arc(px(g.beforePct), gy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = met ? MINT : CORAL;
  ctx.beginPath();
  ctx.arc(px(g.afterPct), gy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "left";

  // Decile mini-strip (right column)
  if (d.deciles.length) {
    const dx = 720;
    const dw = 416;
    const dy = 500;
    const maxAbs = Math.max(1, ...d.deciles.map((v) => Math.abs(v)));
    const slot = dw / d.deciles.length;
    ctx.strokeStyle = "rgba(154,167,189,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx + dw, dy);
    ctx.stroke();
    d.deciles.forEach((v, i) => {
      const h = (Math.abs(v) / maxAbs) * 44;
      ctx.fillStyle = v >= 0 ? MINT : RED;
      ctx.fillRect(
        dx + i * slot + slot * 0.2,
        v >= 0 ? dy - h : dy,
        slot * 0.6,
        Math.max(2, h),
      );
    });
    ctx.fillStyle = MUTED;
    ctx.font = font(16);
    ctx.fillText(d.decileLabel, dx, dy + 64);
  }

  // URL footer
  ctx.fillStyle = MUTED;
  ctx.font = font(18);
  ctx.fillText(d.url, 64, H - 28);
};

/** Render the card and trigger a PNG download. Resolves once the download
 *  anchor has been clicked (or rejects if the canvas cannot export). */
export const downloadShareCard = (d: ShareCardData): Promise<void> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("canvas 2d context unavailable"));
      return;
    }
    drawCard(ctx, d);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas export failed"));
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download =
        d.lang === "bg" ? "naiasno-scenarii.png" : "naiasno-scenario.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      resolve();
    }, "image/png");
  });
