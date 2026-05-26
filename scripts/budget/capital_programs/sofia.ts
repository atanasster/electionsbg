// Parser for Столична община's annual капиталова програма — Приложение №3
// to the budget law (the city's per-object capital-spending list).
//
// Source layout (стр./XLSX, 2024+ format):
//   row 9         "РЕКАПИТУЛАЦИЯ КАПИТАЛОВА ПРОГРАМА"
//   row 16-36     Recapitulation: city-wide totals by §51-§55 paragraph
//                 (columns: own funds | state subsidy | EU/intl | total)
//   row 51        Project-list header
//   row 52+       Project-list rows. Hierarchy markers and project items:
//                   § 5100 OСНОВЕН РЕМОНТ НА ДМА   — paragraph
//                   Функция X "..."                — function
//                   Дейност XXX "..."              — activity
//                   <project name>                 — item, район is in
//                                                    free text inside the
//                                                    description.
//
// Output: data/budget/capital_programs/{year}/sofia.json (~50-80 KB).
//
// Run with: tsx scripts/budget/capital_programs/sofia.ts [--year 2025]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";
import { SOFIA_RAYONS, lookupRayonCode } from "./sofia_rayons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.sofia.bg/documents/d/guest/prilozenie-_3-kapitalova-programa-2025",
  2024: "https://www.sofia.bg/documents/d/guest/prilozenie-3_-razcet-za-finansirane-na-kapitalovite-razhodi-2024-g-",
  2023: "https://www.sofia.bg/documents/d/guest/4-kapitalova-programa-za-2023-g",
  // 2022's budget docket landed on sofia.bg in Aug 2023 — the year-end
  // refined plan ("Уточнен план") XLSX has the per-project list.
  2022: "https://www.sofia.bg/documents/d/guest/2023-08-28-razcet-za-finansirane-na-kapitalovite-razhodi-2022g-",
};

// XLSX layout differs across fiscal years. The cleanest split:
//   2025+ — 5-col layout: desc=A, ownFunds=B, stateSubsidy=C, euFunds=D, total=E
//   2023/2024 — wider layout: desc=A, total=D ("ОБЩО"), funding-source cols
//     differ (12 vs 20 cols) and don't map 1:1 to the ownFunds/state/eu trio
//   2022 — radically different: § markers in col A, project description in
//     col B, "Уточнен план" (refined annual plan) in col F. Handled by the
//     separate sofia_2022.ts parser below.
interface ColumnConfig {
  descColumn: number; // index of the column holding project description + hierarchy markers
  totalColumn: number; // index of the column holding the annual headline amount
  // For 2025 only — finer-grained funding breakdown columns. Wider-layout
  // 2023/2024 don't capture this (funding-source columns are too year-
  // specific to remap reliably; the tile only renders `total` anyway).
  ownFundsColumn?: number;
  stateSubsidyColumn?: number;
  euFundsColumn?: number;
}

const COLUMN_CONFIGS: Record<number, ColumnConfig> = {
  2025: {
    descColumn: 0,
    ownFundsColumn: 1,
    stateSubsidyColumn: 2,
    euFundsColumn: 3,
    totalColumn: 4,
  },
  2024: { descColumn: 0, totalColumn: 3 }, // col D = "ОБЩО"
  2023: { descColumn: 0, totalColumn: 3 }, // col D = "ОБЩО С ОПЕРАТИВНИ ПРОГРАМИ"
};

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

interface AmountColumns {
  ownFunds: Money;
  stateSubsidy: Money;
  euFunds: Money;
  total: Money;
}

export interface SofiaCapitalProject extends AmountColumns {
  id: number;
  name: string;
  paragraph: string; // "5100", "5200", "5300", "5400", "5500" — § code
  functionLabel: string | null; // "1 - ОБЩИ ДЪРЖАВНИ СЛУЖБИ"
  activityLabel: string | null; // "122 - Общинска администрация"
  rayons: string[]; // canonical район codes; empty for city-wide items
}

export interface SofiaCapitalParagraph extends AmountColumns {
  code: string; // "5100" etc. or "" for unlabelled totals
  labelBg: string;
}

