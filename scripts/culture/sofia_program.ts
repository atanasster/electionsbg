// Generator: parse the Столична програма „Култура" класиране PDF → the Sofia half
// of data/culture/municipal.json (per-направление funded-project breakdown), and
// key the читалища national context beside it. This is Phase-3 tile 15: the
// municipal + читалища streams the /culture view otherwise only shows as one line
// on the scale tile, broken out with real detail.
//
// The класиране is published as a per-year PDF by Дирекция „Култура" (Творчески
// съвет main session). It's a Google-Docs-style export with a clean text layer,
// so pdftotext -layout parses it directly. The download is a JWT-redirect behind a
// self-signed TLS chain, so — following the "annual list = manual" convention —
// fetch the PDF once by hand and drop it at raw_data/culture/sofia_spk_<year>.pdf:
//
//   url='https://kultura.sofia.bg/inc/service/service-download-file.php?identifier=1c1b255a-6de4-45c5-a408-5c9d5a43845b&control=20260116142749'
//   html=$(curl -sk "$url"); link=$(echo "$html" | grep -oE 'redirectLink = "[^"]+"' | sed -E 's/.*"([^"]+)"/\1/')
//   curl -sk "https://kultura.sofia.bg/inc/service/service-download-file.php$link" -o raw_data/culture/sofia_spk_2026.pdf
//
// The источник page (with the ТУК link) is kultura.sofia.bg/currentNews-127-content.html.
// Re-run:  npx tsx scripts/culture/sofia_program.ts

import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { BGN_PER_EUR } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW = path.resolve(__dirname, "../../raw_data/culture");
const OUT = path.resolve(__dirname, "../../data/culture/municipal.json");

const YEAR = 2026;

// --- Sofia класиране PDF → per-направление aggregates ------------------------

interface Direction {
  n: number;
  bg: string;
  count: number;
  eur: number;
}

// A number token with single-space thousands grouping only (never spanning the
// wide layout gap between the лв. and евро columns) + optional . or , decimals.
const NUM = /\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;
const toNum = (s: string) => Number(s.replace(/ /g, "").replace(",", "."));

// The last number token appearing before `word` on a line — the euro (or лв.)
// amount sits immediately to the left of its unit label.
const lastBefore = (line: string, word: string): number | null => {
  const i = line.indexOf(word);
  if (i < 0) return null;
  const toks = line.slice(0, i).match(NUM);
  return toks && toks.length ? toNum(toks[toks.length - 1]) : null;
};

const SECTION = /Направление\s*[№:\s]*?(\d+)/;
const NAME = /Направление\s*[№:\s]*?\d+\s*[:.]?\s*(.+)/;
const STRIP = /^[„""“”',:.№\s]+|[„""“”',:.№\s]+$/g;

// PDF headers shout some names in all-caps (,„МУЗИКА") — restore sentence case.
const normName = (s: string): string =>
  s && s === s.toLocaleUpperCase("bg-BG")
    ? s.charAt(0) + s.slice(1).toLocaleLowerCase("bg-BG")
    : s;

const parseSofia = (): {
  directions: Direction[];
  fundedCount: number;
  totalEur: number;
} => {
  const pdf = path.join(RAW, `sofia_spk_${YEAR}.pdf`);
  if (!fs.existsSync(pdf))
    throw new Error(
      `missing ${pdf} — download the класиране PDF first (see header)`,
    );
  const txtPath = path.join(os.tmpdir(), `sofia_spk_${YEAR}.txt`);
  execSync(`pdftotext -layout "${pdf}" "${txtPath}"`);
  const lines = fs.readFileSync(txtPath, "utf8").split("\n");

  const byN = new Map<number, Direction>();
  const order: number[] = [];
  let cur: number | null = null;
  let fundedCount = 0;

  for (const ln of lines) {
    const sm = ln.match(SECTION);
    if (sm && !ln.includes("Предложено") && !ln.includes("Кратко")) {
      cur = Number(sm[1]);
      if (!byN.has(cur)) {
        const nm = ln.match(NAME);
        byN.set(cur, {
          n: cur,
          bg: normName((nm ? nm[1] : "").replace(STRIP, "")),
          count: 0,
          eur: 0,
        });
        order.push(cur);
      }
      continue;
    }
    if (ln.includes("Предложено")) {
      let eur = lastBefore(ln, "евро");
      if (eur == null) {
        const bgn = lastBefore(ln, "лв");
        eur = bgn == null ? 0 : Math.round((bgn / BGN_PER_EUR) * 100) / 100;
      }
      fundedCount += 1;
      if (cur != null) {
        const d = byN.get(cur)!;
        d.count += 1;
        d.eur += eur;
      }
    }
  }

  const directions = order
    .map((n) => {
      const d = byN.get(n)!;
      return { ...d, eur: Math.round(d.eur) };
    })
    .sort((a, b) => b.eur - a.eur);
  const totalEur = directions.reduce((s, d) => s + d.eur, 0);
  return { directions, fundedCount, totalEur };
};

