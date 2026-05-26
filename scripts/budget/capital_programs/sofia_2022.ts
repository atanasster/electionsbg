// Parser for Столична община's 2022 капиталова програма — the year-end
// refined plan ("Уточнен план") XLSX published August 2023 (the 2022
// budget itself adopted in mid-2023 due to the political instability).
//
// Source: raw_data/budget/capital_programs/sofia-2022.xlsx (81 KB)
//
// Layout differs sharply from 2023+: it pre-dates the redesigned
// "Приложение №3" sheet:
//   sheet name: "Общо"
//   col A      : § / Функция code OR Дейност 4-digit composite code
//                (5100/5200/… for paragraphs; 1122/2283/3322/… for
//                Дейности — the first 1-2 digits are the Функция number,
//                the rest is the Дейност number within that function)
//   col B      : long-form description (or "Обект" subheader, or "ОБЩО"
//                on the recap row)
//   col C      : ГОДИНА (year range, e.g. "2021-2023")
//   col D      : СМЕТНА СТОЙНОСТ (multi-year project cost estimate)
//   col E      : УСВОЕНО ДО КРАЯ НА 2021 (executed before this year)
//   col F      : УТОЧНЕН ПЛАН (this year's refined plan) ← headline
//   col G+     : источници на финансиране columns (varies per row)
//
// The headline "ОБЩО" recap on row 9 = 594,277,318 BGN = €304M.
// Itemised sum from sub-rows is ~85% of the headline (same convention
// as the post-redesign years — recap includes city-wide rollups that
// aren't broken into specific projects).
//
// Output shape matches scripts/budget/capital_programs/sofia.ts so the
// same SofiaCapitalProgramFile type and useSofiaCapitalProgram hook
// can consume both formats.
//
// Run: tsx scripts/budget/capital_programs/sofia_2022.ts [--year 2022]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";
import { SOFIA_RAYONS, lookupRayonCode } from "./sofia_rayons";
import type {
  SofiaCapitalProgramFile,
  SofiaCapitalProject,
  SofiaCapitalParagraph,
  SofiaCapitalRayonRollup,
} from "./sofia";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URL =
  "https://www.sofia.bg/documents/d/guest/2023-08-28-razcet-za-finansirane-na-kapitalovite-razhodi-2022g-";

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

