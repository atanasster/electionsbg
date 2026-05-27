// Parser for Добрич's annual капиталова програма.
//
// 2025 source:
//   https://www.dobrich.bg/bg/programa-za-kapitalovi-razhodi-na-obshtina-grad-dobrich/
//   aktualizatsiya-na-programa-za-kapitalovite-razhodi-na-obshtina-grad-dobrich-za-2025-g-prieta-s-reshenie-26-1/
//   28102025-g
//
// Dobrich publishes the capital programme as an inline HTML table on
// dobrich.bg — no OCR needed. The table has 178 rows × 4 columns:
//   № | ОБЕКТ | Годишна задача | Актуализация октомври
// with section headers grouping projects by funding source (І. Собствени
// бюджетни средства, ІІ. Целева субсидия, ІІІ. Преходен остатък, …).
//
// Dobrich-grad (DOB28) is a SINGLE-settlement município — just the city,
// no villages (the surrounding villages are a separate "Добрич-селска"
// município, DOB15). So bySettlement is empty; the tile renders only
// recap + top projects.
//
// Run: tsx scripts/budget/capital_programs/dobrich.ts [--year 2025]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SOURCE_URLS: Record<number, string> = {
  // 2025 actualisation (October 2025 council decision); the live capital
  // programme page rotates between yearly versions, so this URL is the
  // adopted snapshot. Re-resolve from
  // https://www.dobrich.bg/bg/kapitalovi-razhodi-na-obshtina-grad-dobrich-1/
  // when a new fiscal year ships.
  2025: "https://www.dobrich.bg/bg/programa-za-kapitalovi-razhodi-na-obshtina-grad-dobrich/aktualizatsiya-na-programa-za-kapitalovite-razhodi-na-obshtina-grad-dobrich-za-2025-g-prieta-s-reshenie-26-1/28102025-g",
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

interface DobrichCapitalProject {
  id: number;
  name: string;
  fundingSource: string | null; // section header, e.g. "Собствени бюджетни средства"
  total: Money;
}

interface DobrichCapitalFundingRollup {
  code: string;
  projectCount: number;
  total: Money;
}

interface DobrichCapitalProgramFile {
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
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projects: DobrichCapitalProject[];
  byFundingSource: DobrichCapitalFundingRollup[];
}

const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&bdquo;/g, "„")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…");

const stripTags = (s: string): string =>
  decodeHtmlEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const parseAmount = (raw: string): number => {
  const cleaned = raw.replace(new RegExp("[\\s,   ]", "g"), "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const FUNDING_LABEL_TO_CODE = (label: string): string => {
  const l = label.toLowerCase();
  if (/собствен/.test(l)) return "OWN_FUNDS";
  if (/целев/.test(l) && /субсиди/.test(l)) return "TARGETED_SUBSIDY";
  if (/преход/.test(l)) return "TRANSITIONAL_BALANCES";
  if (/еврейск|европейск|есиф|опос|оперативн|евро/.test(l))
    return "EU_PROJECTS";
  if (/държав|целева/.test(l) && /трансфер/.test(l)) return "STATE_TRANSFER";
  if (/инвестиц/.test(l)) return "INVESTMENT_PROGRAMME";
  return (
    label
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-zА-Яа-я_]/g, "")
      .toUpperCase()
      .slice(0, 40) || "OTHER"
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const url = SOURCE_URLS[fiscalYear];
  if (!url) throw new Error(`No SOURCE_URL for fiscal year ${fiscalYear}`);

  console.log(`[dobrich-capital] fetching ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Find the largest <table> on the page (the calendar widget has only
  // 7-day-grid cells, the capital programme has 700+ cells).
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  let bestTable = "";
  let bestCellCount = 0;
  for (const t of tables) {
    const cells = (t.match(/<td/g) ?? []).length;
    if (cells > bestCellCount) {
      bestCellCount = cells;
      bestTable = t;
    }
  }
  if (!bestTable) throw new Error("no <table> found on the page");
  console.log(
    `[dobrich-capital] picked the largest table (${bestCellCount} cells)`,
  );

  const projects: DobrichCapitalProject[] = [];
  let currentFunding: string | null = null;
  let publishedRecap: Money | null = null;
  let projectId = 0;

  // Walk rows; for each row collect td-cells; classify by content.
  const rows = bestTable.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(stripTags);
    if (cells.length === 0) continue;
    // Header row: " | label | amount | amount" or just "section header"
    // Section-header (funding source): row has 4 cols but col 0 is empty
    // or a Roman numeral, col 1 is the label "І. Собствени бюджетни...".
    const first = cells[0];
    const second = cells[1] ?? "";

    // Recap row — usually labelled "ОБЩО ЗА ОБЕКТИ" or "ВСИЧКО" with
    // a total amount.
    if (/^(всичко|общо\s*за|вс\s*и\s*ч\s*к\s*о)/iu.test(second) && cells[3]) {
      const amt = parseAmount(cells[3]);
      if (amt > 0) publishedRecap = bgnToMoney(amt);
      continue;
    }

    // Funding-source section header: col 1 looks like "І. ..." or "ІІ. …",
    // and col 0 is empty.
    if (
      !first &&
      /^[ІV\d]+\.\s+[А-ЯЁ]/u.test(second) &&
      cells[2] &&
      !/^\d/.test(first)
    ) {
      currentFunding = second.replace(/^[ІV\d]+\.\s*/u, "").trim();
      continue;
    }

    // Project row: col 0 is a number, col 1 is description, col 3 is amount.
    if (/^\d+$/.test(first) && second.length > 3) {
      const amt = parseAmount(cells[3] || cells[2] || "0");
      if (amt > 0) {
        projectId += 1;
        projects.push({
          id: projectId,
          name: second,
          fundingSource: currentFunding
            ? FUNDING_LABEL_TO_CODE(currentFunding)
            : null,
          total: bgnToMoney(amt),
        });
      }
    }
  }

  // Per-funding-source rollup.
  const byFundingAgg = new Map<string, { total: number; count: number }>();
  for (const pr of projects) {
    const key = pr.fundingSource ?? "UNSPECIFIED";
    const cur = byFundingAgg.get(key) ?? { total: 0, count: 0 };
    cur.total += pr.total.amount;
    cur.count += 1;
    byFundingAgg.set(key, cur);
  }
  const byFundingSource: DobrichCapitalFundingRollup[] = [...byFundingAgg]
    .map(([code, agg]) => ({
      code,
      projectCount: agg.count,
      total: bgnToMoney(agg.total),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );

  const out: DobrichCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община град Добрич",
      documentTitle: `Програма за капиталовите разходи на Община град Добрич за ${fiscalYear} г. (Актуализация октомври ${fiscalYear})`,
      url,
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "DOB28",
    municipalityNameBg: "Добрич",
    municipalityNameEn: "Dobrich",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap,
    projects,
    byFundingSource,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "dobrich.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(
    `[dobrich-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      publishedRecap
        ? ` (published recap EUR ${(publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  console.log("\n[dobrich-capital] by funding source:");
  for (const f of byFundingSource) {
    console.log(
      `  ${f.code.padEnd(22)} ${f.projectCount.toString().padStart(3)} proj  EUR ${(f.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
