/**
 * ГРАО — settlement-level registered population.
 *
 * Source: the quarterly "Таблица на адресно регистрираните по постоянен и по
 * настоящ адрес лица" published at https://www.grao.bg/tables.html — the
 * `t41nm-DD-MM-YYYY_N.txt` files. Plain text, Windows-1251, pipe-delimited,
 * organised as per-municipality blocks of settlement rows. It is the only
 * frequently-updated (≈quarterly) source of population at settlement grain
 * between the decennial censuses.
 *
 * The file carries no EKATTE codes — only Bulgarian settlement names with a
 * type prefix (ГР./С./...) inside `област … община …` blocks. We resolve each
 * to an EKATTE by matching the name within the oblast against data/
 * settlements.json (Sofia city's three election oblasts S23/S24/S25 are
 * searched together, since ГРАО keeps it as one община "Столична").
 *
 * Output: data/grao_population.json — per-EKATTE permanent + current-address
 * population. The permanent-vs-current gap is itself a civic signal: villages
 * with far more permanent than current registrations are the "phantom
 * resident" settlements.
 *
 * Usage: npx tsx scripts/grao/fetch.ts [--force]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_URL = "https://www.grao.bg/tables.html";
const BASE_URL = "https://www.grao.bg/";
const UA = "Mozilla/5.0 (compatible; electionsbg-grao/1.0)";

const RAW_DIR = path.resolve(__dirname, "../../raw_data/grao");
const OUT_FILE = path.resolve(__dirname, "../../data/grao_population.json");
const SLICE_DIR = path.resolve(__dirname, "../../data/grao");
const SETTLEMENTS_FILE = path.resolve(__dirname, "../../data/settlements.json");

// ГРАО oblast name (uppercase) → app oblast code(s). Sofia city is one ГРАО
// община "Столична" but three election oblasts in our data; the Plovdiv split
// (PDV/PDV-00) is likewise searched together.
const OBLAST_NAME_TO_CODES: Record<string, string[]> = {
  БЛАГОЕВГРАД: ["BLG"],
  БУРГАС: ["BGS"],
  ВАРНА: ["VAR"],
  "ВЕЛИКО ТЪРНОВО": ["VTR"],
  ВИДИН: ["VID"],
  ВРАЦА: ["VRC"],
  ГАБРОВО: ["GAB"],
  ДОБРИЧ: ["DOB"],
  КЪРДЖАЛИ: ["KRZ"],
  КЮСТЕНДИЛ: ["KNL"],
  ЛОВЕЧ: ["LOV"],
  МОНТАНА: ["MON"],
  ПАЗАРДЖИК: ["PAZ"],
  ПЕРНИК: ["PER"],
  ПЛЕВЕН: ["PVN"],
  ПЛОВДИВ: ["PDV", "PDV-00"],
  РАЗГРАД: ["RAZ"],
  РУСЕ: ["RSE"],
  СИЛИСТРА: ["SLS"],
  СЛИВЕН: ["SLV"],
  СМОЛЯН: ["SML"],
  СОФИЯ: ["S23", "S24", "S25"],
  СОФИЙСКА: ["SFO"],
  "СТАРА ЗАГОРА": ["SZR"],
  ТЪРГОВИЩЕ: ["TGV"],
  ХАСКОВО: ["HKV"],
  ШУМЕН: ["SHU"],
  ЯМБОЛ: ["JAM"],
};

type Settlement = {
  ekatte: string;
  name: string;
  oblast: string;
  obshtina: string;
};

const fold = (s: string) =>
  s.toLocaleUpperCase("bg-BG").replace(/\s+/g, " ").trim();

// Pick the most recent t41nm settlement file from the ГРАО index.
const findLatestFile = async (): Promise<{ url: string; asOf: string }> => {
  const res = await fetch(INDEX_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${INDEX_URL}`);
  const html = await res.text();
  const matches = [
    ...html.matchAll(/tna\/t41nm-(\d{2})-(\d{2})-(\d{4})_(\d+)\.txt/g),
  ];
  if (matches.length === 0)
    throw new Error("no t41nm settlement files found on the ГРАО index page");
  let best: { url: string; asOf: string; key: number } | undefined;
  for (const m of matches) {
    const [full, dd, mm, yyyy] = m;
    const key = Number(yyyy) * 10000 + Number(mm) * 100 + Number(dd);
    if (!best || key > best.key) {
      best = { url: BASE_URL + full, asOf: `${yyyy}-${mm}-${dd}`, key };
    }
  }
  return { url: best!.url, asOf: best!.asOf };
};

const downloadFile = async (url: string, force: boolean): Promise<string> => {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const dest = path.join(RAW_DIR, path.basename(url));
  if (force || !fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  // ГРАО publishes the file in Windows-1251.
  return new TextDecoder("windows-1251").decode(fs.readFileSync(dest));
};

type ParsedRow = {
  oblastName: string;
  settlementName: string;
  permanent: number;
  current: number;
};

// Parse the per-municipality blocks. A block opens with an
// `област … община …` line; settlement rows are `|name|n1|n2|n3|`.
const parse = (text: string): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  let oblastName: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\s*област\s+(.+?)\s+община\s+.+?\s*$/);
    if (head) {
      oblastName = head[1].trim();
      continue;
    }
    const cell = line.match(
      /^\|([^|]+)\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|\s*(-?\d+)\s*\|/,
    );
    if (!cell || !oblastName) continue;
    const rawName = cell[1].trim();
    if (!rawName || rawName.startsWith("Всичко")) continue;
    // Strip the settlement-type prefix (ГР./С./МАН./...).
    const dot = rawName.indexOf(".");
    const settlementName = (dot >= 0 ? rawName.slice(dot + 1) : rawName).trim();
    if (!settlementName) continue;
    rows.push({
      oblastName,
      settlementName,
      permanent: Number(cell[2]),
      current: Number(cell[3]),
    });
  }
  return rows;
};

const main = async () => {
  const force = process.argv.includes("--force");

  const { url, asOf } = await findLatestFile();
  console.log(`ГРАО latest settlement table: ${path.basename(url)} (${asOf})`);
  const text = await downloadFile(url, force);
  const parsed = parse(text);
  console.log(`Parsed ${parsed.length} settlement rows.`);

  // Build oblastCode → foldedName → ekatte[] from settlements.json.
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(SETTLEMENTS_FILE, "utf8"),
  );
  const byOblast = new Map<string, Map<string, Settlement[]>>();
  for (const s of settlements) {
    let m = byOblast.get(s.oblast);
    if (!m) {
      m = new Map();
      byOblast.set(s.oblast, m);
    }
    const key = fold(s.name);
    const list = m.get(key) ?? [];
    list.push(s);
    m.set(key, list);
  }

  type Pop = { permanent: number; current: number };
  const population: Record<string, Pop> = {};
  // Grouped by obshtina — each becomes a per-municipality slice file so a
  // settlement page fetches ~1 KB instead of the whole bundle.
  const byMuni = new Map<string, Record<string, Pop>>();
  let matched = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  for (const row of parsed) {
    const codes = OBLAST_NAME_TO_CODES[fold(row.oblastName)];
    if (!codes) {
      unmatched.push(`${row.oblastName} / ${row.settlementName} (oblast?)`);
      continue;
    }
    const key = fold(row.settlementName);
    const hits: Settlement[] = [];
    for (const code of codes) {
      const found = byOblast.get(code)?.get(key);
      if (found) hits.push(...found);
    }
    const uniqueHits = [...new Map(hits.map((h) => [h.ekatte, h])).values()];
    if (uniqueHits.length === 0) {
      unmatched.push(`${row.oblastName} / ${row.settlementName}`);
      continue;
    }
    if (uniqueHits.length > 1) {
      // Same name twice in one oblast — keep the first; log it for review.
      ambiguous.push(
        `${row.oblastName} / ${row.settlementName} → ${uniqueHits
          .map((h) => h.ekatte)
          .join(",")}`,
      );
    }
    const { ekatte, obshtina } = uniqueHits[0];
    const value: Pop = { permanent: row.permanent, current: row.current };
    population[ekatte] = value;
    let muni = byMuni.get(obshtina);
    if (!muni) {
      muni = {};
      byMuni.set(obshtina, muni);
    }
    muni[ekatte] = value;
    matched++;
  }

  console.log(
    `Joined ${matched} / ${parsed.length} rows to EKATTE (${unmatched.length} unmatched, ${ambiguous.length} ambiguous).`,
  );
  if (unmatched.length > 0) {
    for (const u of unmatched.slice(0, 10)) console.log(`  ! ${u}`);
    if (unmatched.length > 10)
      console.log(`  ... ${unmatched.length - 10} more`);
  }

  // Full bundle — committed for verification / whole-dataset use.
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({
      source: {
        name: "ГРАО — регистрирано население по постоянен и настоящ адрес",
        url: INDEX_URL,
      },
      asOf,
      fetchedAt: new Date().toISOString(),
      settlements: population,
    }),
  );

  // Per-municipality slices — what settlement pages actually fetch.
  if (fs.existsSync(SLICE_DIR)) {
    for (const f of fs.readdirSync(SLICE_DIR)) {
      fs.rmSync(path.join(SLICE_DIR, f));
    }
  } else {
    fs.mkdirSync(SLICE_DIR, { recursive: true });
  }
  for (const [obshtina, settlementsOfMuni] of byMuni) {
    fs.writeFileSync(
      path.join(SLICE_DIR, `${obshtina}.json`),
      JSON.stringify({ asOf, settlements: settlementsOfMuni }),
    );
  }
  console.log(
    `Wrote ${OUT_FILE} + ${byMuni.size} per-municipality slices to ${SLICE_DIR}/ (${Object.keys(population).length} settlements as of ${asOf}).`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