export interface SofiaCapitalRayonRollup extends Pick<AmountColumns, "total"> {
  code: string;
  labelBg: string;
  labelEn: string;
  projectCount: number;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

export interface SofiaCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  currency: "BGN" | "EUR";
  recapitulation: {
    total: AmountColumns;
    byParagraph: SofiaCapitalParagraph[];
  };
  projects: SofiaCapitalProject[];
  byRayon: SofiaCapitalRayonRollup[];
}

const bgnToMoney = (amountBgn: number): Money => ({
  amount: amountBgn,
  currency: "BGN",
  amountEur: Math.round(amountBgn / BGN_PER_EUR),
});

const eurToMoney = (amountEur: number): Money => ({
  amount: amountEur,
  currency: "EUR",
  amountEur: Math.round(amountEur),
});

const parseAmount = (raw: unknown): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  // Strip every whitespace variant (incl. NBSP / figure-space) + commas.
  const s = String(raw).replace(
    new RegExp("[\\s,\u00A0\u2007\u202F]", "g"),
    "",
  );
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const buildMoney = (raw: unknown, currency: "BGN" | "EUR"): Money => {
  const n = parseAmount(raw);
  return currency === "BGN" ? bgnToMoney(n) : eurToMoney(n);
};

const buildAmounts = (
  row: unknown[],
  currency: "BGN" | "EUR",
  cfg: ColumnConfig,
): AmountColumns => ({
  ownFunds:
    cfg.ownFundsColumn !== undefined
      ? buildMoney(row[cfg.ownFundsColumn], currency)
      : buildMoney(0, currency),
  stateSubsidy:
    cfg.stateSubsidyColumn !== undefined
      ? buildMoney(row[cfg.stateSubsidyColumn], currency)
      : buildMoney(0, currency),
  euFunds:
    cfg.euFundsColumn !== undefined
      ? buildMoney(row[cfg.euFundsColumn], currency)
      : buildMoney(0, currency),
  total: buildMoney(row[cfg.totalColumn], currency),
});