// --- Assemble + self-verify --------------------------------------------------

const sofiaParsed = parseSofia();

// Self-verify: the per-направление counts must reconcile to the funded total, and
// the money must land in the plausible band for a municipal main session — else a
// layout drift has silently corrupted the parse, so refuse to write.
const sumCounts = sofiaParsed.directions.reduce((s, d) => s + d.count, 0);
if (sumCounts !== sofiaParsed.fundedCount)
  throw new Error(
    `direction counts (${sumCounts}) ≠ funded total (${sofiaParsed.fundedCount})`,
  );
if (sofiaParsed.fundedCount < 50 || sofiaParsed.fundedCount > 400)
  throw new Error(`implausible funded count ${sofiaParsed.fundedCount}`);
if (sofiaParsed.totalEur < 200_000 || sofiaParsed.totalEur > 5_000_000)
  throw new Error(`implausible total €${sofiaParsed.totalEur}`);

const out = {
  generatedAt: new Date().toISOString(),
  sofia: {
    year: YEAR,
    program: "Столична програма „Култура“",
    council: "Творчески съвет",
    decision: "Решение № 36, Протокол № 54 / 15.01.2026",
    appliedCount: 455, // whole-programme applications, 2026 (Столична община)
    fundedCount: sofiaParsed.fundedCount,
    totalEur: sofiaParsed.totalEur,
    directions: sofiaParsed.directions,
    sourceUrl: "https://kultura.sofia.bg/currentNews-127-content.html",
    note: {
      bg: "Основна сесия на Творческия съвет; програмата има и други модули (Мобилност, Млад артист, Лятна програма), затова целият годишен бюджет е по-голям. Общинско финансиране, извън държавния бюджет.",
      en: "Main Creative-Council session; the programme also has other modules (Mobility, Young Artist, Summer), so the full annual budget is larger. Municipal funding, outside the state budget.",
    },
  },
  // читалища national context — a few authoritative annual figures (hand-keyed,
  // like funding_streams.json). Per-oblast money isn't cleanly published; the
  // national numbers + the announced-vs-cut story are the honest breakdown.
  chitalishta: {
    year: YEAR,
    subsidizedPositions: 7856, // +63 vs 2025
    positionsYoY: 63,
    totalEur: 88_300_000, // ~€11 240/position after the budget revision
    announcedEur: 98_000_000, // originally announced (~€12 475/position)
    cutEur: 9_700_000, // announced − actual, the 2026 читалища cut
    sourceBg: "Проектобюджет 2026 (МК) · bTV · НСОРБ",
    sourceEn: "2026 draft budget (МК) · bTV · NSORB",
    note: {
      bg: "3 000+ народни читалища; държавата плаща субсидирана численост по единен разходен стандарт през общинските бюджети. За 2026 г. сумата е с ~9,7 млн. евро под първоначално обявената.",
      en: "3,000+ community centres; the state funds subsidised staffing on a per-unit standard through municipal budgets. For 2026 the amount is ~€9.7M below what was first announced.",
    },
  },
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} — Sofia: ${out.sofia.fundedCount}/${out.sofia.appliedCount} funded, €${out.sofia.totalEur.toLocaleString()} across ${out.sofia.directions.length} направления`,
);
