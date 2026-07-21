/**
 * Custom 1080×1080 Наясно social card for the machine-only article.
 *
 * Two metrics per party — the vote-share change (реален → модел) AND the seats
 * (реален → модел + Δ) — ordered from most to least seats, which renderBarCard
 * (one value per bar) can't show. Dark navy brand frame over a light data panel
 * (party colours are dark). Numbers come from the SAME shared allocator the
 * article uses, at the default scenario (>200 voters, 0% drop-off).
 *
 * Run:  node_modules/.bin/tsx scripts/posts/generate_machine_only_card.ts
 * Out:  brand/posts/2026-07-21-machine-only.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { allocateSeats } from "@/screens/utils/seatAllocation";
import scenario from "@/screens/scenarios/machineOnlyScenario.data.json";
import { THEME, drawWordmark, FONT } from "./cardKit";

type Ctx = SKRSContext2D;
const S = 1080;
const ROOT = process.cwd();
const OUT = resolve(ROOT, "brand/posts/2026-07-21-machine-only.png");
const GAIN = "#1f9d5b";
const LOSS = "#df6b43";

// ---- data: default scenario, votes + seats, ordered by model seats ----------

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
const slice = election.byThreshold["200"];
const actualVotes = slice.rows.map((r) => ({
  partyNum: r.partyNum,
  totalVotes: r.base + r.actualPaper,
}));
const modelVotes = slice.rows.map((r) => ({
  partyNum: r.partyNum,
  totalVotes: r.base + r.reassignable + r.invalidRecoverable,
}));
const aTot = actualVotes.reduce((s, v) => s + v.totalVotes, 0);
const mTot = modelVotes.reduce((s, v) => s + v.totalVotes, 0);
const aPct = new Map(
  actualVotes.map((v) => [v.partyNum, (100 * v.totalVotes) / aTot]),
);
const mPct = new Map(
  modelVotes.map((v) => [v.partyNum, (100 * v.totalVotes) / mTot]),
);
const aSeat = new Map(
  allocateSeats(actualVotes, 4).map((r) => [r.partyNum, r.seats]),
);
const mSeat = new Map(
  allocateSeats(modelVotes, 4).map((r) => [r.partyNum, r.seats]),
);

const rows = election.parties
  .map((p) => ({
    nick: p.nickName,
    color: p.color,
    aPct: aPct.get(p.partyNum) ?? 0,
    mPct: mPct.get(p.partyNum) ?? 0,
    aSeat: aSeat.get(p.partyNum) ?? 0,
    mSeat: mSeat.get(p.partyNum) ?? 0,
  }))
  .filter((r) => r.mSeat > 0 || r.aSeat > 0)
  .sort((a, b) => b.mSeat - a.mSeat); // most → least seats

// ---- draw ------------------------------------------------------------------

const pal = THEME.dark;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext("2d") as unknown as Ctx;

const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// a right-pointing arrow drawn as geometry (the system font lacks U+2192)
const arrow = (x: number, y: number, color: string) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 22, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 22, y);
  ctx.lineTo(x + 15, y - 5);
  ctx.lineTo(x + 15, y + 5);
  ctx.closePath();
  ctx.fill();
};

// background
const g = ctx.createLinearGradient(0, 0, 0, S);
g.addColorStop(0, pal.bg2);
g.addColorStop(1, pal.bg);
ctx.fillStyle = g;
ctx.fillRect(0, 0, S, S);

// header
drawWordmark(ctx, 80, 132, 52, pal);
ctx.fillStyle = pal.accent;
ctx.font = `700 27px ${FONT}`;
ctx.textAlign = "left";
ctx.textBaseline = "alphabetic";
ctx.fillText("СЦЕНАРИЙ · САМО МАШИННО ГЛАСУВАНЕ", 80, 214);

// title (colour the verbs)
ctx.font = `800 66px ${FONT}`;
let tx = 80;
const seg = (text: string, color: string) => {
  ctx.fillStyle = color;
  ctx.fillText(text, tx, 290);
  tx += ctx.measureText(text).width;
};
seg("Кой ", pal.text);
seg("печели", GAIN);
seg(" и кой ", pal.text);
seg("губи", LOSS);

ctx.fillStyle = pal.muted;
ctx.font = `500 29px ${FONT}`;
ctx.fillText("Промяна в гласовете и мандатите спрямо реалния вот", 80, 338);

// light data panel
const PX = 60;
const PY = 372;
const PW = S - 2 * PX;
const PH = 508;
ctx.fillStyle = "#f4efe4";
roundRect(PX, PY, PW, PH, 28);
ctx.fill();

const inkDark = "#221f1b";
const inkMuted = "#6b6459";

// column anchors
const nameX = PX + 40;
const votesA = PX + 360; // "реален" gласове start
const seatsA = PX + 660; // "реален" seats start
const deltaX = PX + PW - 40; // right edge (seat Δ)

// header row
const hy = PY + 56;
ctx.fillStyle = inkMuted;
ctx.font = `700 24px ${FONT}`;
ctx.textAlign = "left";
ctx.fillText("ПАРТИЯ", nameX, hy);
ctx.fillText("ГЛАСОВЕ", votesA, hy);
ctx.fillText("МАНДАТИ", seatsA, hy);
// header rule
ctx.strokeStyle = "rgba(0,0,0,0.12)";
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.moveTo(PX + 40, hy + 20);
ctx.lineTo(PX + PW - 40, hy + 20);
ctx.stroke();

// rows
const rowH = (PH - 110) / rows.length;
let ry = hy + 20 + rowH / 2 + 8;
const fmtPct = (v: number) => v.toFixed(1).replace(".", ",");
for (const r of rows) {
  // party dot + name
  ctx.beginPath();
  ctx.arc(nameX + 11, ry - 9, 11, 0, Math.PI * 2);
  ctx.fillStyle = r.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = inkDark;
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(r.nick, nameX + 34, ry);

  // votes: реален → модел %
  ctx.fillStyle = inkMuted;
  ctx.font = `600 27px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(fmtPct(r.aPct), votesA, ry);
  const vw = ctx.measureText(fmtPct(r.aPct)).width;
  arrow(votesA + vw + 12, ry - 9, inkMuted);
  ctx.fillStyle = inkDark;
  ctx.font = `700 27px ${FONT}`;
  ctx.fillText(`${fmtPct(r.mPct)}%`, votesA + vw + 46, ry);

  // seats: реален → модел
  ctx.fillStyle = inkMuted;
  ctx.font = `600 27px ${FONT}`;
  ctx.fillText(String(r.aSeat), seatsA, ry);
  const sw = ctx.measureText(String(r.aSeat)).width;
  arrow(seatsA + sw + 12, ry - 9, inkMuted);
  ctx.fillStyle = inkDark;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(String(r.mSeat), seatsA + sw + 46, ry);

  // seat delta (right-aligned, coloured)
  const d = r.mSeat - r.aSeat;
  ctx.fillStyle = d > 0 ? GAIN : d < 0 ? LOSS : inkMuted;
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${d > 0 ? "+" : ""}${d}`, deltaX, ry);

  ry += rowH;
}

// footnote + source + cta
ctx.textAlign = "left";
ctx.fillStyle = pal.muted;
ctx.font = `500 25px ${FONT}`;
ctx.fillText(
  "Модел: хартията отпада в секциите над 200 избиратели, без спад в активността.",
  80,
  936,
);
ctx.font = `500 27px ${FONT}`;
ctx.fillText("Източник: ЦИК; изчисления на electionsbg.com", 80, 1006);

ctx.fillStyle = pal.accent;
ctx.textAlign = "right";
ctx.font = `600 28px ${FONT}`;
ctx.fillText("виж целия сценарий", S - 108, 1006);
ctx.beginPath();
ctx.moveTo(S - 94, 990);
ctx.lineTo(S - 74, 1003);
ctx.lineTo(S - 94, 1016);
ctx.closePath();
ctx.fill();

mkdirSync(resolve(ROOT, "brand/posts"), { recursive: true });
writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`wrote ${OUT}`);