const parseAmount = (raw: unknown): number => {
  if (raw === null || raw === undefined || raw === "") return 0;
  const s = String(raw).replace(new RegExp("[\\s,   ]", "g"), "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Mirror of the extractRayons logic in sofia.ts — duplicated here to
// keep this parser self-contained (avoids tight coupling to the main
// parser's internals when its regex evolves).
const RAYON_RE =
  /район[ит]?[ие]?\s*[""„«]([^""«»"]+)[""»"]?(?:\s+и\s+[""„«]([^""«»"]+)[""»"]?)?/giu;

const extractRayons = (description: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
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

const PARAGRAPH_CODES = new Set(["5100", "5200", "5300", "5400", "5500"]);

const parse = (
  xlsxPath: string,
  fiscalYear: number,
): SofiaCapitalProgramFile => {
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: "buffer" });
  // The 2022 file's only sheet is "Общо"; tolerate slight variants.
  const sheetName = wb.SheetNames.find((n) => n === "Общо") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  const projects: SofiaCapitalProject[] = [];
  const paragraphs = new Map<string, { labelBg: string; total: Money }>();
  let totalRecap: Money | null = null;
  let currentParagraph = "";
  let currentFunction: string | null = null;
  let projectId = 0;

  // Header rows occupy rows 1-8; the table data starts ~row 9 (1-indexed).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const colA = String(row[0] ?? "").trim();
    const colB = String(row[1] ?? "").trim();
    const colF = parseAmount(row[5]);

    // Skip header / metadata rows.
    if (!colA && !colB) continue;
    if (colB === "Обект") continue;
    if (colA === "ОБЩИНА" || colA === "КОД ПО ЕБК" || colA === "§") continue;
    if (colA === "1" || colA === "2") continue; // column-index header

    // City-wide recap: col A empty, col B == "ОБЩО".
    if (!colA && colB === "ОБЩО") {
      totalRecap = bgnToMoney(colF);
      continue;
    }

    // § paragraph rollup: col A is one of 5100/5200/5300/5400/5500.
    if (PARAGRAPH_CODES.has(colA)) {
      currentParagraph = colA;
      currentFunction = null;
      paragraphs.set(colA, { labelBg: colB, total: bgnToMoney(colF) });
      continue;
    }

    // Function rollup: col A starts with "Функция".
    if (/^Функция\s+/i.test(colA)) {
      currentFunction = colA;
      continue;
    }

    // Anything else with a non-empty col A AND non-empty col B is a
    // project line item — col A is the Дейност composite code, col B is
    // the project description.
    if (colA && colB && colF > 0) {
      projectId += 1;
      // Activity label: derive from the 4-digit Дейност code. The first
      // 1-2 digits are the Функция number — but the prior "Функция …"
      // header gives us a richer human label.
      const activityLabel = `Дейност ${colA}`;
      projects.push({
        id: projectId,
        name: colB.replace(/\s+/g, " ").trim(),
        paragraph: currentParagraph,
        functionLabel: currentFunction,
        activityLabel,
        rayons: extractRayons(colB),
        // Funding-source breakdown isn't reliably column-mapped in this
        // legacy layout, so we record 0 for the trio and put the full
        // amount into `total`. The tile only renders total / byRayon.
        ownFunds: bgnToMoney(0),
        stateSubsidy: bgnToMoney(0),
        euFunds: bgnToMoney(0),
        total: bgnToMoney(colF),
      });
    }
  }

  if (!totalRecap) {
    totalRecap = bgnToMoney(projects.reduce((s, p) => s + p.total.amount, 0));
  }

  // ---- Per-район rollup ------------------------------------------------
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
      cur.total = bgnToMoney(cur.total.amount + p.total.amount);
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

  // ---- Recapitulation by paragraph -------------------------------------
  const byParagraph: SofiaCapitalParagraph[] = [...paragraphs.entries()].map(
    ([code, p]) => ({
      code,
      labelBg: p.labelBg,
      // Same funding-trio caveat as projects above.
      ownFunds: bgnToMoney(0),
      stateSubsidy: bgnToMoney(0),
      euFunds: bgnToMoney(0),
      total: p.total,
    }),
  );

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Столична община",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Уточнен план)`,
      url: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
    },
    currency: "BGN",
    recapitulation: {
      total: {
        ownFunds: bgnToMoney(0),
        stateSubsidy: bgnToMoney(0),
        euFunds: bgnToMoney(0),
        total: totalRecap,
      },
      byParagraph,
    },
    projects,
    byRayon,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2022;
  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `sofia-${fiscalYear}.xlsx`,
  );
  console.log(`[sofia-capital-2022] parsing ${xlsxPath} (year ${fiscalYear})`);
  const parsed = parse(xlsxPath, fiscalYear);

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
    `[sofia-capital-2022] wrote ${outPath} — ${parsed.projects.length} projects, €${(
      totalEur / 1_000_000
    ).toFixed(1)}M total`,
  );
  const tagged = parsed.projects.filter((p) => p.rayons.length > 0).length;
  console.log(
    `[sofia-capital-2022] район tagging: ${tagged}/${parsed.projects.length} projects (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log(`[sofia-capital-2022] top 5 райони by amount:`);
  for (const r of parsed.byRayon.slice(0, 5)) {
    console.log(
      `  ${r.labelBg.padEnd(18)} ${r.projectCount.toString().padStart(2)} projects  €${(
        r.total.amountEur / 1_000_000
      ).toFixed(1)}M`,
    );
  }
};

main();
