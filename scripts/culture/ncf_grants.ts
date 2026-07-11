// НФК (Национален фонд „Култура") grant-results ingest → data/culture/grants.json.
// Parses the класиране (ranking) PDFs — one per program/session — into per-
// application records with the funding decision, so we can compute the SUCCESS
// RATE (applied vs funded) per discipline, the differentiator no BG site shows.
//
//   npx tsx scripts/culture/ncf_grants.ts            # cache-first
//   npx tsx scripts/culture/ncf_grants.ts --force    # re-download
//
// The class PDFs are Google-Sheets exports with a real text layer (no OCR).
// Requires `pdftotext` (poppler) on PATH. Results URLs are not enumerable from a
// clean index, so NCF_RESULTS is a CURATED, extensible map (like the judiciary's
// VSS_ANNUAL_TABLES) — coverage is the programs listed here, add URLs as sessions
// publish. Each row: Номер · Кандидат · Входящ № · Проект · … · Искана сума ·
// точки · Предложено финансиране (an amount in лв, or „0 лв." when not funded).

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { BGN_PER_EUR } from "../../src/lib/currency";
import { BROWSER_UA } from "./sources";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/culture/ncf");
const OUT = path.resolve(__dirname, "../../data/culture/grants.json");

interface ResultDef {
  code: string;
  year: number;
  slug: string;
  url: string;
  bg: string;
  en: string;
}

// Curated results list. Extend as НФК publishes new класиране PDFs (the results
// are scattered across news posts; there is no clean index).
const NCF_RESULTS: ResultDef[] = [
  {
    code: "SGP",
    year: 2025,
    slug: "sgp_2025",
    url: "https://ncf.bg/web/files/richeditor/2025-rezultati/123SGP_Results_2025.pdf",
    bg: "Създаване и разпространение — големи проекти",
    en: "Creation & dissemination — large projects",
  },
  {
    code: "DEB",
    year: 2025,
    slug: "deb_2025",
    url: "https://ncf.bg/web/files/richeditor/2025-rezultati/Debuts_Results_2025.pdf",
    bg: "Дебюти",
    en: "Debuts",
  },
];

// NOT INCLUDED — verified: their класиране PDFs use a DIFFERENT layout the parser
// above mis-reads (мобилност has no date columns; любителско uses non-sequential
// submission numbers; small-grant funding is plain, not comma-grouped), so the
// funded amounts came out implausibly low. Publishing a wrong success rate is
// worse than fewer programmes. Each needs a per-format parser before inclusion:
//   Създаване малки проекти — .../Rezultati%20-%20Suzdavane%20-%20malki%20proekti%202025.pdf
//   Културно наследство      — .../Results_KN_2025.pdf
//   Мобилност                — .../Results_Mob_2025.pdf
//   Превод/Адаптация         — .../Results_Translation_2025.pdf
//   Любителско изкуство      — .../rezultati/final-LI-2025.pdf

const DISCIPLINE: Record<string, { bg: string; en: string }> = {
  music: { bg: "Музика", en: "Music" },
  visual: { bg: "Визуални изкуства", en: "Visual arts" },
  theatre: { bg: "Театър", en: "Theatre" },
  literature: { bg: "Литература", en: "Literature" },
  screen: { bg: "Екранни изкуства", en: "Screen arts" },
  dance: { bg: "Танц", en: "Dance" },
  other: { bg: "Друго", en: "Other" },
};
// Discipline from the LAST letter of the входящ code before the dash (25SRGP**M**-21
// → music; 25MOB**E**-8 → screen), with a special case for the „TP" (dance) suffix.
// Programmes with no discipline split (e.g. 25KNN- Културно наследство) fall to "other".
const DISC_FROM_LAST: Record<string, string> = {
  M: "music",
  V: "visual",
  T: "theatre",
  L: "literature",
  E: "screen",
};
const disciplineOf = (inNo: string): string => {
  if (inNo.includes("TP-")) return "dance";
  const last = /([A-Z])-\d+$/.exec(inNo)?.[1] ?? "";
  return DISC_FROM_LAST[last] ?? "other";
};

interface GrantRow {
  inNo: string;
  discipline: string;
  requestedBgn: number;
  fundedBgn: number;
}

