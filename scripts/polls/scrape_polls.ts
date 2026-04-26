/**
 * Scrape Bulgarian parliamentary polling data from BG Wikipedia and merge with
 * any existing data in public/polls/.
 *
 * Wikipedia's "Парламентарни избори в България (YYYY)" pages embed a wikitable
 * with: agency, fieldwork period, sample size, then one column per party. The
 * first data row is the actual CEC result (skipped — we use national_summary.json
 * for the ground truth). Filler rows with colspan>1 (campaign-close markers) are
 * skipped too.
 *
 * Usage:
 *   tsx scripts/polls/scrape_polls.ts                 # scrape default cycles + merge
 *   tsx scripts/polls/scrape_polls.ts --seed-izboriai # one-time seed from izboriai
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean, option, string } from "cmd-ts";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, "../../public/polls");
const IZBORIAI_DIR = "/Users/atanasster/izboriai/public";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "bg,en;q=0.7",
};

type Lang = { en: string; bg: string };

type Agency = {
  id: string;
  website: string | null;
  name_bg: string;
  name_en: string;
  abbr_bg: string;
  abbr_en: string;
};

type Poll = {
  id: string;
  agencyId: string;
  fieldwork: string;
  electionDate: string | null;
  respondents: number | null;
  methodology: Lang;
  source: string;
};

type PollDetail = {
  pollId: string;
  agencyId: string;
  support: number;
  nickName_bg: string;
  nickName_en: string;
};

type Cycle = {
  url: string;
  electionDate: string | null; // ISO yyyy-mm-dd; null if inter-election cycle
};

// BG Wikipedia pages with embedded polling tables.
// Each cycle covers fieldwork from previous election → cycle's election (or today).
const CYCLES: Cycle[] = [
  {
    url: "https://bg.wikipedia.org/wiki/Парламентарни_избори_в_България_(2026)",
    electionDate: "2026-04-19",
  },
];

// Agency lookup keyed by lowercased aliases that may appear in Wikipedia tables.
// Add new entries here when an unknown agency surfaces during a scrape.
const AGENCY_ALIASES: { id: string; aliases: string[]; agency: Agency }[] = [
  {
    id: "AR",
    aliases: [
      "alpha research",
      "alpha reasearch",
      "алфа рисърч",
      "alpharesearch",
    ],
    agency: {
      id: "AR",
      website: "https://alpharesearch.bg/",
      name_bg: "Алфа Рисърч",
      name_en: "Alpha Research",
      abbr_bg: "АР",
      abbr_en: "AR",
    },
  },
  {
    id: "SH",
    aliases: ["sova haris", "sova harris", "сова харис"],
    agency: {
      id: "SH",
      website: "https://sovaharris.com/",
      name_bg: "Сова Харис",
      name_en: "Sova Harris",
      abbr_bg: "СХ",
      abbr_en: "SH",
    },
  },
  {
    id: "TR",
    aliases: ["trend", "тренд", "research center trend"],
    agency: {
      id: "TR",
      website: "https://rc-trend.bg/",
      name_bg: "Тренд",
      name_en: "Trend",
      abbr_bg: "ТР",
      abbr_en: "TR",
    },
  },
  {
    id: "GIB",
    aliases: [
      "gallup",
      "gallup international",
      "gallup international balkan",
      "галъп",
      "галъп интернешънъл",
      "галъп интернешънъл болкан",
    ],
    agency: {
      id: "GIB",
      website: "https://www.gallup-international.bg/",
      name_bg: "Галъп Интернешънъл Болкан",
      name_en: "Gallup Intl. Balkan",
      abbr_bg: "ГИБ",
      abbr_en: "GIB",
    },
  },
  {
    id: "MD",
    aliases: ["mediana", "медиана"],
    agency: {
      id: "MD",
      website: "http://www.mediana.bg/",
      name_bg: "Медиана",
      name_en: "Mediana",
      abbr_bg: "МД",
      abbr_en: "MD",
    },
  },
  {
    id: "ML",
    aliases: [
      "market links",
      "marketlinks",
      "маркет линкс",
      "маркет линкс",
      "маркет линкс",
    ],
    agency: {
      id: "ML",
      website: "https://www.marketlinks.bg/",
      name_bg: "Маркет ЛИНКС",
      name_en: "Market Links",
      abbr_bg: "МЛ",
      abbr_en: "ML",
    },
  },
  {
    id: "AF",
    aliases: ["afis", "афис"],
    agency: {
      id: "AF",
      website: "https://www.afis.bg/",
      name_bg: "АФИС",
      name_en: "AFIS",
      abbr_bg: "АФИС",
      abbr_en: "AFIS",
    },
  },
  {
    id: "MY",
    aliases: ["myara", "мяра"],
    agency: {
      id: "MY",
      website: null,
      name_bg: "Мяра",
      name_en: "Myara",
      abbr_bg: "МЯ",
      abbr_en: "MY",
    },
  },
  {
    id: "CAM",
    aliases: [
      "цам",
      "center for analysis and marketing",
      "цам - център за анализи и маркетинг",
      "център за анализи и маркетинг",
    ],
    agency: {
      id: "CAM",
      website: null,
      name_bg: "ЦАМ",
      name_en: "Center for Analysis and Marketing",
      abbr_bg: "ЦАМ",
      abbr_en: "CAM",
    },
  },
];

const MONTH_BG = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
];
const MONTH_EN_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const collapseSpaces = (s: string) => s.replace(/\s+/g, " ").trim();

const matchAgency = (text: string): { id: string; agency: Agency } | null => {
  const norm = text.toLowerCase().normalize("NFC");
  for (const entry of AGENCY_ALIASES) {
    for (const alias of entry.aliases) {
      if (norm.includes(alias)) return { id: entry.id, agency: entry.agency };
    }
  }
  return null;
};

// "7 – 14 април 2026"  →  { endIso: "2026-04-14", fieldwork: "Apr 7-14 2026" }
// "30 март – 5 април 2026" → { endIso: "2026-04-05", fieldwork: "Mar 30 - Apr 5 2026" }
// "19 април 2026" → { endIso: "2026-04-19", fieldwork: "Apr 19 2026" }
const parseFieldwork = (
  raw: string,
): { endIso: string; fieldwork: string } | null => {
  const cleaned = collapseSpaces(
    raw.replace(/[–—]/g, "-").replace(/\u00A0/g, " "),
  );
  // Possibilities:
  //   D-D MONTH YYYY
  //   D MONTH - D MONTH YYYY
  //   D MONTH YYYY
  const reRange = /^(\d{1,2})\s*-\s*(\d{1,2})\s+([а-я]+)\s+(\d{4})$/i;
  const reCross =
    /^(\d{1,2})\s+([а-я]+)\s*-\s*(\d{1,2})\s+([а-я]+)\s+(\d{4})$/i;
  const reSingle = /^(\d{1,2})\s+([а-я]+)\s+(\d{4})$/i;

  const monthIndex = (m: string) => MONTH_BG.indexOf(m.toLowerCase());

  let mr: RegExpMatchArray | null;
  if ((mr = cleaned.match(reCross))) {
    const [, d1, mo1Bg, d2, mo2Bg, year] = mr;
    const mo1 = monthIndex(mo1Bg);
    const mo2 = monthIndex(mo2Bg);
    if (mo1 < 0 || mo2 < 0) return null;
    const endIso = `${year}-${String(mo2 + 1).padStart(2, "0")}-${d2.padStart(2, "0")}`;
    const fieldwork = `${MONTH_EN_SHORT[mo1]} ${d1} - ${MONTH_EN_SHORT[mo2]} ${d2} ${year}`;
    return { endIso, fieldwork };
  }
  if ((mr = cleaned.match(reRange))) {
    const [, d1, d2, moBg, year] = mr;
    const mo = monthIndex(moBg);
    if (mo < 0) return null;
    const endIso = `${year}-${String(mo + 1).padStart(2, "0")}-${d2.padStart(2, "0")}`;
    const fieldwork = `${MONTH_EN_SHORT[mo]} ${d1}-${d2} ${year}`;
    return { endIso, fieldwork };
  }
  if ((mr = cleaned.match(reSingle))) {
    const [, d, moBg, year] = mr;
    const mo = monthIndex(moBg);
    if (mo < 0) return null;
    const endIso = `${year}-${String(mo + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
    const fieldwork = `${MONTH_EN_SHORT[mo]} ${d} ${year}`;
    return { endIso, fieldwork };
  }
  return null;
};

const parsePct = (cell: cheerio.Cheerio<Element>): number | null => {
  // Cells often look like  <b>44,6</b><br><small>131</small>  — the <small> holds the seat
  // count, not part of the percentage. cheerio's .text() concatenates without a separator,
  // so "44,6" + "131" would become "44,6131" → 44.6131. Strip <small> first, then prefer
  // <b>'s content if present.
  const clone = cell.clone();
  clone.find("small, sup, .reference").remove();
  const bold = clone.find("b").first();
  const raw = (bold.length ? bold.text() : clone.text()).trim();
  if (!raw || raw === "-" || raw === "—") return null;
  const first = raw.split(/\s/)[0];
  const num = parseFloat(first.replace(",", "."));
  return Number.isFinite(num) ? num : null;
};

const parseSample = (cellText: string): number | null => {
  // "1 003" / "1003" / "3 228 962" / "3228962"
  const cleaned = cellText.replace(/[\s\u00A0]/g, "").replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
};

// Pull the EN nickname for a party from existing izboriai/historical mappings.
const PARTY_EN: Record<string, string> = {
  "ГЕРБ-СДС": "GERB-SDS",
  "ГЕРБ – СДС": "GERB-SDS",
  ГЕРБ: "GERB",
  "ПП-ДБ": "PP-DB",
  "ПП – ДБ": "PP-DB",
  ПП: "We Continue the Change (PP)",
  ДБ: "Democratic Bulgaria",
  "Демократична България": "Democratic Bulgaria",
  Възраждане: "Revival",
  ДПС: "DPS",
  "ДПС – Ново начало": "DPS - New Beginning",
  "ДПС – НН": "DPS - New Beginning",
  "ДПС - Ново Начало": "DPS - New Beginning",
  "ДПС-НН": "DPS - New Beginning",
  "БСП за България": "BSP for Bulgaria",
  "БСП – Обединена левица": "BSP - United Left",
  "БСП - Обединена левица": "BSP - United Left",
  "БСП – ОЛ": "BSP - United Left",
  "БСП-ОЛ": "BSP - United Left",
  БСП: "BSP",
  АПС: "Alliance for Rights and Freedoms",
  "Алианс за права и свободи": "Alliance for Rights and Freedoms",
  ИТН: "ITN",
  МЕЧ: "MECh",
  Величие: "Velichie",
  "Прогресивна България": "Progressive Bulgaria",
  ПрБ: "Progressive Bulgaria",
  ПБ: "Progressive Bulgaria",
  Сияние: "Siyanie",
  "Български възход": "Bulgarian Rise",
  "Левицата!": "The Left!",
  "Изправи се! Мутри вън!": "Stand Up! Mafia Out!",
  "Изправи се БГ! Ние идваме": "Stand Up BG! We are coming!",
  "Изправи се.БГ": "Stand Up.BG",
  Атака: "Attack",
  "Обединени патриоти": "United Patriots",
};

const enFor = (bg: string): string => {
  const trimmed = bg.trim();
  return (
    PARTY_EN[trimmed] ??
    PARTY_EN[trimmed.replace(/\s*[–—]\s*/g, "-")] ??
    trimmed
  );
};

