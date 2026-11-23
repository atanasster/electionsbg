// НФК (Национален фонд „Култура") grant-results ingest → data/culture/grants.json.
// Parses the класиране (ranking) PDFs — one per program/session — into per-
// application records with the funding decision, so we can compute the SUCCESS
// RATE (applied vs funded) per discipline, the differentiator no BG site shows.
//
//   pnpm exec tsx scripts/culture/ncf_grants.ts            # cache-first
//   pnpm exec tsx scripts/culture/ncf_grants.ts --force    # re-download
//
// The class PDFs are Google-Sheets exports with a real text layer (no OCR).
// Requires `pdftotext` (poppler) on PATH. Results URLs are not enumerable from a
// clean index, so NCF_RESULTS is a CURATED, extensible map (like the judiciary's
// VSS_ANNUAL_TABLES) — coverage is the programs listed here, add URLs as sessions
// publish. Each row: Номер · Кандидат · Входящ № · Проект · … · Искана сума ·
// точки · Предложено финансиране (an amount in лв, or „0 лв." when not funded).
//
// TWO PDF FORMATS (ResultDef.format):
//   "lv-layout" — the 2025 sheets: amounts in лв, row number + входящ № on one
//                 line, read from `pdftotext -layout`.
//   "eur-raw"   — the 2026 sheets (post-euro): amounts in €, the входящ № split
//                 over two lines, read from `pdftotext -raw`, whose stream order
//                 is row-sequential: № · кандидат · входящ · €бюджет €искана ·
//                 резюме · „точки €предложено" · становище.
//
// ⚠️ „РЕЗЕРВА" IS NOT FUNDED. Both formats propose an amount for reserve-list
// rows too („Проектът се предлага за финансиране при наличие на средства.
// Резерва."). Counting them as funded published SGP 2025 at 212/243 (87%) when
// the firm awards were 74, and Мобилност 2026-1 at 130/153 against a €300k
// budget for BOTH sessions. A row is reserve when its own segment of the raw
// text (its входящ № up to the next one) carries the word „резерва" — the raw
// stream keeps each становище with its row, which -layout does not. Reserve rows
// are reported separately (reserve / reserveEur), never as funded.
//
// SINCE POST #755 (20.11.2026) results are published on konkursi.ncf.bg, the
// fund's electronic system, and are ENUMERABLE — every competition with
// announced results is ingested automatically (ncf_konkursi.ts), no curation.
// NCF_RESULTS stays for the PDF-era sessions only; a programme appearing in both
// fails the run rather than being counted twice.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { BGN_PER_EUR } from "../../src/lib/currency";
import { BROWSER_UA } from "./sources";
import {
  checkFundingTotal,
  fetchResultDocument,
  konkursiRows,
  listAnnounced,
  programmeEn,
  resultsUrl,
} from "./ncf_konkursi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/culture/ncf");
const OUT = path.resolve(__dirname, "../../data/culture/grants.json");

interface ResultDef {
  code: string;
  /** PDF layout — see the header. Defaults to "lv-layout". */
  format?: "lv-layout" | "eur-raw";
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
  {
    // News post #746 (13.10.2026). The 2026 sheet is € and a different layout
    // from the 2025 Мобилност file excluded below, hence its own parser.
    code: "MOB",
    year: 2026,
    slug: "mob_2026_s1",
    format: "eur-raw",
    url: "https://ncf.bg/web/files/richeditor/rezultati_mobilnost_sesia1_2026.pdf",
    bg: "Мобилност 2026 — сесия 1",
    en: "Mobility 2026 — session 1",
  },
];