// Extract район tokens from a project description. The XLSX uses several
// quotation styles and occasionally lists two районi for a single project.
// We match `район "X"`, `район „X"`, `райони "X" и „Y"`. The captured
// token goes through lookupRayonCode() to validate and canonicalise.
const RAYON_RE =
  /район[ит]?[ие]?\s*[""„«]([^""«»"]+)[""»"]?(?:\s+и\s+[""„«]([^""«»"]+)[""»"]?)?/giu;

const extractRayons = (description: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  // Re-create the regex per call so .lastIndex doesn't bleed across calls.
  const re = new RegExp(RAYON_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    for (const cap of [m[1], m[2]]) {
      if (!cap) continue;
      const code = lookupRayonCode(cap);
      if (code && !seen.has(code)) {
        seen.add(code);
        out.push(code);
      }
    }
  }
  return out;
};

// Detect hierarchy markers in column A. Returns the bucket the row belongs
// to: "paragraph", "function", "activity", "header", or null (project row).
type RowKind = "paragraph" | "function" | "activity" | "header" | null;

const classifyRow = (raw: string): { kind: RowKind; code: string } => {
  const t = raw.trim();
  if (!t) return { kind: "header", code: "" };
  if (t.startsWith("КАПИТАЛОВ") && t.includes("РАЗХОДИ"))
    return { kind: "header", code: "" };
  if (t.startsWith("НАИМЕНОВАНИЕ")) return { kind: "header", code: "" };
  const paraMatch = t.match(/^§\s*(\d{4})/);
  if (paraMatch) return { kind: "paragraph", code: paraMatch[1] };
  if (/^Функция\s+/i.test(t)) return { kind: "function", code: t };
  if (/^Дейност\s+/i.test(t)) return { kind: "activity", code: t };
  // Recapitulation top section: uses unstyled headings like
  //   "ОСНОВЕН РЕМОНТ НА ДЪЛГОТРАЙНИ МАТЕРИАЛНИ АКТИВИ"
  // We don't need to capture these — the §-coded version below them in the
  // itemised section is the source of truth.
  if (/^[А-ЯЁ\s,]{8,}$/.test(t) && !t.match(/\d/)) {
    return { kind: "header", code: "" };
  }
  return { kind: null, code: "" };
};

interface ParseOptions {
  fiscalYear: number;
  xlsxPath: string;
  currency: "BGN" | "EUR";
}

const parse = (opts: ParseOptions): SofiaCapitalProgramFile => {
  const cfg = COLUMN_CONFIGS[opts.fiscalYear];
  if (!cfg) {
    throw new Error(
      `No COLUMN_CONFIGS entry for fiscal year ${opts.fiscalYear} — add one ` +
        `or use the dedicated sofia_2022.ts parser for the legacy layout.`,
    );
  }
  const buf = readFileSync(opts.xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];

  // ---- Recapitulation (rows ~12-36) -----------------------------------
  // We capture the §51-§55 paragraph totals if labelled here, but the
  // canonical source for paragraph totals is the §-prefixed rows in the
  // itemised section (rows 52+). To keep the JSON self-consistent, we
  // re-aggregate from there.

  // ---- Locate the itemised section's header row -----------------------
  let itemHeaderRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][cfg.descColumn] ?? "").trim();
    if (cell.startsWith("НАИМЕНОВАНИЕ НА ОБЕКТА")) {
      itemHeaderRow = i;
      break;
    }
  }
  if (itemHeaderRow < 0)
    throw new Error("could not locate 'НАИМЕНОВАНИЕ НА ОБЕКТА' header row");

  // ---- Walk itemised rows, tracking paragraph / function / activity --
  const projects: SofiaCapitalProject[] = [];
  const paragraphs = new Map<
    string,
    { labelBg: string; amounts: AmountColumns }
  >();
  let totalAmounts: AmountColumns | null = null;
  let currentParagraph = "";
  let currentFunction: string | null = null;
  let currentActivity: string | null = null;
  let projectId = 0;

  for (let i = itemHeaderRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const desc = String(row[cfg.descColumn] ?? "").trim();
    if (!desc) continue;

    // Header rows like "СТОЛИЧНА ОБЩИНА" or "/лева/" — skip cleanly.
    if (
      desc === "СТОЛИЧНА  ОБЩИНА" ||
      desc === "СТОЛИЧНА ОБЩИНА" ||
      desc === "/лева/" ||
      desc === "ПРОЕКТ!"
    ) {
      continue;
    }

    // City-wide capital total — drives `recapitulation.total`. The
    // header text varies by year: 2025 says "КАПИТАЛОВИ РАЗХОДИ ОБЩО",
    // 2023/2024 just "ОБЩО" on its own line above the paragraph list.
    if (desc.startsWith("КАПИТАЛОВИ РАЗХОДИ ОБЩО") || desc === "ОБЩО") {
      totalAmounts = buildAmounts(row, opts.currency, cfg);
      continue;
    }

    const { kind, code } = classifyRow(desc);
    if (kind === "paragraph") {
      currentParagraph = code;
      currentFunction = null;
      currentActivity = null;
      // Capture paragraph rollup amounts as published in the XLSX.
      const labelBg = desc.replace(/^§\s*\d{4}\s*/, "").trim();
      paragraphs.set(code, {
        labelBg,
        amounts: buildAmounts(row, opts.currency, cfg),
      });
      continue;
    }
    if (kind === "function") {
      currentFunction = desc;
      currentActivity = null;
      continue;
    }
    if (kind === "activity") {
      currentActivity = desc;
      continue;
    }
    if (kind === "header") continue;

    // Project item. Must have a non-zero total to be retained; rows with
    // only "0" in column E are inactive carry-overs.
    const amounts = buildAmounts(row, opts.currency, cfg);
    if (amounts.total.amount === 0) continue;

    projectId += 1;
    projects.push({
      id: projectId,
      name: desc.replace(/\s+/g, " ").trim(),
      paragraph: currentParagraph,
      functionLabel: currentFunction,
      activityLabel: currentActivity,
      rayons: extractRayons(desc),
      ...amounts,
    });
  }

  if (!totalAmounts) {
    // Fallback: sum the itemised projects ourselves.
    totalAmounts = projects.reduce<AmountColumns>(
      (acc, p) => ({
        ownFunds: addMoney(acc.ownFunds, p.ownFunds),
        stateSubsidy: addMoney(acc.stateSubsidy, p.stateSubsidy),
        euFunds: addMoney(acc.euFunds, p.euFunds),
        total: addMoney(acc.total, p.total),
      }),
      emptyAmounts(opts.currency),
    );
  }

  // ---- Per-район rollup ----------------------------------------------
  const rayonAgg = new Map<
    string,
    {
      total: Money;
      projects: Array<{ id: number; name: string; total: Money }>;
    }
  >();
  for (const p of projects) {
    for (const r of p.rayons) {
      const cur = rayonAgg.get(r) ?? {
        total: bgnToMoney(0),
        projects: [],
      };
      // When a project is split across N районi, we attribute the full
      // amount to each — this matches how readers interpret line items
      // ("project for район X and Y"). A cross-район `byRayon` total will
      // therefore exceed the city-wide total; that's intentional, and the
      // UI footnote clarifies it.
      cur.total =
        p.total.currency === "BGN"
          ? bgnToMoney(cur.total.amount + p.total.amount)
          : eurToMoney(cur.total.amount + p.total.amount);
      cur.projects.push({ id: p.id, name: p.name, total: p.total });
      rayonAgg.set(r, cur);
    }
  }

  const byRayon: SofiaCapitalRayonRollup[] = SOFIA_RAYONS.map((r) => {
    const agg = rayonAgg.get(r.code);
    return {
      code: r.code,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      projectCount: agg?.projects.length ?? 0,
      total: agg?.total ?? bgnToMoney(0),
      topProjects: (agg?.projects ?? [])
        .sort((a, b) => b.total.amountEur - a.total.amountEur)
        .slice(0, 10),
    };
  }).sort((a, b) => b.total.amountEur - a.total.amountEur);

  return {
    fiscalYear: opts.fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Столична община",
      documentTitle: `Капиталова програма ${opts.fiscalYear} г. — Приложение №3`,
      url: SOURCE_URLS[opts.fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    currency: opts.currency,
    recapitulation: {
      total: totalAmounts,
      byParagraph: [...paragraphs.entries()].map(([code, p]) => ({
        code,
        labelBg: p.labelBg,
        ...p.amounts,
      })),
    },
    projects,
    byRayon,
  };
};

