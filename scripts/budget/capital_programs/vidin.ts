// Parser for Видин's annual capital expenditures report.
//
// Vidin's "Отчет за капиталови разходи" is published as a .doc file
// inside the year-end RAR bundle on vidin.bg (the cash-execution
// quarterly report archive). The .doc structure is intentionally
// human-readable: 1.1 / 1.2 / … function headings, then a flat list
// of `- <Description>, <settlement> - <amount> лв.;` bullets.
//
// We convert the .doc → .txt via macOS `textutil` (or `libreoffice
// --headless` on Linux) into raw_data/budget/capital_programs/
// vidin-YYYY.txt, then walk the lines with regex. No OCR / Gemini
// cost — the .doc is born-text, just packaged behind a CMS RAR.
//
// Source workflow (for a fresh year):
//   1. Download the RAR bundle from vidin.bg into ~/Downloads/, e.g.
//        Отчет+за+касово+изпълнение+на+бюджета*<year>г.rar
//   2. Extract with `unar` (proper RAR5 support; macOS unrar fails):
//        unar -o /tmp/vidin-<year> "<that rar path>"
//   3. Copy "ОТЧЕТ КАПИТАЛОВИ РАЗХОДИ <year>.doc" into
//        raw_data/budget/capital_programs/vidin-<year>.doc
//   4. Convert to text:
//        textutil -convert txt -encoding utf-8 \
//          -output raw_data/budget/capital_programs/vidin-<year>.txt \
//          raw_data/budget/capital_programs/vidin-<year>.doc
//   5. Run: tsx scripts/budget/capital_programs/vidin.ts --year <year>
//
// Vidin obshtina = VID09, EKATTE 10971. 34 settlements: city + town
// Дунавци + 32 villages. The .doc tags each project's settlement
// inline ("гр.Видин", "с.Бела Рада", "с.Бeла Рада" with NBSP variants).
//
// Year coverage:
//   2022 — operator-fetched, NB recap inconsistency (see PUBLISHED_RECAPS)
//   2023 — operator-fetched, clean
//   2024 — not available on vidin.bg as of 2026-05-27 (the 2024 year-end
//          quarterly report archive has not been uploaded). Skip until
//          a future watcher probe surfaces it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

interface VidinCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface VidinCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface VidinCapitalProgramFile {
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
  projects: VidinCapitalProject[];
  bySettlement: VidinCapitalSettlementRollup[];
}

// 34 settlements of Vidin município (VID09). The .doc uses both space
// and non-breaking-space variants ("гр. Видин" vs "гр.Видин"); the
// regex handles both via `\s*`.
const VID_SETTLEMENTS: Array<{ name: string; prefix: string }> = [
  { name: "Видин", prefix: "гр." },
  { name: "Дунавци", prefix: "гр." },
  { name: "Акациево", prefix: "с." },
  { name: "Антимово", prefix: "с." },
  { name: "Бела Рада", prefix: "с." },
  { name: "Ботево", prefix: "с." },
  { name: "Буковец", prefix: "с." },
  { name: "Войница", prefix: "с." },
  { name: "Въртоп", prefix: "с." },
  { name: "Гайтанци", prefix: "с." },
  { name: "Генерал Мариново", prefix: "с." },
  { name: "Гомотарци", prefix: "с." },
  { name: "Градец", prefix: "с." },
  { name: "Динковица", prefix: "с." },
  { name: "Долни Бошняк", prefix: "с." },
  { name: "Дружба", prefix: "с." },
  { name: "Жеглица", prefix: "с." },
  { name: "Ивановци", prefix: "с." },
  { name: "Иново", prefix: "с." },
  { name: "Каленик", prefix: "с." },
  { name: "Капитановци", prefix: "с." },
  { name: "Кошава", prefix: "с." },
  { name: "Кутово", prefix: "с." },
  { name: "Майор Узуново", prefix: "с." },
  { name: "Новоселци", prefix: "с." },
  { name: "Пешаково", prefix: "с." },
  { name: "Плакудер", prefix: "с." },
  { name: "Покрайна", prefix: "с." },
  { name: "Рупци", prefix: "с." },
  { name: "Цар Симеоново", prefix: "с." },
  { name: "Синаговци", prefix: "с." },
  { name: "Слана бара", prefix: "с." },
  { name: "Сланотрън", prefix: "с." },
  { name: "Търняне", prefix: "с." },
];