// NOT INCLUDED — verified: their класиране PDFs use a DIFFERENT layout the parser
// above mis-reads (мобилност has no date columns; любителско uses non-sequential
// submission numbers; small-grant funding is plain, not comma-grouped), so the
// funded amounts came out implausibly low. Publishing a wrong success rate is
// worse than fewer programmes. Each needs a per-format parser before inclusion:
//   Създаване малки проекти — .../Rezultati%20-%20Suzdavane%20-%20malki%20proekti%202025.pdf
//   Културно наследство      — .../Results_KN_2025.pdf
//   Мобилност (2025)         — .../Results_Mob_2025.pdf  (2026 is in, format eur-raw)
//   Превод/Адаптация         — .../Results_Translation_2025.pdf
//   Любителско изкуство      — .../rezultati/final-LI-2025.pdf
// Also NOT INCLUDED, for a stronger reason — "Целева подкрепа Творческа Европа"
// 2026 (session 1, news post 714, .../results-2026/…session 1.pdf): that PDF is a
// technical-committee ELIGIBILITY opinion (Входящ номер | Кандидат | Име на
// проекта | становище) and carries no funding-amount column at all, so there is
// no applied-vs-funded ratio to compute. It is not a класиране in this parser's
// sense and should stay out even once a per-format parser exists for the five
// above.

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
  /** Amounts in EUR (лв sheets converted at the peg). */
  requested: number;
  /** The proposed amount — for a reserve row this is NOT an award. */
  proposed: number;
  reserve: boolean;
}

// Cyrillic letters that look Latin, as typed into a входящ № („МОВ12026V-30").
const HOMOGLYPHS: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
};
const foldCode = (s: string) =>
  s.replace(/[АВЕКМНОРСТХ]/g, (c) => HOMOGLYPHS[c]);
// A входящ №: „25SRGPM-21" (2025) or „MOB12026E-15" (2026, may wrap after the dash).
const IN_NO = /\b(\d{2}[A-Z]{2,8}|[A-Z]{2,8}\d?\d{4}[A-Z]{1,3})-\s*(\d+)\b/g;
// Cyrillic-safe word boundary — \b is ASCII-only, so „Резерват" would match it.
const RESERVE = /(?<![\p{L}\p{N}])резерва(?![\p{L}\p{N}])/iu;

const rawText = (pdfPath: string): string => {
  const txtPath = pdfPath.replace(/\.pdf$/, ".raw.txt");
  execSync(`pdftotext -raw "${pdfPath}" "${txtPath}"`);
  return fs.readFileSync(txtPath, "utf8");
};

/** Split the raw stream at each входящ №; each segment is that row's own text.
 *  The fold is char-for-char, so offsets in the folded copy index the original. */
const rawSegments = (raw: string): { inNo: string; text: string }[] => {
  const folded = foldCode(raw);
  const ms = [...folded.matchAll(IN_NO)];
  return ms.map((m, i) => ({
    inNo: `${m[1]}-${m[2]}`,
    text: raw.slice(
      m.index!,
      i + 1 < ms.length ? ms[i + 1].index! : raw.length,
    ),
  }));
};

const reserveSet = (raw: string): Set<string> =>
  new Set(
    rawSegments(raw)
      .filter((s) => RESERVE.test(s.text))
      .map((s) => s.inNo),
  );

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

const parseLvLayout = (pdfPath: string): GrantRow[] => {
  const txtPath = pdfPath.replace(/\.pdf$/, ".txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
  const txt = fs.readFileSync(txtPath, "utf8");

  const blocks: { inNo: string; text: string }[] = [];
  let cur: { inNo: string; text: string } | null = null;
  for (const ln of txt.split("\n")) {
    const m = ROW_START.exec(ln);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { inNo: foldCode(m[2]), text: ln };
    } else if (cur) cur.text += " " + ln;
  }
  if (cur) blocks.push(cur);

  const reserves = reserveSet(rawText(pdfPath));
  return blocks.map((b) => {
    const discipline = disciplineOf(b.inNo);
    // The two ints after the two ISO dates are total-budget + requested-sum.
    const afterDates =
      b.text.split(/\d{4}-\d{2}-\d{2}\s+\d{4}-\d{2}-\d{2}/)[1] ?? "";
    const ints = (afterDates.match(/\b\d{4,7}\b/g) ?? []).map(Number);
    const requestedBgn = ints.length >= 2 ? ints[1] : (ints[0] ?? 0);
    const fm = FUNDING.exec(b.text);
    const fundedBgn = fm ? Number(fm[1].replace(/,/g, "")) : 0;
    return {
      inNo: b.inNo,
      discipline,
      requested: requestedBgn / BGN_PER_EUR,
      proposed: fundedBgn / BGN_PER_EUR,
      reserve: reserves.has(b.inNo),
    };
  });
};

