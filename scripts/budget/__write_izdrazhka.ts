// Reproducible build of data/budget/izdrazhka_by_institution.json — the
// per-first-level-spending-unit "издръжка" (operating cost) series that feeds
// the "Издръжка по ведомства" heatmap on /indicators/budgets and the AI chat
// `institutionMaintenance` tool.
//
// издръжка is a residual reconstructed from each year's State Budget Law:
//   издръжка = Текущи разходи − Персонал − Субсидии − Лихви − трансфери за домакинства
// (Asen Vasilev's "Бюджет 2026: Перо по перо" method). We read the same cached
// law HTML the budget ingest uses (raw_data/budget/law-<year>.html.gz, one per
// year in LAW_DV_MATERIALS) and reuse parseLawHtml — so this stays in lockstep
// with the appropriations the rest of the pipeline emits. Mid-year revisions
// carry no per-unit breakdown, so figures are as adopted.
//
// 2026 is a draft (no adopted law / not cached), so its column is read from the
// committed seed data/budget/izdrazhka_2026_draft.json (parsed off the РМС
// draft PDF). Once the real ЗДБРБ 2026 is added to LAW_DV_MATERIALS and cached,
// it parses like every other year and the seed can be dropped.
//
// Run after a budget-law refresh (the budget_law watcher → update-budget):
//   tsx scripts/budget/__write_izdrazhka.ts

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import { LAW_DV_MATERIALS } from "./fetch_sources";
import { flatLines } from "../lib/html";

// 1 EUR = 1.95583 BGN — the budget laws 2018–2025 are in thousand leva; 2026
// (the draft seed) is already in thousand euro.
const BGN_PER_EUR = 1.95583;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/budget");
const OUT = path.resolve(
  __dirname,
  "../../data/budget/izdrazhka_by_institution.json",
);
const SEED = path.resolve(
  __dirname,
  "../../data/budget/izdrazhka_2026_draft.json",
);
const DRAFT_YEAR = 2026;

// Full spending-unit name → short, year-stable label. Ordered: the first
// matching fragment wins, so the ДФ "Земеделие" guard must precede the generic
// "земеделие" (МЗХ), and renames collapse onto one label across years
// (икономиката[, инвестициите] и индустрията; иновациите и растежа / и
// дигиталната трансформация).
const CANON: [RegExp, string][] = [
  [/регионалното развит/, "МРРБ"],
  [/отбраната/, "Отбрана"],
  [/културата/, "Култура"],
  [/външните работи/, "Външни работи"],
  [/фонд.{0,4}земеделие/, "ДФ Земеделие"],
  [/държавен резерв/, "Държавен резерв"],
  [/земеделие/, "Земеделие"],
  [/финансите/, "Финанси"],
  [/вътрешните работи/, "МВР"],
  [/правосъдието/, "Правосъдие"],
  [/труда и социалната/, "Труд и соц. политика"],
  [/здравеопазването/, "Здравеопазване"],
  [/образованието/, "Образование"],
  [/околната среда/, "Околна среда"],
  [/икономик/, "Икономика"],
  [/иноваци/, "Иновации/МИДТ"],
  [/дигиталната трансформац/, "Иновации/МИДТ"],
  [/енергетиката/, "Енергетика"],
  [/туризма/, "Туризъм"],
  [/транспорт/, "Транспорт"],
  [/младежта и спорт/, "Младеж и спорт"],
  [/електронното управление/, "Електронно управл."],
  [/национална сигурност/, "ДАНС"],
  [/разузнаване/, "Разузнаване"],
  [/народното събрание/, "Народно събрание"],
  [/сметната палата/, "Сметна палата"],
  [/президент/, "Президент"],
  [/конституционния съд/, "Конституционен съд"],
  [/омбудсмана/, "Омбудсман"],
  [/съдебната власт/, "Съдебна власт"],
  [/статистическ/, "НСИ"],
  [/избирателна комисия/, "ЦИК"],
  [/финансов надзор/, "Комисия фин. надзор"],
  [/регулиране на съобщенията/, "КРС"],
  [/енергийно и водно регулиране/, "КЕВР"],
  [/защита на конкуренцията/, "КЗК"],
  [/ядрено регулиране/, "АЯР"],
  [/национална служба за охрана/, "НСО"],
  [/технически операции/, "ДА Тех. операции"],
  [/защита на личните данни/, "КЗЛД"],
  [/защита от дискриминация/, "КЗД"],
  [/отнемане на незаконно/, "КОНПИ"],
  [/сигурността на информацията/, "ДКСИ"],
  [/разкриване на документите/, "КОМДОС"],
  [/конфликт на интереси/, "КОНПИ"],
  [/противодействие на корупцията/, "КОНПИ"],
  [/агенция.{0,8}електронно управление/, "ДАЕУ"],
  [/председателство на съвета/, "Бълг. председ. ЕС"],
];

