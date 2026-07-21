/**
 * OG / share image for the "machine-only voting" article
 * (/articles/2026-07-21-machine-only-sections).
 *
 * 1200×630 Наясно card: dark navy brand frame (wordmark + title) over a light
 * data panel that carries the two signature visuals — the projected 240-seat
 * hemicycle and the per-party seat change (who wins / who loses). Party colours
 * are dark (green ПрБ, navy ГЕРБ), so they render on the light panel, not the
 * navy. Seats come from the SAME shared Hare-Niemeyer allocator the article
 * uses, at the default scenario (machine-only above 200 voters, 0% drop-off).
 *
 * Run:  node_modules/.bin/tsx scripts/brand/generate_machine_only_og.ts
 * Out:  public/og/machine-only.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { allocateSeats } from "@/screens/utils/seatAllocation";
import scenario from "@/screens/scenarios/machineOnlyScenario.data.json";
import { THEME, drawWordmark, FONT } from "../posts/cardKit";

type Ctx = SKRSContext2D;
const W = 1200;
const H = 630;
const ROOT = process.cwd();
const OUT = resolve(ROOT, "public/og/machine-only.png");

const GAIN = "#1f9d5b"; // green for + seats
const LOSS = "#df6b43"; // coral for − seats (brand accent)

// ---- data: default scenario seats via the shared allocator -----------------

type Party = { partyNum: number; nickName: string; color: string };
const DATA = scenario as unknown as {
  elections: {
    parties: Party[];
    byThreshold: Record<
      string,
      {
        rows: {
          partyNum: number;
          base: number;
          reassignable: number;
          actualPaper: number;
          invalidRecoverable: number;
        }[];
      }
    >;
  }[];
};
const election = DATA.elections[DATA.elections.length - 1];
const meta = new Map(election.parties.map((p) => [p.partyNum, p]));
const slice = election.byThreshold["200"];
const actualVotes = slice.rows.map((r) => ({
  partyNum: r.partyNum,
  totalVotes: r.base + r.actualPaper,
}));
const modelVotes = slice.rows.map((r) => ({
  partyNum: r.partyNum,
  totalVotes: r.base + r.reassignable + r.invalidRecoverable,
}));
const aSeat = new Map(
  allocateSeats(actualVotes, 4).map((r) => [r.partyNum, r.seats]),
);
const rows = allocateSeats(modelVotes, 4)
  .filter((r) => r.seats > 0 || (aSeat.get(r.partyNum) ?? 0) > 0)
  .map((r) => ({
    nick: meta.get(r.partyNum)?.nickName ?? String(r.partyNum),
    color: meta.get(r.partyNum)?.color ?? "#888",
    actual: aSeat.get(r.partyNum) ?? 0,
    model: r.seats,
  }))
  .map((r) => ({ ...r, delta: r.model - r.actual }))
  .sort((a, b) => b.delta - a.delta);

// ---- hemicycle geometry ----------------------------------------------------

type Seat = { x: number; y: number; ang: number };
const hemicycle = (n: number): Seat[] => {
  const nRows = 7;
  const r0 = 0.42;
  const radii = Array.from(
    { length: nRows },
    (_, i) => r0 + ((1 - r0) * i) / (nRows - 1),
  );
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((n * r) / sum)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (
    let i = counts.length - 1;
    diff !== 0;
    i = i === 0 ? counts.length - 1 : i - 1
  ) {
    if (diff > 0) {
      counts[i]++;
      diff--;
    } else if (counts[i] > 1) {
      counts[i]--;
      diff++;
    }
  }
  const seats: Seat[] = [];
  radii.forEach((r, ri) => {
    const c = counts[ri];
    for (let s = 0; s < c; s++) {
      const ang = c === 1 ? Math.PI / 2 : Math.PI - (Math.PI * s) / (c - 1);
      seats.push({ x: r * Math.cos(ang), y: -r * Math.sin(ang), ang });
    }
  });
  return seats.sort((a, b) => b.ang - a.ang);
};

// seat colours left→right by descending model seats (parliament order)
const seatColors: string[] = [];
[...rows]
  .sort((a, b) => b.model - a.model)
  .forEach((r) => {
    for (let i = 0; i < r.model; i++) seatColors.push(r.color);
  });

// ---- draw ------------------------------------------------------------------

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

const pal = THEME.dark;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d") as unknown as Ctx;

// background
const g = ctx.createLinearGradient(0, 0, 0, H);
g.addColorStop(0, pal.bg2);
g.addColorStop(1, pal.bg);
ctx.fillStyle = g;
ctx.fillRect(0, 0, W, H);

// header
drawWordmark(ctx, 60, 92, 42, pal);
ctx.fillStyle = pal.muted;
ctx.font = `700 22px ${FONT}`;
ctx.textAlign = "right";
ctx.textBaseline = "alphabetic";
ctx.fillText("ИЗБОРИ · СЦЕНАРИЙ", W - 60, 90);

// title (colour the verbs)
ctx.textAlign = "left";
ctx.font = `800 46px ${FONT}`;
ctx.fillStyle = pal.text;
ctx.fillText("Гласуване само с машини:", 60, 170);
let tx = 60;
const seg = (text: string, color: string) => {
  ctx.fillStyle = color;
  ctx.fillText(text, tx, 226);
  tx += ctx.measureText(text).width;
};
seg("кой ", pal.text);
seg("печели", GAIN);
seg(" и кой ", pal.text);
seg("губи", LOSS);

// light data panel
const PX = 40;
const PY = 262;
const PW = W - 2 * PX;
const PH = 316;
ctx.fillStyle = "#f4efe4";
roundRect(ctx, PX, PY, PW, PH, 24);
ctx.fill();
ctx.strokeStyle = "rgba(0,0,0,0.08)";
ctx.lineWidth = 1;
roundRect(ctx, PX, PY, PW, PH, 24);
ctx.stroke();

const inkDark = "#221f1b";
const inkMuted = "#6b6459";

// -- left: hemicycle --
const cx = PX + 300;
const cy = PY + 232;
const Rx = 250;
const Ry = 190;
const seats = hemicycle(240);
for (let i = 0; i < 240; i++) {
  const s = seats[i];
  ctx.beginPath();
  ctx.arc(cx + s.x * Rx, cy + s.y * Ry, 5.4, 0, Math.PI * 2);
  ctx.fillStyle = seatColors[i] ?? "#cbb";
  ctx.fill();
}
ctx.fillStyle = inkDark;
ctx.font = `800 40px ${FONT}`;
ctx.textAlign = "center";
ctx.fillText("240", cx, cy - 6);
ctx.fillStyle = inkMuted;
ctx.font = `600 20px ${FONT}`;
ctx.fillText("Парламент по модела · мнозинство 121", cx, PY + 288);

// -- right: seat change rows --
const rx = PX + 620;
let ry = PY + 54;
ctx.textAlign = "left";
ctx.fillStyle = inkDark;
ctx.font = `800 26px ${FONT}`;
ctx.fillText("Промяна в мандатите", rx, ry);
ry += 40;
const rowH = 44;
for (const r of rows) {
  // party dot
  ctx.beginPath();
  ctx.arc(rx + 9, ry - 8, 9, 0, Math.PI * 2);
  ctx.fillStyle = r.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // name
  ctx.fillStyle = inkDark;
  ctx.font = `700 24px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(r.nick, rx + 30, ry);
  // actual → model (arrow drawn, not a glyph — the system font lacks U+2192)
  const ax = rx + 250;
  ctx.textAlign = "left";
  ctx.fillStyle = inkMuted;
  ctx.font = `600 21px ${FONT}`;
  ctx.fillText(String(r.actual), ax, ry);
  const aw = ctx.measureText(String(r.actual)).width;
  const arX = ax + aw + 9;
  const arY = ry - 7;
  ctx.strokeStyle = inkMuted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(arX, arY);
  ctx.lineTo(arX + 17, arY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(arX + 17, arY);
  ctx.lineTo(arX + 11, arY - 4);
  ctx.lineTo(arX + 11, arY + 4);
  ctx.closePath();
  ctx.fillStyle = inkMuted;
  ctx.fill();
  ctx.fillStyle = inkDark;
  ctx.font = `700 21px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(String(r.model), arX + 26, ry);
  // delta
  ctx.fillStyle = r.delta > 0 ? GAIN : r.delta < 0 ? LOSS : inkMuted;
  ctx.font = `800 26px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${r.delta > 0 ? "+" : ""}${r.delta}`, rx + 430, ry);
  ry += rowH;
}

// footer
ctx.fillStyle = pal.muted;
ctx.font = `600 20px ${FONT}`;
ctx.textAlign = "left";
ctx.fillText("electionsbg.com", 60, H - 24);
ctx.textAlign = "right";
ctx.fillText("аналитичен сценарий, не прогноза", W - 60, H - 24);

mkdirSync(resolve(ROOT, "public/og"), { recursive: true });
writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`wrote ${OUT}`);