// 2026 € sheet: within a row's segment the first two € figures are бюджет +
// искана сума, and the „<точки> €<сума>" line is the proposed financing.
const EUR_AMT = /€([\d,]+\.\d{2})/g;
const EUR_PROPOSED = /\n\d+(?:\.\d+)? €([\d,]+\.\d{2})\s*\n/;
const num = (s: string) => Number(s.replace(/,/g, ""));

const parseEurRaw = (pdfPath: string): GrantRow[] =>
  rawSegments(rawText(pdfPath)).map((seg) => {
    const amts = [...seg.text.matchAll(EUR_AMT)].map((m) => num(m[1]));
    const pm = EUR_PROPOSED.exec(seg.text);
    if (amts.length < 3 || !pm)
      throw new Error(
        `НФК ${seg.inNo}: expected бюджет/искана/предложено € figures — layout drift`,
      );
    return {
      inNo: seg.inNo,
      discipline: disciplineOf(seg.inNo),
      requested: amts[1],
      proposed: num(pm[1]),
      reserve: RESERVE.test(seg.text),
    };
  });

const parsePdf = (def: ResultDef, pdfPath: string): GrantRow[] =>
  def.format === "eur-raw" ? parseEurRaw(pdfPath) : parseLvLayout(pdfPath);

const eur = (x: number) => Math.round(x);

interface ProgramSource {
  code: string;
  year: number;
  slug: string;
  url: string;
  bg: string;
  en: string;
  currency: "BGN" | "EUR";
  rows: GrantRow[];
  ineligible?: number;
  withdrawn?: number;
}