const HEADER_SKIP = new Set([
  "социологическа агенция",
  "агенция",
  "период на проучването",
  "период",
  "извадка",
  "проба",
  "други",
  "не подкрепям никого",
  "никого",
  "преднина",
]);

type ScrapedTable = {
  agencyHeader: number; // column index containing agency
  periodHeader: number;
  sampleHeader: number;
  partyColumns: { index: number; nickBg: string }[];
  rows: cheerio.Cheerio<Element>[];
};

const parseTable = (
  $: cheerio.CheerioAPI,
  table: Element,
): ScrapedTable | null => {
  const rows = $(table).find("> tbody > tr").toArray();
  if (!rows.length) return null;
  // Header row 1 is the meaningful one (party names). Subsequent header rows are color stripes.
  const headerCells = $(rows[0]).find("> th, > td").toArray();
  let agencyHeader = -1;
  let periodHeader = -1;
  let sampleHeader = -1;
  const partyColumns: { index: number; nickBg: string }[] = [];

  // Wikipedia uses rowspan="2" for narrow columns and one row of colored stripes for parties;
  // we still walk header row 1 by physical column index. Each <th> spans a single column unless
  // it has colspan (rare here for the polling table).
  let colIdx = 0;
  for (const th of headerCells) {
    const colspan = parseInt($(th).attr("colspan") ?? "1", 10) || 1;
    const text = collapseSpaces($(th).text()).toLowerCase();
    if (HEADER_SKIP.has(text)) {
      if (text.startsWith("социолог") || text === "агенция")
        agencyHeader = colIdx;
      if (text.startsWith("период")) periodHeader = colIdx;
      if (text === "извадка" || text === "проба") sampleHeader = colIdx;
    } else if (text) {
      partyColumns.push({
        index: colIdx,
        nickBg: collapseSpaces($(th).text()),
      });
    }
    colIdx += colspan;
  }
  if (agencyHeader < 0 || periodHeader < 0 || partyColumns.length === 0)
    return null;

  // Skip header rows. A row is a header row if it has only <th> children or the second row in
  // the polling table (color stripe). We treat any row whose first cell is <th> as header.
  const dataRows: cheerio.Cheerio<Element>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = $(row).find("> th, > td").first();
    if (firstCell.is("th")) continue; // header / color stripe
    dataRows.push($(row));
  }
  return {
    agencyHeader,
    periodHeader,
    sampleHeader,
    partyColumns,
    rows: dataRows,
  };
};

