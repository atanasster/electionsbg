// Parser for Община Бургас's annual капиталова програма — published as
// the "Капиталова програма" sheet inside the city's draft-budget XLSX
// workbook on burgas.bg.
//
// 2025 source:
//   https://burgas.bg/uploads/posts/2025/88b526bffed7c988521911ecb2eb0086.xlsx
//   (sheet "Капиталова програма", 104 project rows, ~169.5M BGN ≈ €87M).
//
// Layout (XLSX, single sheet, columns A..H):
//   row 1   "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ ПРЕЗ 2025 г."
//   row 4   Column headers
//   row 5+  Project rows — 7 numeric columns (the funding sources). The
//           project's total = sum across all 7 columns (no explicit total
//           column). Project name in col A; settlement embedded in free
//           text ("с. Твърдица", "ж.к.Славейков", "кв.Ч.море"…).
//
// Funding-source columns:
//   B  Субсидия от ЦБ           (state subsidy)
//   C  Собствени бюджетни       (own funds)
//   D  Дългово финансиране      (debt finance)
//   E  Сметки за средства от ЕС (EU funds + international programmes)
//   F  Други източници          (other — Приложение №3, ПУДООС, РИОСВ…)
//   G  Преходен остатък ОД       (carry-over — community activity)
//   H  Преходен остатък ДДД      (carry-over — delegated activity)
//
// Burgas is not районирана (unlike Sofia/Plovdiv), so there's no per-район
// breakdown. The tile instead surfaces total + funding-source breakdown
// + top projects + per-settlement extract for the ~17% of rows that name
// a sub-settlement.
//
// Run: tsx scripts/budget/capital_programs/burgas.ts [--year 2025]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://burgas.bg/uploads/posts/2025/88b526bffed7c988521911ecb2eb0086.xlsx",
  // 2024 + 2023 ship the capital programme inside a 133-page
  // "Приложения.pdf" bundle (council-adopted decision), not a
  // standalone XLSX. Those years aren't ingested here — see
  // scripts/budget/capital_programs/burgas_2022.ts for the legacy
  // XLSX path, and the back-years catalogue in
  // scripts/watch/sources/capital_programs.ts for the watcher entry.
  2022: "https://www.burgas.bg/uploads/posts/2022/parvonachalen-plan-za-2022g-5202-burgas.xlsx",
};

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

interface BurgasCapitalFunding {
  stateSubsidy: Money;
  ownFunds: Money;
  debt: Money;
  euFunds: Money;
  other: Money;
  carryOverCommunity: Money;
  carryOverDelegated: Money;
}

interface BurgasCapitalProject extends BurgasCapitalFunding {
  id: number;
  name: string;
  // canonical sub-settlement key when one can be extracted from the
  // project description (e.g. "с. Твърдица" → "Твърдица"). null for
  // city-wide projects, which are the majority.
  settlement: string | null;
  total: Money;
}

interface BurgasCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface BurgasCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: {
    total: Money;
    funding: BurgasCapitalFunding;
  };
  projects: BurgasCapitalProject[];
  bySettlement: BurgasCapitalSettlementRollup[];
}