const fetchPdf = async (def: ResultDef, force: boolean): Promise<string> => {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, `${def.slug}.pdf`);
  if (force || !fs.existsSync(dest)) {
    const res = await fetch(def.url, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) throw new Error(`НФК ${def.slug}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return dest;
};

// A row begins on a line carrying the row number + the входящ code; the row body
// wraps over the following lines until the next such line.
const ROW_START = /^\s*(\d{1,3})\s+.*?(\d{2}[A-Z]{2,8}-\d+)/;
// The Предложено финансиране column: the first amount suffixed „лв." — comma-
// grouped (large programmes) or plain (small grants like „3000 лв.") or „0".
// The comma-grouped alternative is tried first so „60,000" isn't clipped to „60".
const FUNDING = /\b(\d{1,3}(?:,\d{3})+|\d{1,6}|0)\s*лв\./;

const parsePdf = (pdfPath: string): GrantRow[] => {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
  const txt = fs.readFileSync(txtPath, "utf8");

  const blocks: { inNo: string; text: string }[] = [];
  let cur: { inNo: string; text: string } | null = null;
  for (const ln of txt.split("\n")) {
    const m = ROW_START.exec(ln);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { inNo: m[2], text: ln };
    } else if (cur) cur.text += " " + ln;
  }
  if (cur) blocks.push(cur);

  return blocks.map((b) => {
    const discipline = disciplineOf(b.inNo);
    // The two ints after the two ISO dates are total-budget + requested-sum.
    const afterDates =
      b.text.split(/\d{4}-\d{2}-\d{2}\s+\d{4}-\d{2}-\d{2}/)[1] ?? "";
    const ints = (afterDates.match(/\b\d{4,7}\b/g) ?? []).map(Number);
    const requestedBgn = ints.length >= 2 ? ints[1] : (ints[0] ?? 0);
    const fm = FUNDING.exec(b.text);
    const fundedBgn = fm ? Number(fm[1].replace(/,/g, "")) : 0;
    return { inNo: b.inNo, discipline, requestedBgn, fundedBgn };
  });
};

const toEur = (bgn: number) => Math.round(bgn / BGN_PER_EUR);

const main = async () => {
  const force = process.argv.includes("--force");
  const programs = [];
  let totApplied = 0,
    totFunded = 0,
    totFundedBgn = 0,
    totRequestedBgn = 0;

  for (const def of NCF_RESULTS) {
    const pdf = await fetchPdf(def, force);
    const rows = parsePdf(pdf);
    if (rows.length === 0)
      throw new Error(`НФК ${def.slug}: parsed 0 rows — parser/source drift`);

    const applied = rows.length;
    const funded = rows.filter((r) => r.fundedBgn > 0).length;
    const fundedBgn = rows.reduce((s, r) => s + r.fundedBgn, 0);
    const requestedBgn = rows.reduce((s, r) => s + r.requestedBgn, 0);

    const discMap = new Map<
      string,
      { discipline: string; applied: number; funded: number; fundedBgn: number }
    >();
    for (const r of rows) {
      const d = discMap.get(r.discipline) ?? {
        discipline: r.discipline,
        applied: 0,
        funded: 0,
        fundedBgn: 0,
      };
      d.applied += 1;
      if (r.fundedBgn > 0) d.funded += 1;
      d.fundedBgn += r.fundedBgn;
      discMap.set(r.discipline, d);
    }
    const byDiscipline = [...discMap.values()]
      .map((d) => ({
        discipline: d.discipline,
        label: DISCIPLINE[d.discipline] ?? DISCIPLINE.other,
        applied: d.applied,
        funded: d.funded,
        fundedEur: toEur(d.fundedBgn),
      }))
      .sort((a, b) => b.fundedEur - a.fundedEur);

    programs.push({
      code: def.code,
      year: def.year,
      label: { bg: def.bg, en: def.en },
      url: def.url,
      applied,
      funded,
      successRate: applied > 0 ? funded / applied : 0,
      requestedEur: toEur(requestedBgn),
      fundedEur: toEur(fundedBgn),
      byDiscipline,
    });
    totApplied += applied;
    totFunded += funded;
    totFundedBgn += fundedBgn;
    totRequestedBgn += requestedBgn;
    console.log(
      `  ${def.slug}: ${funded}/${applied} funded (${Math.round((100 * funded) / applied)}%) · €${(toEur(fundedBgn) / 1e6).toFixed(2)}M of €${(toEur(requestedBgn) / 1e6).toFixed(2)}M requested`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национален фонд „Култура“ (НФК)",
      url: "https://ncf.bg/bg/novini",
      description:
        "Класиране на проектите по програмите на Национален фонд „Култура“ — брой кандидатствали и финансирани проекти (успеваемост) и разпределените суми по област, от публикуваните резултати (PDF). Сумите са в лева, конвертирани в евро.",
    },
    totalApplied: totApplied,
    totalFunded: totFunded,
    overallSuccessRate: totApplied > 0 ? totFunded / totApplied : 0,
    totalFundedEur: toEur(totFundedBgn),
    totalRequestedEur: toEur(totRequestedBgn),
    programs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\n✓ ${totFunded}/${totApplied} funded (${Math.round((100 * totFunded) / totApplied)}%) across ${programs.length} program(s) · €${(toEur(totFundedBgn) / 1e6).toFixed(1)}M → data/culture/grants.json`,
  );
};

main().catch((e) => {
  console.error("НФК grants ingest failed:", e);
  process.exit(1);
});