const cellByColIdx = (
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<Element>,
  target: number,
): cheerio.Cheerio<Element> | null => {
  let col = 0;
  for (const td of row.find("> td, > th").toArray()) {
    const colspan = parseInt($(td).attr("colspan") ?? "1", 10) || 1;
    if (target >= col && target < col + colspan) return $(td);
    col += colspan;
  }
  return null;
};

type ScrapeResult = {
  polls: Poll[];
  details: PollDetail[];
  agencies: Agency[];
  unknownAgencies: Set<string>;
};

const scrapeCycle = async (cycle: Cycle): Promise<ScrapeResult> => {
  console.log(`→ ${cycle.url}`);
  const res = await fetch(cycle.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetch ${cycle.url}: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const tables = $("table.wikitable").toArray();
  let parsed: ScrapedTable | null = null;
  for (const t of tables) {
    const candidate = parseTable($, t);
    if (candidate && candidate.partyColumns.length >= 4) {
      parsed = candidate;
      break;
    }
  }
  if (!parsed) {
    console.warn(`  ! no polling table found`);
    return { polls: [], details: [], agencies: [], unknownAgencies: new Set() };
  }

  const polls: Poll[] = [];
  const details: PollDetail[] = [];
  const seenAgencies = new Map<string, Agency>();
  const unknownAgencies = new Set<string>();

  for (const row of parsed.rows) {
    // Skip filler rows (campaign close marker etc.) — they have a single colspan cell.
    const cells = row.find("> td, > th").toArray();
    if (cells.length < 4) continue;
    const firstColspan = parseInt($(cells[0]).attr("colspan") ?? "1", 10) || 1;
    if (firstColspan > 1) continue;

    const agencyCell = cellByColIdx($, row, parsed.agencyHeader);
    const periodCell = cellByColIdx($, row, parsed.periodHeader);
    if (!agencyCell || !periodCell) continue;

    const agencyText = collapseSpaces(
      agencyCell.clone().find("sup, .reference").remove().end().text(),
    );
    const periodText = collapseSpaces(periodCell.text());

    // Skip CEC actual-result rows and election-marker rows.
    if (/централна избирателна комисия|cec/i.test(agencyText)) continue;
    if (/^избори\s/i.test(agencyText)) continue;
    if (!agencyText) continue;

    const matched = matchAgency(agencyText);
    if (!matched) {
      unknownAgencies.add(agencyText);
      continue;
    }
    const fw = parseFieldwork(periodText);
    if (!fw) {
      console.warn(
        `  ! could not parse period "${periodText}" for ${agencyText}`,
      );
      continue;
    }

    const sampleCell =
      parsed.sampleHeader >= 0
        ? cellByColIdx($, row, parsed.sampleHeader)
        : null;
    const sample = sampleCell ? parseSample(sampleCell.text()) : null;

    const pollId = `${matched.id.toLowerCase()}-${fw.endIso}`;
    if (polls.some((p) => p.id === pollId)) continue; // de-dupe within cycle

    const poll: Poll = {
      id: pollId,
      agencyId: matched.id,
      fieldwork: fw.fieldwork,
      electionDate: cycle.electionDate,
      respondents: sample,
      methodology: { en: "N/A", bg: "N/A" },
      source: cycle.url,
    };

    const partyDetails: PollDetail[] = [];
    for (const pc of parsed.partyColumns) {
      const td = cellByColIdx($, row, pc.index);
      if (!td) continue;
      const pct = parsePct(td);
      if (pct === null) continue;
      partyDetails.push({
        pollId,
        agencyId: matched.id,
        support: pct,
        nickName_bg: pc.nickBg,
        nickName_en: enFor(pc.nickBg),
      });
    }
    if (partyDetails.length === 0) continue;

    polls.push(poll);
    details.push(...partyDetails);
    seenAgencies.set(matched.id, matched.agency);
  }

  console.log(
    `  ✓ ${polls.length} polls, ${details.length} party rows, agencies: ${[...seenAgencies.keys()].join(", ")}`,
  );
  if (unknownAgencies.size)
    console.warn(
      `  ! unknown agencies skipped: ${[...unknownAgencies].join(" | ")}`,
    );

  return {
    polls,
    details,
    agencies: [...seenAgencies.values()],
    unknownAgencies,
  };
};

const readJson = <T>(file: string, fallback: T): T => {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
};

const seedFromIzboriai = (): {
  polls: Poll[];
  details: PollDetail[];
  agencies: Agency[];
} => {
  const polls = readJson<Poll[]>(path.join(IZBORIAI_DIR, "polls.json"), []);
  const details = readJson<PollDetail[]>(
    path.join(IZBORIAI_DIR, "polls_details.json"),
    [],
  );
  const agencies = readJson<Agency[]>(
    path.join(IZBORIAI_DIR, "agencies.json"),
    [],
  );
  return { polls, details, agencies };
};

const mergePolls = (existing: Poll[], incoming: Poll[]): Poll[] => {
  const byId = new Map<string, Poll>();
  for (const p of existing) byId.set(p.id, p);
  for (const p of incoming) {
    // Incoming wins only if existing has placeholder methodology — preserves richer existing data.
    const cur = byId.get(p.id);
    if (!cur) {
      byId.set(p.id, p);
    } else {
      byId.set(p.id, {
        ...cur,
        respondents: cur.respondents ?? p.respondents,
        electionDate: cur.electionDate ?? p.electionDate,
        source: cur.source && cur.source !== "N/A" ? cur.source : p.source,
      });
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
};

const mergeDetails = (
  existing: PollDetail[],
  incoming: PollDetail[],
): PollDetail[] => {
  // Replace details for any pollId that has incoming entries (treat scrape as authoritative
  // for that poll's per-party numbers); keep details for polls untouched by the scrape.
  const incomingPollIds = new Set(incoming.map((d) => d.pollId));
  const kept = existing.filter((d) => !incomingPollIds.has(d.pollId));
  return [...kept, ...incoming];
};

const mergeAgencies = (existing: Agency[], incoming: Agency[]): Agency[] => {
  const byId = new Map<string, Agency>();
  for (const a of existing) byId.set(a.id, a);
  for (const a of incoming) if (!byId.has(a.id)) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
};

const main = async (opts: { seedIzboriai: boolean; outDir: string }) => {
  fs.mkdirSync(opts.outDir, { recursive: true });

  let polls = readJson<Poll[]>(path.join(opts.outDir, "polls.json"), []);
  let details = readJson<PollDetail[]>(
    path.join(opts.outDir, "polls_details.json"),
    [],
  );
  let agencies = readJson<Agency[]>(
    path.join(opts.outDir, "agencies.json"),
    [],
  );

  if (polls.length === 0 && opts.seedIzboriai) {
    console.log(`→ seeding from izboriai (${IZBORIAI_DIR})`);
    const seed = seedFromIzboriai();
    polls = seed.polls;
    details = seed.details;
    agencies = seed.agencies;
    console.log(
      `  seeded ${polls.length} polls, ${details.length} details, ${agencies.length} agencies`,
    );
  }

  for (const cycle of CYCLES) {
    const r = await scrapeCycle(cycle);
    polls = mergePolls(polls, r.polls);
    details = mergeDetails(details, r.details);
    agencies = mergeAgencies(agencies, r.agencies);
  }

  fs.writeFileSync(
    path.join(opts.outDir, "polls.json"),
    JSON.stringify(polls, null, 2),
  );
  fs.writeFileSync(
    path.join(opts.outDir, "polls_details.json"),
    JSON.stringify(details, null, 2),
  );
  fs.writeFileSync(
    path.join(opts.outDir, "agencies.json"),
    JSON.stringify(agencies, null, 2),
  );
  console.log(
    `✓ wrote ${polls.length} polls / ${details.length} details / ${agencies.length} agencies → ${opts.outDir}`,
  );
};

const cli = command({
  name: "scrape_polls",
  args: {
    seedIzboriai: flag({
      type: optional(boolean),
      long: "seed-izboriai",
      defaultValue: () => false,
    }),
    outDir: option({
      type: string,
      long: "out",
      defaultValue: () => OUT_DIR,
    }),
  },
  handler: async (args) => {
    await main({ seedIzboriai: !!args.seedIzboriai, outDir: args.outDir });
  },
});

run(cli, process.argv.slice(2));
