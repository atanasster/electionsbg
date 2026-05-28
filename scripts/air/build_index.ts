// Build air-quality station index from ИАОС data.egov.bg datasets.
//
// Reads quarterly per-pollutant CSVs published as data.egov.bg resources:
//   PM10  (resource 452acfd4-9fa1-4ab8-9213-f1b2736ce143)
//   PM2.5 (resource 0eefa354-495f-4a2d-a40f-846e11dd396a)
// Each CSV has one row per station with column structure:
//   "Име на български език", "Брой СД", ["Брой превишения" only on PM10],
//   "Макс. СД", "Средна за периода".
//
// The CSVs DO NOT carry station coordinates. Stations are identified
// by name only. The naming convention is consistent though — most BG
// stations are named "<município> - <subname>" (e.g. "София - Хиподрума",
// "Пловдив - Каменица"). We parse the município name out of the first
// token, look it up in municipalities.json, and key the output by
// obshtina-code.
//
// Background / mountain stations ("Копитото", "Витиня", "Рожен - КФС",
// "Гара Яна", etc.) don't tie to a município — those go into a
// `backgroundStations` list rather than the per-município map.
//
// Run: `npx tsx scripts/air/build_index.ts`
// Writes: data/air/index.json

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);

const OUT_FILE = path.join(PROJECT_ROOT, "data/air/index.json");
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");
const CACHE_DIR = path.join(PROJECT_ROOT, "raw_data/air/iaos");

// Per-pollutant data.egov.bg resource UUIDs. The dataset listing
// page rotates these per quarter; the script reads the latest snapshot
// the bundle URL serves at run-time.
const POLLUTANTS = {
  pm10: "452acfd4-9fa1-4ab8-9213-f1b2736ce143",
  pm25: "0eefa354-495f-4a2d-a40f-846e11dd396a",
} as const;

type Pollutant = keyof typeof POLLUTANTS;

type MunicipalityInfo = {
  obshtina: string;
  name: string;
  oblast: string;
};

const UA = "Mozilla/5.0 (compatible; electionsbg-air/1.0)";

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

const fetchCached = async (pollutant: Pollutant): Promise<string | null> => {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${pollutant}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 100) {
    return fs.readFileSync(file, "utf-8");
  }
  const url = `https://data.egov.bg/resource/download/${POLLUTANTS[pollutant]}/csv`;
  const text = await fetchText(url);
  if (text && text.length > 100 && !text.startsWith("<!DOCTYPE")) {
    fs.writeFileSync(file, text);
    return text;
  }
  return null;
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      cells.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  cells.push(buf);
  return cells;
};

// Parse "<município name> - <subname>" or just "<município name>".
// Returns the candidate município name extracted from the station label.
// Some special cases: "В.Търново" → "Велико Търново", "Г.Оряховица" →
// "Горна Оряховица". A small alias map covers the abbreviations.
const STATION_PREFIX_ALIASES: Record<string, string> = {
  "в.търново": "велико търново",
  "вел.търново": "велико търново",
  "г.оряховица": "горна оряховица",
  "д.оряховица": "долна оряховица",
  "ст.загора": "стара загора",
  "стара загора": "стара загора",
  "видин 2": "видин",
};

const extractMuniName = (stationName: string): string | null => {
  // Stations like "Витиня", "Рожен - КФС", "Копитото", "Гара Яна" are
  // mountain or transit background stations — they aren't named after
  // their município. Drop these.
  const BACKGROUND = new Set(["Витиня", "Копитото", "Гара Яна", "Рожен - КФС"]);
  if (BACKGROUND.has(stationName)) return null;
  const dashIdx = stationName.indexOf(" - ");
  const head = dashIdx > 0 ? stationName.slice(0, dashIdx) : stationName;
  const norm = head.normalize("NFC").trim().toLowerCase();
  if (STATION_PREFIX_ALIASES[norm]) return STATION_PREFIX_ALIASES[norm];
  // Strip a trailing " 2" / " 3" (numbered duplicate stations) — "Видин 2"
  // is still in Видин.
  const stripped = head.replace(/\s+\d+$/u, "").trim();
  return stripped;
};

type ParsedRow = {
  stationName: string;
  count: number;
  meanValue: number | null;
  maxValue: number | null;
};

const parsePollutantCsv = (text: string): ParsedRow[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) return [];
  const out: ParsedRow[] = [];
  // Row 0 is the title, row 1 is the header. Data starts at row 2.
  for (let i = 2; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 3) continue;
    const stationName = cells[0]?.trim();
    if (!stationName) continue;
    // Count is column 1. Max and mean are the LAST two columns (the PM10
    // CSV has an extra "Брой превишения" column in position 2; the PM2.5
    // CSV doesn't — picking from the end keeps both formats happy).
    const count = Number(cells[1]?.trim());
    const meanRaw = cells[cells.length - 1]?.trim().replace(",", ".");
    const maxRaw = cells[cells.length - 2]?.trim().replace(",", ".");
    const meanValue = Number(meanRaw);
    const maxValue = Number(maxRaw);
    out.push({
      stationName,
      count: Number.isFinite(count) ? count : 0,
      meanValue: Number.isFinite(meanValue) ? meanValue : null,
      maxValue: Number.isFinite(maxValue) ? maxValue : null,
    });
  }
  return out;
};

