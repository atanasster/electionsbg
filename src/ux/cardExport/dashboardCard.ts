import { NationalSummary } from "@/data/dashboard/dashboardTypes";

// 1200x630 is the de-facto standard size for Twitter Summary Large Image,
// Open Graph, Telegram, and LinkedIn previews. Generating at this size means
// social platforms display the card without recompression-driven blur.
const W = 1200;
const H = 630;

const PALETTE = {
  bg: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  accentBg: "#f8fafc",
  green: "#059669",
  red: "#dc2626",
  amber: "#d97706",
  blue: "#2563eb",
  brand: "#0c4587",
};

const FONT_STACK =
  '"Inter", system-ui, -apple-system, "Helvetica Neue", "Segoe UI", "Roboto", sans-serif';

const localizeDate = (electionName: string): string => {
  const [y, m, d] = electionName.split("_");
  return `${d}.${m}.${y}`;
};

const formatPctSigned = (pct: number, digits = 2): string => {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
};

type Tile = {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: string;
  accent?: string;
};

const drawTile = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tile: Tile,
) => {
  // Card background
  ctx.fillStyle = PALETTE.accentBg;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1.5;
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Label (uppercase, muted)
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(tile.label.toUpperCase(), x + 24, y + 24);

  // Optional accent dot (party color)
  let textX = x + 24;
  if (tile.accent) {
    ctx.fillStyle = tile.accent;
    ctx.beginPath();
    ctx.arc(x + 24 + 10, y + 78, 10, 0, Math.PI * 2);
    ctx.fill();
    textX = x + 24 + 28;
  }

  // Main value (large bold) — auto-shrink to fit the tile.
  ctx.fillStyle = PALETTE.text;
  ctx.textBaseline = "middle";
  const valueMaxW = w - (textX - x) - 24;
  let fontSize = 48;
  do {
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    if (ctx.measureText(tile.value).width <= valueMaxW) break;
    fontSize -= 2;
  } while (fontSize > 24);
  ctx.fillText(tile.value, textX, y + 78);

  // Delta line (colored)
  if (tile.delta) {
    ctx.fillStyle = tile.deltaColor || PALETTE.muted;
    ctx.font = `600 22px ${FONT_STACK}`;
    ctx.fillText(tile.delta, x + 24, y + 130);
  }
};

const drawHeader = (
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
) => {
  // Brand bar
  ctx.fillStyle = PALETTE.brand;
  ctx.fillRect(0, 0, W, 6);

  // Title
  ctx.fillStyle = PALETTE.text;
  ctx.font = `800 44px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(title, 60, 56);

  // Subtitle
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `500 24px ${FONT_STACK}`;
  ctx.fillText(subtitle, 60, 110);
};

const drawFooter = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `500 18px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("electionsbg.com", 60, H - 32);

  ctx.textAlign = "right";
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  ctx.fillText(`${dd}.${mm}.${yyyy}`, W - 60, H - 32);

  // Subtle separator
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, H - 56);
  ctx.lineTo(W - 60, H - 56);
  ctx.stroke();
};

export const renderDashboardCard = async (
  summary: NationalSummary,
): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  // Background
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);

  drawHeader(
    ctx,
    `Парламентарни избори ${localizeDate(summary.election)}`,
    `Сравнение с ${summary.priorElection ? localizeDate(summary.priorElection) : "—"}`,
  );

  // Tiles row (120..H-80 area)
  const top = 180;
  const bottom = H - 80;
  const innerH = bottom - top;
  const sideMargin = 60;
  const gap = 20;
  const tileW = (W - 2 * sideMargin - 3 * gap) / 4;
  const tileH = innerH;

  const tiles: Tile[] = [
    {
      label: "избирателна активност",
      value: `${summary.turnout.pct.toFixed(1)}%`,
      delta:
        summary.turnout.deltaPct !== undefined
          ? `${formatPctSigned(summary.turnout.deltaPct)} пр.п.`
          : undefined,
      deltaColor:
        summary.turnout.deltaPct === undefined
          ? PALETTE.muted
          : summary.turnout.deltaPct >= 0
            ? PALETTE.green
            : PALETTE.red,
    },
    {
      label: "най-голям ръст",
      value: summary.topGainer ? summary.topGainer.nickName : "—",
      delta: summary.topGainer
        ? `${formatPctSigned(summary.topGainer.deltaPct)} пр.п.`
        : undefined,
      deltaColor:
        summary.topGainer && summary.topGainer.deltaPct >= 0
          ? PALETTE.green
          : PALETTE.red,
      accent: summary.topGainer?.color,
    },
    {
      label: "най-голям спад",
      value: summary.topLoser ? summary.topLoser.nickName : "—",
      delta: summary.topLoser
        ? `${formatPctSigned(summary.topLoser.deltaPct)} пр.п.`
        : undefined,
      deltaColor:
        summary.topLoser && summary.topLoser.deltaPct >= 0
          ? PALETTE.green
          : PALETTE.red,
      accent: summary.topLoser?.color,
    },
    (() => {
      const pm = summary.paperMachine;
      if (!pm) {
        return {
          label: "хартия / машина",
          value: "—",
        };
      }
      const onlyPaper = pm.machinePct === 0;
      const onlyMachine = pm.paperPct === 0;
      const showDelta =
        !onlyPaper && !onlyMachine && pm.deltaPaperPct !== undefined;
      return {
        label: "хартия / машина",
        value: `${pm.paperPct.toFixed(1)}%`,
        delta: showDelta
          ? `${formatPctSigned(pm.deltaPaperPct as number)} пр.п. хартия`
          : undefined,
        deltaColor: showDelta
          ? (pm.deltaPaperPct as number) >= 0
            ? PALETTE.green
            : PALETTE.red
          : PALETTE.muted,
      };
    })(),
  ];

  tiles.forEach((tile, i) => {
    const x = sideMargin + i * (tileW + gap);
    drawTile(ctx, x, top, tileW, tileH, tile);
  });

  drawFooter(ctx);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      "image/png",
      0.95,
    );
  });
};