// Longest-first match so "Бела Рада" wins over a fragment.
const SETTLEMENT_PATTERNS = VID_SETTLEMENTS.slice()
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, prefix }) => ({
    display: `${prefix} ${name}`,
    re: new RegExp(
      // Allow NBSP / regular space between prefix and name.
      prefix.replace(/\./g, "\\.") +
        "\\s*" +
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "u",
    ),
  }));

const extractSettlement = (desc: string): string | null => {
  for (const { display, re } of SETTLEMENT_PATTERNS) {
    if (re.test(desc)) return display;
  }
  return null;
};

const parseAmount = (raw: string): number => {
  const cleaned = raw.replace(new RegExp("[\\s,   ]", "g"), "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

// Each bullet looks like:
//   - <Description ...>, <location-context>, <settlement> - <amount> лв.;
// Anchor: line starts (after optional whitespace) with "- " and ends
// with " - <number> лв.;" (or " лв." with no semicolon). The amount may
// contain regular spaces or NBSPs as thousands separators.
const PROJECT_RE =
  /^[\s\u00A0]*-\s+(.+?)\s+-\s+([\d\s\u00A0]+)\s*лв\.?[;]?\s*$/u;

const SOURCE_URLS: Record<number, string> = {
  2022: "https://vidin.bg/", // .doc inside year-end RAR (4-то тримесечие 2022) — operator-fetched
  2023: "https://vidin.bg/", // packaged inside the year-end RAR — vidin.bg lists the article but the actual file is operator-fetched
};

const PUBLISHED_RECAPS: Record<number, number> = {
  // From the recap paragraph at the top of each .doc.
  // 2022: "Отчета за капиталови разходи е в размер на 7 149 769 лв."
  //   NB: the 2022 doc has an internal inconsistency — the recap states
  //   7.15M лв but the section totals (1=10.48M, 2=2.12M, 3=0.005M) and
  //   bullets both sum to ~12.6M лв. We keep the source-stated number
  //   here for fidelity; the tile shows the itemised total as headline.
  // 2023: "Отчета за капиталови разходи е в размер на 33 056 660 лв." (clean)
  2022: 7_149_769,
  2023: 33_056_660,
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2023;

  const txtPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `vidin-${fiscalYear}.txt`,
  );
  if (!existsSync(txtPath)) {
    throw new Error(
      `Missing text file at ${txtPath} — convert the .doc via textutil first ` +
        `(see workflow comment at top of vidin.ts)`,
    );
  }
  const text = readFileSync(txtPath, "utf-8");
  console.log(
    `[vidin-capital] reading ${txtPath} (year ${fiscalYear}, ${text.length} bytes)`,
  );

  const projects: VidinCapitalProject[] = [];
  let projectId = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\u00A0/g, " ").trim();
    const m = line.match(PROJECT_RE);
    if (!m) continue;
    const desc = m[1].trim();
    const amt = parseAmount(m[2]);
    if (amt <= 0) continue;
    projectId += 1;
    projects.push({
      id: projectId,
      name: desc.replace(/\s+/g, " "),
      settlement: extractSettlement(desc),
      total: bgnToMoney(amt),
    });
  }

  console.log(`[vidin-capital] matched ${projects.length} project bullets`);

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: VidinCapitalProject[] }
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
  const bySettlement: VidinCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );
  const publishedRecap = PUBLISHED_RECAPS[fiscalYear]
    ? bgnToMoney(PUBLISHED_RECAPS[fiscalYear])
    : null;

  const out: VidinCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Видин",
      documentTitle: `Отчет капиталови разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "VID09",
    municipalityNameBg: "Видин",
    municipalityNameEn: "Vidin",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "vidin.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[vidin-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      publishedRecap
        ? ` (published recap EUR ${(publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[vidin-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[vidin-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