const main = async () => {
  const force = process.argv.includes("--force");
  const programs = [];
  let totApplied = 0,
    totFunded = 0,
    totReserve = 0,
    totFundedEur = 0,
    totReserveEur = 0,
    totRequestedEur = 0;

  // Every programme, from either source, in ONE shape — the aggregation below
  // does not know which source a row came from.
  const sources: ProgramSource[] = [];
  for (const def of NCF_RESULTS) {
    const pdf = await fetchPdf(def, force);
    sources.push({
      ...def,
      currency: def.format === "eur-raw" ? "EUR" : "BGN",
      rows: parsePdf(def, pdf),
    });
  }
  for (const comp of await listAnnounced()) {
    const doc = await fetchResultDocument(comp.id);
    checkFundingTotal(comp, doc);
    const { rows, ineligible, withdrawn } = konkursiRows(doc);
    const code = comp.documentRegisterActivity || `K${comp.id}`;
    if (NCF_RESULTS.some((d) => d.code === code && d.year === comp.year))
      throw new Error(
        `НФК ${code} ${comp.year} is both a curated PDF and a konkursi.ncf.bg competition — drop the curated entry`,
      );
    sources.push({
      code,
      year: comp.year,
      slug: `konkursi_${comp.id}`,
      url: resultsUrl(comp.id),
      bg: `${comp.name.trim()} ${comp.year}`,
      en: `${programmeEn(comp.name)} ${comp.year}`,
      currency: "EUR",
      rows,
      ineligible,
      withdrawn,
    });
  }

  for (const def of sources) {
    const rows = def.rows;
    if (rows.length === 0)
      throw new Error(`НФК ${def.slug}: parsed 0 rows — parser/source drift`);
    const dupes = rows.length - new Set(rows.map((r) => r.inNo)).size;
    if (dupes > 0)
      throw new Error(
        `НФК ${def.slug}: ${dupes} duplicate входящ № — parser drift`,
      );

    const isFunded = (r: GrantRow) => r.proposed > 0 && !r.reserve;
    const isReserve = (r: GrantRow) => r.proposed > 0 && r.reserve;
    const applied = rows.length;
    const funded = rows.filter(isFunded).length;
    const reserve = rows.filter(isReserve).length;
    const fundedEur = rows.filter(isFunded).reduce((s, r) => s + r.proposed, 0);
    const reserveEur = rows
      .filter(isReserve)
      .reduce((s, r) => s + r.proposed, 0);
    const requestedEur = rows.reduce((s, r) => s + r.requested, 0);

    const discMap = new Map<
      string,
      {
        discipline: string;
        applied: number;
        funded: number;
        reserve: number;
        fundedEur: number;
      }
    >();
    for (const r of rows) {
      const d = discMap.get(r.discipline) ?? {
        discipline: r.discipline,
        applied: 0,
        funded: 0,
        reserve: 0,
        fundedEur: 0,
      };
      d.applied += 1;
      if (isFunded(r)) {
        d.funded += 1;
        d.fundedEur += r.proposed;
      }
      if (isReserve(r)) d.reserve += 1;
      discMap.set(r.discipline, d);
    }
    const byDiscipline = [...discMap.values()]
      .map((d) => ({
        discipline: d.discipline,
        label: DISCIPLINE[d.discipline] ?? DISCIPLINE.other,
        applied: d.applied,
        funded: d.funded,
        reserve: d.reserve,
        fundedEur: eur(d.fundedEur),
      }))
      .sort((a, b) => b.fundedEur - a.fundedEur);

    programs.push({
      code: def.code,
      year: def.year,
      label: { bg: def.bg, en: def.en },
      url: def.url,
      currency: def.currency,
      applied,
      funded,
      reserve,
      successRate: applied > 0 ? funded / applied : 0,
      requestedEur: eur(requestedEur),
      fundedEur: eur(fundedEur),
      reserveEur: eur(reserveEur),
      // Not in `applied`: never evaluated (ineligible) or pulled by the
      // applicant. Only konkursi.ncf.bg publishes these lists.
      ...(def.ineligible != null && { ineligible: def.ineligible }),
      ...(def.withdrawn != null && { withdrawn: def.withdrawn }),
      byDiscipline,
    });
    totApplied += applied;
    totFunded += funded;
    totReserve += reserve;
    totFundedEur += fundedEur;
    totReserveEur += reserveEur;
    totRequestedEur += requestedEur;
    console.log(
      `  ${def.slug}: ${funded}/${applied} funded (${Math.round((100 * funded) / applied)}%) · €${(fundedEur / 1e6).toFixed(2)}M of €${(requestedEur / 1e6).toFixed(2)}M requested · ${reserve} in reserve (€${(reserveEur / 1e6).toFixed(2)}M, not counted)`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национален фонд „Култура“ (НФК)",
      url: "https://ncf.bg/bg/novini",
      description:
        "Класиране на проектите по програмите на Национален фонд „Култура“ — брой кандидатствали и финансирани проекти (успеваемост) и разпределените суми по област, от публикуваните класирания (PDF) и от електронната система за кандидатстване konkursi.ncf.bg. Сумите от класиранията в лева са конвертирани в евро по фиксирания курс; от 2026 г. класиранията са в евро. Проектите в резерва (финансирани само при наличие на средства) не се броят за финансирани.",
    },
    totalApplied: totApplied,
    totalFunded: totFunded,
    totalReserve: totReserve,
    overallSuccessRate: totApplied > 0 ? totFunded / totApplied : 0,
    totalFundedEur: eur(totFundedEur),
    totalReserveEur: eur(totReserveEur),
    totalRequestedEur: eur(totRequestedEur),
    programs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `\n✓ ${totFunded}/${totApplied} funded (${Math.round((100 * totFunded) / totApplied)}%) across ${programs.length} program(s) · €${(totFundedEur / 1e6).toFixed(1)}M · ${totReserve} reserve → data/culture/grants.json`,
  );
};

main().catch((e) => {
  console.error("НФК grants ingest failed:", e);
  process.exit(1);
});