const canon = (unitName: string): string => {
  const n = unitName
    .toLowerCase()
    .replace(/[„""'`]/g, "")
    .replace(/["«»]/g, "")
    .replace(/министерството на/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [rx, label] of CANON) if (rx.test(n)) return label;
  return unitName.trim();
};

const cachedHtml = (year: number): string =>
  zlib
    .gunzipSync(fs.readFileSync(path.join(RAW_DIR, `law-${year}.html.gz`)))
    .toString("utf8");

// "843 564,0" / "1 221 324" → number (thousand leva, as printed). Pure-number
// lines only, so a row code ("1.2.1.") is never mistaken for a value.
//
// DIVERGENCE — do not "de-duplicate" this with __write_judiciary.ts's asNum.
// This one's integer branch requires >= 3 digits (`[\d ]{2,}`) because the
// издръжка tables it scans are dense with single- and double-digit row codes
// that must NOT parse as values. The judiciary parser's accepts any length,
// because a ЗДБРБ `Резерв` line can legitimately read `900` and an ИВСС line can
// be under 100 хил. лв. Collapsing them into one helper silently breaks
// whichever caller loses its rule.
const asNum = (s: string): number | null => {
  if (/^-?\d[\d ]*,\d+$/.test(s) || /^-?\d[\d ]{2,}$/.test(s))
    return parseFloat(s.replace(/ /g, "").replace(",", "."));
  return null;
};

// Within a unit block, the value on the first numeric line after a label.
const valAfter = (lines: string[], labelRe: RegExp): number => {
  for (let i = 0; i < lines.length; i++) {
    if (labelRe.test(lines[i])) {
      for (let t = 1; t <= 3 && i + t < lines.length; t++) {
        const v = asNum(lines[i + t]);
        if (v !== null) return v;
      }
      return 0;
    }
  }
  return 0;
};

// Residual издръжка (thousand leva) for one unit's expenditure block, or null
// when the unit has no Текущи разходи line (transfer-only shells):
//   издръжка = Текущи − Персонал − Субсидии − Лихви − трансфери за домакинствата
const residualLevaK = (unitBlock: string[]): number | null => {
  const eIdx = unitBlock.indexOf("РАЗХОДИ");
  const exp = eIdx >= 0 ? unitBlock.slice(eIdx) : unitBlock;
  let tek: number | null = null;
  for (let i = 0; i < exp.length && tek === null; i++)
    if (/^Текущи разходи$/.test(exp[i]))
      for (let t = 1; t <= 3 && i + t < exp.length; t++) {
        const v = asNum(exp[i + t]);
        if (v !== null) {
          tek = v;
          break;
        }
      }
  if (tek === null) return null;
  const residual =
    tek -
    valAfter(exp, /^Персонал$/) -
    valAfter(exp, /^Субсидии и други текущи трансфери$/) -
    valAfter(exp, /^Лихви$/) -
    valAfter(exp, /домакинствата$/);
  // Издръжка can't be negative — a negative means a transfer-dominated unit's
  // (e.g. МТСП) household-transfer line was over-captured for that year's table
  // layout; drop the year rather than display a nonsensical value.
  return residual < 0 ? null : residual;
};

// Parse one year's law into [unitName, издръжка EUR thousands] pairs.
const parseYear = (html: string, year: number): [string, number][] => {
  const lines = flatLines(html);
  const hdr = new RegExp(`Приема бюджета на (.+?) за ${year} г`);
  const heads: { i: number; name: string }[] = [];
  lines.forEach((l, i) => {
    const m = hdr.exec(l);
    if (m) heads.push({ i, name: m[1].trim() });
  });
  const out: [string, number][] = [];
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    let block = lines.slice(h.i, end);
    const cut = block.findIndex((l, j) => j > 0 && /^\(2\)\s/.test(l));
    if (cut > 0) block = block.slice(0, cut);
    const leva = residualLevaK(block);
    if (leva !== null) out.push([h.name, Math.round(leva / BGN_PER_EUR)]);
  });
  return out;
};

const main = (): void => {
  // label → (year → EUR thousands). First occurrence per (label, year) wins —
  // guards against the ВСС-project vs МС-opinion twin tables for чл. 1 / чл. 2.
  const byLabel = new Map<string, Map<number, number>>();
  const lawYears: number[] = [];

  for (const yearStr of Object.keys(LAW_DV_MATERIALS)) {
    const year = parseInt(yearStr, 10);
    let html: string;
    try {
      html = cachedHtml(year);
    } catch {
      console.log(`  • ${year}: no cached law HTML, skipping`);
      continue;
    }
    let n = 0;
    for (const [name, v] of parseYear(html, year)) {
      const label = canon(name);
      const row = byLabel.get(label) ?? new Map<number, number>();
      if (!row.has(year)) row.set(year, v); // first occurrence wins (twin tables)
      byLabel.set(label, row);
      n++;
    }
    lawYears.push(year);
    console.log(`  • ${year}: ${n} spending units`);
  }

  // Merge the 2026 draft seed (not derivable from a cached law yet).
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8")) as {
    source: string;
    values: Record<string, number>;
  };
  for (const [label, v] of Object.entries(seed.values)) {
    const row = byLabel.get(label) ?? new Map<number, number>();
    row.set(DRAFT_YEAR, v);
    byLabel.set(label, row);
  }

  const years = [...new Set([...lawYears, DRAFT_YEAR])].sort((a, b) => a - b);

  const institutions = [...byLabel.entries()]
    .map(([bg, row]) => {
      const values: Record<string, number> = {};
      const yoy: Record<string, number> = {};
      let prev: number | null = null;
      for (const y of years) {
        const v = row.get(y);
        if (v === undefined) continue;
        values[String(y)] = v;
        if (prev !== null && prev > 0)
          yoy[String(y)] = Math.round((v / prev - 1) * 1000) / 10;
        prev = v;
      }
      return { bg, values, yoy };
    })
    // sort by 2026 € increase, biggest first (matches the heatmap default)
    .sort((a, b) => {
      const d = (i: { values: Record<string, number> }) =>
        (i.values[String(DRAFT_YEAR)] ?? 0) -
        (i.values[String(DRAFT_YEAR - 1)] ?? 0);
      return d(b) - d(a);
    });

  const out = {
    note: "Издръжка (§10 + остатъчни текущи разходи) по първостепенни разпоредители, в хил. евро. Издръжка = Текущи разходи − Персонал − Субсидии − Лихви − Текущи трансфери за домакинствата, пресметната от ЗДБРБ за всяка година. 2026 = проектозакон. Стойностите са по приет бюджет (ревизиите не съдържат разбивка по ведомства).",
    currency: "EUR_thousands",
    years,
    draftYear: DRAFT_YEAR,
    source: `ЗДБРБ ${years[0]}–${years[years.length - 2]} (Държавен вестник) + ${seed.source}`,
    institutions,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  console.log(
    `\n→ wrote ${institutions.length} institutions × ${years.length} years to ${path.relative(process.cwd(), OUT)}`,
  );
};

main();
