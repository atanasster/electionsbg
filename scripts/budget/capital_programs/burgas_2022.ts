// Parser for Община Бургас's 2022 капиталова програма — the year-start
// refined plan ("Първоначален план") XLSX adopted April 2022.
//
// Source: raw_data/budget/capital_programs/burgas-2022.xlsx (31 KB)
// URL:    https://www.burgas.bg/uploads/posts/2022/parvonachalen-plan-za-2022g-5202-burgas.xlsx
//
// Layout differs sharply from 2025: it follows the legacy MINFIN
// "Капиталови разходи" template that Sofia 2022 also uses:
//   sheet "Общо"
//   col A      : § (5100/5200/…) OR Дейност 4-digit composite code
//                (1122/2283/…) OR "Функция NN" OR (empty for "Обект"/
//                subheader rows)
//   col B      : project description / section header / "ОБЩО" / "Обект"
//   col C      : ГОДИНА
//   col D      : СМЕТНА СТОЙНОСТ (multi-year project cost estimate)
//   col E      : УСВОЕНО до края на предходната година
//   col F      : УТОЧНЕН ПЛАН (this year's refined plan) ← headline
//   col G+     : funding-source breakdown (varies per row, not reliably mappable)
//
// Recap "ОБЩО" on row 9 col F = 126,042,993 BGN = €64.4M.
//
// The 2025 burgas.ts emits BurgasCapitalProgramFile with a 7-column
// funding-source breakdown. For 2022 we don't have that breakdown
// (legacy template doesn't expose those 7 columns cleanly), so the
// `funding` block is all-zero and only `total` is populated. The tile
// renders the funding mini-grid only when at least one cell is > 0,
// so it degrades gracefully.
//
// Run: tsx scripts/budget/capital_programs/burgas_2022.ts [--year 2022]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URL =
  "https://www.burgas.bg/uploads/posts/2022/parvonachalen-plan-za-2022g-5202-burgas.xlsx";

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

const bgnToMoney = (amount: number): Money => ({
  amount,
  currency: "BGN",
  amountEur: Math.round(amount / BGN_PER_EUR),
});

const emptyFunding = () => ({
  stateSubsidy: bgnToMoney(0),
  ownFunds: bgnToMoney(0),
  debt: bgnToMoney(0),
  euFunds: bgnToMoney(0),
  other: bgnToMoney(0),
  carryOverCommunity: bgnToMoney(0),
  carryOverDelegated: bgnToMoney(0),
});

