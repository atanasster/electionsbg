// Parser for Община Стара Загора's annual капиталова програма — Приложение
// № 4 to the council's budget decision, published as a born-digital PDF on
// starazagora.bg.
//
// 2025 source:
//   https://www.starazagora.bg/uploads/posts/2025/2025_05_29_prilozhenia_byudzhet_2025.zip
//   (contains "pr 4 KV  2025.pdf" — 12 pages. The published "КАПИТАЛОВИ
//   РАЗХОДИ - ОБЩО" recap is 57,275,109 BGN ≈ EUR 29.3M.)
//
// Extraction strategy: shell out to `pdftotext -layout` (poppler-utils)
// for line-based table extraction. The older pdfjs positional approach
// captured only 317 of ~370 project rows in 2025 because some descriptions
// wrapped over multiple y-baselines and the "closest col-A line" heuristic
// dropped them. pdftotext aligns multi-column rows by whitespace which
// works much better for this layout. Each line is parsed as
// "<description>   <amount>   ...funding-source columns..." and the
// description gets a fragment-rejection pass to drop wrap continuations
// (lines that start with closing punctuation or a lowercase letter, or
// that are too short to be a standalone description).
//
// Per-village tagging via "с. NAME" / "с.NAME" against the 51 known
// villages of obshtina Стара Загора (hardcoded — keeps the parser
// self-contained).
//
// Recap convention: the published "КАПИТАЛОВИ РАЗХОДИ - ОБЩО" line
// (57.3M BGN) includes paragraph-level rollups + city-wide commitments
// that don't decompose to individual line items in the PDF. Sum of
// captured items is ~26.9M BGN. Same situation as Ruse: we use the
// itemised sum as the tile's recap headline so what you see at the top
// equals what the per-project list adds up to.
//
// Stara Zagora isn't районирана; the tile renders the Burgas pattern
// (no район breakdown — recap + per-settlement strip + top projects).
//
// Run: tsx scripts/budget/capital_programs/stara_zagora.ts [--year 2025]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.starazagora.bg/uploads/posts/2025/2025_05_29_prilozhenia_byudzhet_2025.zip",
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

interface CapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface CapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface CapitalProgramFile {
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
  projects: CapitalProject[];
  bySettlement: CapitalSettlementRollup[];
}

// 51 villages in obshtina Стара Загора (SZR31), from data/settlements.json
// at parse time. Hardcoded to keep this parser self-contained — the list
// changes ~once a decade when a settlement is renamed or merged.
const SZ_VILLAGES = [
  "Арнаутито",
  "Бенковски",
  "Богомилово",
  "Борилово",
  "Борово",
  "Братя Кунчеви",
  "Бъдеще",
  "Воденичарово",
  "Горно Ботево",
  "Дълбоки",
  "Еленино",
  "Елхово",
  "Загоре",
  "Змейово",
  "Казанка",
  "Калитиново",
  "Калояновец",
  "Кирилово",
  "Козаревец",
  "Колена",
  "Ловец",
  "Люляк",
  "Лясково",
  "Маджерито",
  "Малка Верея",
  "Малко Кадиево",
  "Михайлово",
  "Могила",
  "Ново село",
  "Оряховица",
  "Остра могила",
  "Памукчии",
  "Петрово",
  "Плоска могила",
  "Подслон",
  "Преславен",
  "Пряпорец",
  "Пшеничево",
  "Пъстрово",
  "Ракитница",
  "Лозен",
  "Руманя",
  "Самуилово",
  "Сладък кладенец",
  "Хан Аспарухово",
  "Старозагорски бани",
  "Стрелец",
  "Сулица",
  "Християново",
  "Хрищени",
  "Яворово",
];

// Match "с. NAME" / "с.NAME" with NAME a known village. Longest first
// so "Сладък кладенец" wins over a bare "Сладък" match.
const SETTLEMENT_PATTERNS: Array<{ village: string; re: RegExp }> =
  SZ_VILLAGES.slice()
    .sort((a, b) => b.length - a.length)
    .map((v) => ({
      village: v,
      re: new RegExp(
        "(?:^|[\\s,(\\-/])с\\.\\s*" +
          v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          '(?:[\\s,)\\.\\-/"„“]|$)',
        "u",
      ),
    }));