const parseCell = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v)
    .replace(new RegExp("[\\s\\u00A0\\u2007\\u202F]", "g"), "")
    .replace(/,/g, ".");
  if (!s || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Sub-settlement extraction. The Burgas community has 12 settlements:
// gр. Бургас (the city itself) plus 11 villages — Банево, Брястовец,
// Димчево, Драганово, Извор, Маринка, Миролюбово, Равнец, Рудник,
// Твърдица, Изворище.
//
// City quarters (ж.к. and кв.) inside Burgas itself aren't separate
// settlements in the official registry, but the population recognises
// them: Меден рудник, Възраждане, Победа, Лазур, Зорница, Изгрев,
// Славейков, Братя Миладинови, Сарафово (a кв. of Burgas), Крайморие
// (also a кв.), Долно Езерово (кв.), Горно Езерово (кв.), Ветрен (кв.),
// Банево, Черно море (кв. of Бургас).
//
// We try VILLAGES first ("с. Твърдица"), then quarters ("ж.к."/"кв.").
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

const QUARTER_PREFIXES = ["ж.к.", "ж.к", "к/с", "кв.", "кв "];

// Known multi-word Burgas city quarters. Single-word capture would
// truncate "Черно Море" → "Черно", "Меден рудник" → "Меден" etc. Listed
// here so the lookup can grab the second word verbatim when present.
//
// Source: bg.wikipedia.org/wiki/Категория:Квартали_на_Бургас (cross-
// referenced against actual XLSX rows). Capitalisation follows the
// Burgas budget XLSX ("кв.Черно Море" with capital М), not Wikipedia's
// "Черно море" (lowercase) — the parser is case-insensitive but emits
// the canonical form from this list.
//
// Single-word квартали from the same category (Сарафово, Крайморие,
// Лозово, Хоризонт, Победа, Лазур, Акациите, Изгрев, Зорница,
// Възраждане) all match via the fallback single-Cyrillic-word capture
// and don't need explicit listing.
const MULTI_WORD_QUARTERS = [
  "Черно Море",
  "Меден рудник",
  "Долно Езерово",
  "Горно Езерово",
  "Братя Миладинови",
  "Петко Славейков",
];

const extractSettlement = (name: string): string | null => {
  // Village: "с. NAME" or just "NAME" appearing as a known village.
  for (const v of VILLAGE_NAMES) {
    const re = new RegExp(
      "(?:^|[\\s,(])с\\.\\s*" + v + "(?:[\\s,)\\.\\-]|$)",
      "u",
    );
    if (re.test(name)) return v;
  }
  for (const v of VILLAGE_NAMES) {
    // Loose match — e.g. "Рудник-Брястовец" or "до с.Равнец".
    if (
      new RegExp("(?:^|[\\s,(\\-])" + v + "(?:[\\s,)\\.\\-]|$)", "u").test(name)
    ) {
      return v;
    }
  }
  // City quarter — first try the known multi-word names, then fall back
  // to the single-word capture. Single-word alone would truncate
  // "Черно море" → "Черно"; greedier multi-word capture would leak
  // "Сарафово и ново" as a quarter name.
  for (const p of QUARTER_PREFIXES) {
    const idx = name.indexOf(p);
    if (idx < 0) continue;
    const after = name.slice(idx + p.length).trimStart();
    const prefix = p.replace(/\s+$/, "").replace(/^кв$/, "кв.");
    let matched: string | null = null;
    const afterLower = after.toLowerCase();
    for (const known of MULTI_WORD_QUARTERS) {
      // Case-insensitive — source uses both "Черно море" and "Черно Море".
      if (afterLower.startsWith(known.toLowerCase())) {
        matched = known;
        break;
      }
    }
    if (!matched) {
      const m = after.match(/^([А-ЯЁа-яё][А-ЯЁа-яё-]{2,})/u);
      if (m) matched = m[1];
    }
    if (matched) return `${prefix} ${matched}`;
  }
  return null;
};

const parseProgram = (
  xlsxPath: string,
  fiscalYear: number,
): BurgasCapitalProgramFile => {
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { cellNF: false, cellText: false });
  const sheetName = "Капиталова програма";
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`sheet not found: ${sheetName}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
  });

  const projects: BurgasCapitalProject[] = [];
  const fundingTotals: BurgasCapitalFunding = {
    stateSubsidy: bgnToMoney(0),
    ownFunds: bgnToMoney(0),
    debt: bgnToMoney(0),
    euFunds: bgnToMoney(0),
    other: bgnToMoney(0),
    carryOverCommunity: bgnToMoney(0),
    carryOverDelegated: bgnToMoney(0),
  };
  let totalSum = 0;

  // Header at row 4 (index 4); project rows start at index 5.
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    const name = String(row[0]).trim();
    if (!name) continue;
    // Skip totals/footer rows if any — the source doesn't have any but
    // be defensive.
    if (/^(всичко|общо|итого)/i.test(name)) continue;

    const stateSubsidy = parseCell(row[1]);
    const ownFunds = parseCell(row[2]);
    const debt = parseCell(row[3]);
    const euFunds = parseCell(row[4]);
    const other = parseCell(row[5]);
    const carryOverCommunity = parseCell(row[6]);
    const carryOverDelegated = parseCell(row[7]);
    const total =
      stateSubsidy +
      ownFunds +
      debt +
      euFunds +
      other +
      carryOverCommunity +
      carryOverDelegated;
    if (total === 0) continue;

    projects.push({
      id: projects.length + 1,
      name,
      settlement: extractSettlement(name),
      stateSubsidy: bgnToMoney(stateSubsidy),
      ownFunds: bgnToMoney(ownFunds),
      debt: bgnToMoney(debt),
      euFunds: bgnToMoney(euFunds),
      other: bgnToMoney(other),
      carryOverCommunity: bgnToMoney(carryOverCommunity),
      carryOverDelegated: bgnToMoney(carryOverDelegated),
      total: bgnToMoney(total),
    });

    fundingTotals.stateSubsidy.amount += stateSubsidy;
    fundingTotals.ownFunds.amount += ownFunds;
    fundingTotals.debt.amount += debt;
    fundingTotals.euFunds.amount += euFunds;
    fundingTotals.other.amount += other;
    fundingTotals.carryOverCommunity.amount += carryOverCommunity;
    fundingTotals.carryOverDelegated.amount += carryOverDelegated;
    totalSum += total;
  }

  // Recompute amountEur after summing.
  for (const k of Object.keys(fundingTotals) as Array<
    keyof BurgasCapitalFunding
  >) {
    fundingTotals[k] = bgnToMoney(fundingTotals[k].amount);
  }

  // Per-settlement rollup — only items with a non-null settlement, sorted
  // by total amount descending. Quarters and villages share one list since
  // both are meaningful sub-locations even if not the same legal grain.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: BurgasCapitalProject[] }
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
  const bySettlement: BurgasCapitalSettlementRollup[] = [...bySettlementAgg]
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

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Бургас",
      documentTitle: `Капиталова програма ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "BGS04",
    municipalityNameBg: "Бургас",
    municipalityNameEn: "Burgas",
    currency: "BGN",
    recapitulation: {
      total: bgnToMoney(totalSum),
      funding: fundingTotals,
    },
    projects,
    bySettlement,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `burgas-${fiscalYear}.xlsx`,
  );
  console.log(`[burgas-capital] parsing ${xlsxPath} (year ${fiscalYear})`);
  const parsed = parseProgram(xlsxPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "burgas.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[burgas-capital] wrote ${outPath} — ${parsed.projects.length} projects, recap €${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M`,
  );
  const tagged = parsed.projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[burgas-capital] settlement tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[burgas-capital] funding breakdown:");
  const r = parsed.recapitulation.funding;
  console.log(
    `  state subsidy: €${(r.stateSubsidy.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  own funds:     €${(r.ownFunds.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  debt:          €${(r.debt.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  EU funds:      €${(r.euFunds.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  other:         €${(r.other.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  carry-over OD: €${(r.carryOverCommunity.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log(
    `  carry-over ДДД: €${(r.carryOverDelegated.amountEur / 1_000_000).toFixed(2)}M`,
  );
  console.log("\n[burgas-capital] top 5 settlements:");
  for (const s of parsed.bySettlement.slice(0, 5)) {
    console.log(
      `  ${s.name.padEnd(20)} ${s.projectCount.toString().padStart(2)} projects  €${(s.total.amountEur / 1_000_000).toFixed(2)}M`,
    );
  }
};

main();