type StationOut = {
  id: string;
  name: string;
  obshtina: string;
  latestReadings: Partial<Record<Pollutant, number>>;
  // Max-observed in the quarter — useful for "did this station ever
  // exceed the EU threshold this quarter".
  maxObserved: Partial<Record<Pollutant, number>>;
};

const main = async () => {
  const munis = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_FILE, "utf-8"),
  ) as MunicipalityInfo[];
  const byName = new Map<string, MunicipalityInfo[]>();
  for (const m of munis) {
    const key = m.name.normalize("NFC").toLowerCase();
    const arr = byName.get(key) ?? [];
    arr.push(m);
    byName.set(key, arr);
  }

  // Sofia city special-case: every "София ..." station maps to SOF00,
  // the synthetic Sofia-city aggregate the hook fans out to районы.
  const SOFIA_OBSHTINA = "SOF00";

  // Stations keyed by name. Same physical station can appear in both
  // PM10 and PM2.5 CSVs — we merge their readings.
  const stations = new Map<string, StationOut>();
  const background: ParsedRow[] = [];
  let snapshotAsOf: string | null = null;

  for (const pollutant of Object.keys(POLLUTANTS) as Pollutant[]) {
    const text = await fetchCached(pollutant);
    if (!text) {
      console.warn(`skip ${pollutant}: no CSV available`);
      continue;
    }
    // Extract reporting period from the title row.
    const periodMatch = text.match(
      /от\s+(\d{2}\.\d{2}\.\d{4})\s+до\s+(\d{2}\.\d{2}\.\d{4})/,
    );
    if (periodMatch && !snapshotAsOf) {
      // Convert DD.MM.YYYY → ISO YYYY-MM-DD (use the period-end date).
      const [d, m, y] = periodMatch[2].split(".");
      snapshotAsOf = `${y}-${m}-${d}`;
    }
    const rows = parsePollutantCsv(text);
    console.log(`${pollutant}: ${rows.length} stations`);

    for (const row of rows) {
      const muniName = extractMuniName(row.stationName);
      if (!muniName) {
        background.push(row);
        continue;
      }
      let code: string | undefined;
      if (/софи/i.test(muniName)) {
        code = SOFIA_OBSHTINA;
      } else {
        const candidates = byName.get(muniName.toLowerCase()) ?? [];
        if (candidates.length === 1) {
          code = candidates[0].obshtina;
        } else if (candidates.length > 1) {
          // Tie-break: take the largest município by code conventions
          // (BLG01 > BLG52 = pick the city), but in practice these AQ
          // stations are always in the município that shares the name's
          // city. Fall back to first match.
          code = candidates[0].obshtina;
        }
      }
      if (!code) {
        background.push(row);
        continue;
      }

      const key = row.stationName;
      let station = stations.get(key);
      if (!station) {
        station = {
          id: key,
          name: row.stationName,
          obshtina: code,
          latestReadings: {},
          maxObserved: {},
        };
        stations.set(key, station);
      }
      if (row.meanValue != null)
        station.latestReadings[pollutant] = row.meanValue;
      if (row.maxValue != null) station.maxObserved[pollutant] = row.maxValue;
    }
  }

  const out = {
    source: "ИАОС (Изпълнителна агенция по околна среда) via data.egov.bg",
    indexName: "Air quality monitoring stations — quarterly averages",
    pollutants: {
      pm10: { bg: "ФПЧ10", en: "PM10", unit: "µg/m³", euLimit: 50 },
      pm25: { bg: "ФПЧ2.5", en: "PM2.5", unit: "µg/m³", euLimit: 25 },
      no2: { bg: "Азотен диоксид", en: "NO₂", unit: "µg/m³", euLimit: 40 },
      o3: { bg: "Озон", en: "O₃", unit: "µg/m³", euLimit: 120 },
      so2: { bg: "Серен диоксид", en: "SO₂", unit: "µg/m³", euLimit: 125 },
    },
    stations: Array.from(stations.values()),
    backgroundStations: background.map((b) => ({
      name: b.stationName,
      pm10: b.stationName.includes("10")
        ? undefined
        : b.meanValue && b.meanValue > 0
          ? b.meanValue
          : undefined,
    })),
    snapshotAsOf,
    note: "Source CSVs do not carry station coordinates; município attribution is via station name parsing. PM10 + PM2.5 only in this first cut. NO2 and CO datasets exist on data.egov.bg but require navigation through the dataset page for the per-resource UUID.",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${stations.size} município stations, ${background.length} background stations, asOf ${snapshotAsOf}`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