const extractSettlement = (desc: string): string | null => {
  for (const { village, re } of SETTLEMENT_PATTERNS) {
    if (re.test(desc)) return village;
  }
  return null;
};

// Subtotal / heading prefixes — these never start a real project row.
const SKIP_PREFIX_RE = /^(§|ф-я|Д\.\s*\d|КАПИТАЛОВИ|Раздел|Обект|Други\s)/u;

// A "description" string is a fragment (wrap continuation) when it's too
// short to stand alone OR starts with punctuation/lowercase that suggests
// it's the tail of a wrapped line above. Real project descriptions
// always start with an uppercase Cyrillic letter or a quote / число in
// the project-ID range.
const isFragment = (s: string): boolean => {
  if (s.length < 12) return true;
  if (/^["“„'\-,).]/.test(s)) return true;
  if (/^[а-яё]/u.test(s)) return true;
  return false;
};

const parseProgram = (
  pdfPath: string,
  fiscalYear: number,
): CapitalProgramFile => {
  const res = spawnSync("pdftotext", ["-layout", pdfPath, "-"]);
  if (res.error) throw res.error;
  const text = res.stdout.toString();
  const lines = text.split(/\r?\n/);

  let publishedRecap: Money | null = null;
  const projects: CapitalProject[] = [];
  let projectId = 0;

  for (const line of lines) {
    if (line.length < 50) continue;
    // <description>{2+ whitespace}<amount> followed by another column.
    const m = line.match(/^(.+?)\s{2,}(\d{4,11})\s/u);
    if (!m) continue;
    const desc = m[1].trim();
    const amount = Number(m[2]);
    if (amount < 1000) continue;

    // Recap row — first match wins.
    if (!publishedRecap && /КАПИТАЛОВИ РАЗХОДИ\s*-\s*ОБЩО/.test(desc)) {
      publishedRecap = bgnToMoney(amount);
      continue;
    }

    // Subtotal / heading row.
    if (SKIP_PREFIX_RE.test(desc)) continue;
    // Free-standing settlement name (rare; defensive).
    if (/^с\.\s*[А-ЯЁа-яё\s]+$/u.test(desc)) continue;
    // Multi-line wrap continuation — the head of the description is on
    // a previous line we already processed (or it's a header noise row).
    if (isFragment(desc)) continue;

    projectId += 1;
    projects.push({
      id: projectId,
      name: desc,
      settlement: extractSettlement(desc),
      total: bgnToMoney(amount),
    });
  }

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: CapitalProject[] }
  >();
  for (const pr of projects) {
    if (!pr.settlement) continue;
    const cur = bySettlementAgg.get(pr.settlement) ?? {
      total: 0,
      projects: [],
    };
    cur.total += pr.total.amount;
    cur.projects.push(pr);
    bySettlementAgg.set(pr.settlement, cur);
  }
  const bySettlement: CapitalSettlementRollup[] = [...bySettlementAgg]
    .map(([name, agg]) => ({
      name,
      projectCount: agg.projects.length,
      total: bgnToMoney(agg.total),
      topProjects: agg.projects
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 5)
        .map((pr) => ({ id: pr.id, name: pr.name, total: pr.total })),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Use the itemised sum as the headline recap so the tile is internally
  // consistent. publishedRecap is kept on the JSON for reference.
  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Стара Загора",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Приложение №4)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "SZR31",
    municipalityNameBg: "Стара Загора",
    municipalityNameEn: "Stara Zagora",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap,
    projects,
    bySettlement,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `stara_zagora-${fiscalYear}.pdf`,
  );
  console.log(`[stara-zagora-capital] parsing ${pdfPath} (year ${fiscalYear})`);
  const parsed = parseProgram(pdfPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "stara_zagora.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[stara-zagora-capital] wrote ${outPath} — ${parsed.projects.length} projects, itemised total EUR ${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M (published recap EUR ${
      parsed.publishedRecap
        ? (parsed.publishedRecap.amountEur / 1_000_000).toFixed(1)
        : "—"
    }M)`,
  );
  const tagged = parsed.projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[stara-zagora-capital] village tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("\n[stara-zagora-capital] top settlements:");
  for (const s of parsed.bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