const parseAmount = (raw: unknown): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(new RegExp("[\\s,   ]", "g"), "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Burgas's 11 villages — mirrors VILLAGE_NAMES in burgas.ts.
const VILLAGE_NAMES = [
  "Банево",
  "Брястовец",
  "Димчево",
  "Драганово",
  "Извор",
  "Изворище",
  "Маринка",
  "Миролюбово",
  "Равнец",
  "Рудник",
  "Твърдица",
];

// City quarters from Wikipedia's Категория:Квартали_на_Бургас, same set
// as the 2025 parser uses. Multi-word quartals listed first so the
// regex prefers the longest match.
const QUARTER_PREFIXES = ["ж.к.", "ж.к", "к/с", "кв.", "кв "];
const MULTI_WORD_QUARTERS = [
  "Черно Море",
  "Меден рудник",
  "Долно Езерово",
  "Горно Езерово",
  "Братя Миладинови",
  "Петко Славейков",
];

const extractSettlement = (name: string): string | null => {
  // Village: "с. NAME" or naked NAME if a known village.
  for (const v of VILLAGE_NAMES) {
    const re = new RegExp(
      "(?:^|[\\s,(])с\\.\\s*" + v + "(?:[\\s,)\\.\\-]|$)",
      "u",
    );
    if (re.test(name)) return v;
  }
  for (const v of VILLAGE_NAMES) {
    if (
      new RegExp("(?:^|[\\s,(\\-])" + v + "(?:[\\s,)\\.\\-]|$)", "u").test(name)
    ) {
      return v;
    }
  }
  // City quarter — multi-word first, then single-word fallback.
  for (const p of QUARTER_PREFIXES) {
    const idx = name.indexOf(p);
    if (idx < 0) continue;
    const after = name.slice(idx + p.length).trimStart();
    const afterLower = after.toLowerCase();
    for (const known of MULTI_WORD_QUARTERS) {
      if (afterLower.startsWith(known.toLowerCase())) return known;
    }
    const m = after.match(/^[А-ЯЁ][а-яё]+/u);
    if (m) return m[0];
  }
  return null;
};

const PARAGRAPH_CODES = new Set(["5100", "5200", "5300", "5400", "5500"]);

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2022;
  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `burgas-${fiscalYear}.xlsx`,
  );
  console.log(`[burgas-capital-2022] parsing ${xlsxPath} (year ${fiscalYear})`);
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n === "Общо") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  let recapTotal: Money | null = null;
  type Proj = {
    id: number;
    name: string;
    settlement: string | null;
    total: Money;
  };
  const projects: Proj[] = [];
  let projectId = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const colA = String(row[0] ?? "").trim();
    const colB = String(row[1] ?? "").trim();
    const colF = parseAmount(row[5]);

    if (!colA && !colB) continue;
    if (colB === "Обект") continue;
    if (colA === "ОБЩИНА" || colA === "КОД ПО ЕБК" || colA === "§") continue;
    if (colA === "1" || colA === "2") continue;

    // City-wide ОБЩО recap row.
    if (!colA && colB === "ОБЩО") {
      recapTotal = bgnToMoney(colF);
      continue;
    }

    // § paragraph rollup — skip (we don't need a paragraph breakdown here).
    if (PARAGRAPH_CODES.has(colA)) continue;

    // Function rollup — skip.
    if (/^Функция\s+/i.test(colA)) continue;

    // Project line item — col A is a Дейност code, col B is the description.
    if (colA && colB && colF > 0) {
      projectId += 1;
      projects.push({
        id: projectId,
        name: colB.replace(/\s+/g, " ").trim(),
        settlement: extractSettlement(colB),
        total: bgnToMoney(colF),
      });
    }
  }

  if (!recapTotal) {
    recapTotal = bgnToMoney(projects.reduce((s, p) => s + p.total.amount, 0));
  }

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: Proj[] }
  >();
  for (const p of projects) {
    if (!p.settlement) continue;
    const cur = bySettlementAgg.get(p.settlement) ?? {
      total: 0,
      projects: [],
    };
    cur.total += p.total.amount;
    cur.projects.push(p);
    bySettlementAgg.set(p.settlement, cur);
  }
  const bySettlement = [...bySettlementAgg]
    .map(([name, agg]) => ({
      name,
      projectCount: agg.projects.length,
      total: bgnToMoney(agg.total),
      topProjects: agg.projects
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 5)
        .map((p) => ({ id: p.id, name: p.name, total: p.total })),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Materialise the BurgasCapitalProgramFile shape — empty funding trio.
  const out = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Бургас",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Първоначален план)`,
      url: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "BGS04",
    municipalityNameBg: "Бургас",
    municipalityNameEn: "Burgas",
    currency: "BGN" as const,
    recapitulation: {
      total: recapTotal,
      funding: emptyFunding(),
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      settlement: p.settlement,
      total: p.total,
      ...emptyFunding(),
    })),
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "burgas.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[burgas-capital-2022] wrote ${outPath} — ${projects.length} projects, recap EUR ${(
      recapTotal.amountEur / 1_000_000
    ).toFixed(1)}M`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[burgas-capital-2022] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[burgas-capital-2022] top 6 settlements:");
  for (const s of bySettlement.slice(0, 6)) {
    console.log(
      `  ${s.name.padEnd(20)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