const emptyAmounts = (currency: "BGN" | "EUR"): AmountColumns => ({
  ownFunds: currency === "BGN" ? bgnToMoney(0) : eurToMoney(0),
  stateSubsidy: currency === "BGN" ? bgnToMoney(0) : eurToMoney(0),
  euFunds: currency === "BGN" ? bgnToMoney(0) : eurToMoney(0),
  total: currency === "BGN" ? bgnToMoney(0) : eurToMoney(0),
});

const addMoney = (a: Money, b: Money): Money => {
  const amount = a.amount + b.amount;
  return a.currency === "BGN" ? bgnToMoney(amount) : eurToMoney(amount);
};

// ---- CLI entry point -------------------------------------------------

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const xlsxIdx = args.indexOf("--xlsx");
  const defaultPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `sofia-${fiscalYear}.xlsx`,
  );
  const xlsxPath = xlsxIdx >= 0 ? args[xlsxIdx + 1] : defaultPath;

  // The legal currency switched from BGN to EUR on 2026-01-01, so the
  // 2025 капиталова програма (drafted in 2024) is denominated in лева.
  // 2026+ files will be EUR — we lock that to the year here.
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  console.log(`[sofia-capital] parsing ${xlsxPath} (year ${fiscalYear})`);
  const parsed = parse({ fiscalYear, xlsxPath, currency });

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "sofia.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  const totalEur = parsed.recapitulation.total.total.amountEur;
  console.log(
    `[sofia-capital] wrote ${outPath} — ${parsed.projects.length} projects, €${(
      totalEur / 1_000_000
    ).toFixed(1)}M total`,
  );
  const taggedCount = parsed.projects.filter((p) => p.rayons.length > 0).length;
  console.log(
    `[sofia-capital] район tagging: ${taggedCount}/${parsed.projects.length} projects (${(
      (100 * taggedCount) /
      parsed.projects.length
    ).toFixed(0)}%)`,
  );
  console.log("[sofia-capital] top 5 районi by amount:");
  for (const r of parsed.byRayon.slice(0, 5)) {
    console.log(
      `  ${r.labelBg.padEnd(18)} ${r.projectCount.toString().padStart(3)} projects  €${(
        r.total.amountEur / 1_000_000
      ).toFixed(1)}M`,
    );
  }
};

main();
