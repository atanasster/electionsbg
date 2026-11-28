// Parsers + fetchers for the vaccine sources other than the НЗИС info-app
// (his_infoapp.ts).
//
// Every parser THROWS on a shape change rather than returning a partial or
// empty result: three of these sources keep no history (the report page shows
// only today's counter, СЕСПА only this week's list, НЦЗПБ only two weeks), so
// a silently-empty capture is a day of data lost for good.

import { decodeEntities, stripTags } from "../../lib/html";
import { fetchText } from "../../watch/fingerprint";

// ---------------------------------------------------------------- НЗИС report

export const hisReportUrl = (year: number): string =>
  `https://his.bg/bg/statistical-reports/immunizations/${year}`;

export interface HisReportVaccine {
  /** The page's own bilingual label, "Ваксина срещу сезонен грип / Seasonal influenza vaccine". */
  label: string;
  labelBg: string;
  /** Matches the info-app's English label. */
  labelEn: string;
  n: number;
}

export interface HisReportDistrict {
  /** ISO 3166-2 code, BG-01 … BG-28. */
  iso: string;
  n: number;
}

export interface HisReport {
  year: number;
  /** The page's „актуализирани" stamp(s), as ISO local time (Europe/Sofia). */
  updatedAt: string[];
  total: number;
  byVaccine: HisReportVaccine[];
  byDistrict: HisReportDistrict[];
}

/** Minimal RFC-4180 line splitter (quoted fields may contain commas). */
export const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

const embeddedCsv = (html: string, filenamePrefix: string): string[][] => {
  const re = new RegExp(
    `<xmp[^>]*data-filename="${filenamePrefix}\\d{4}\\.csv"[^>]*>([\\s\\S]*?)</xmp>`,
  );
  const m = html.match(re);
  if (!m) throw new Error(`НЗИС report: no embedded ${filenamePrefix}*.csv`);
  const lines = m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map(splitCsvLine);
};

const toCount = (v: string, what: string): number => {
  const t = v.replace(/[\s\u00a0]/g, "");
  if (!/^\d+$/.test(t))
    throw new Error(`unreadable ${what} ${JSON.stringify(v)}`);
  return Number(t);
};

/** `closedYear`: a past year's page carries no „актуализирани" stamp (measured
 *  2026-11-23 on /2025) — its counters are final, so `updatedAt` is empty. A
 *  current-year page without one means the page shape changed. */
export const parseHisReport = (
  html: string,
  year: number,
  closedYear = false,
): HisReport => {
  const updatedAt = [
    ...html.matchAll(
      /актуализирани в (\d{1,2}):(\d{2}) на (\d{2})\.(\d{2})\.(\d{4})/g,
    ),
  ].map((m) => `${m[5]}-${m[4]}-${m[3]}T${m[1].padStart(2, "0")}:${m[2]}:00`);
  if (!updatedAt.length && !closedYear)
    throw new Error(
      "НЗИС report: no „актуализирани“ stamp — page shape changed",
    );

  const vaccineCsv = embeddedCsv(html, "NumberOfImmunizationsByVaccine");
  if (vaccineCsv[0].join(",") !== "vaccine,number_of_immunizations")
    throw new Error(
      `НЗИС report: unexpected vaccine CSV header ${vaccineCsv[0]}`,
    );
  const byVaccine = vaccineCsv.slice(1).map(([label, n]) => {
    const i = label.indexOf(" / ");
    if (i < 0) throw new Error(`НЗИС report: label without " / " ${label}`);
    return {
      label,
      labelBg: label.slice(0, i).trim(),
      labelEn: label.slice(i + 3).trim(),
      n: toCount(n, "vaccine count"),
    };
  });

  const districtCsv = embeddedCsv(html, "TotalNumberOfImmunizationByDistrict");
  if (
    districtCsv[0][0] !== "district" ||
    districtCsv[0][1] !== "number_of_immunizations"
  )
    throw new Error(
      `НЗИС report: unexpected district CSV header ${districtCsv[0]}`,
    );
  const byDistrict = districtCsv.slice(1).map(([iso, n]) => {
    if (!/^BG-\d{2}$/.test(iso))
      throw new Error(`НЗИС report: unexpected district code ${iso}`);
    return { iso, n: toCount(n, "district count") };
  });

  if (!byVaccine.length || byDistrict.length !== 28)
    throw new Error(
      `НЗИС report: ${byVaccine.length} vaccines / ${byDistrict.length} districts (expected 28)`,
    );
  const total = byVaccine.reduce((a, r) => a + r.n, 0);
  return { year, updatedAt, total, byVaccine, byDistrict };
};

export const fetchHisReport = async (
  year: number,
  closedYear = false,
): Promise<HisReport> => {
  const html = await fetchText(hisReportUrl(year), { retries: 2 });
  if (!html) throw new Error(`НЗИС report ${year} unreachable`);
  return parseHisReport(html, year, closedYear);
};

// ---------------------------------------------------------------- ИАЛ СЕСПА

export const SESPA_URL = "https://sespa.mh.government.bg/sespa/f?p=100:1:0";

export interface ShortageRow {
  /** НСЦРЛП code. */
  ncprCode: string;
  name: string;
  inn: string;
  strength: string;
  unit: string;
  form: string;
  pack: string;
  isVaccine: boolean;
}

export interface ShortageList {
  /** 'YYYY-MM-DD' */
  validFrom: string;
  validTo: string;
  rows: ShortageRow[];
}

/** A vaccine is recognised by its INN/name ("Influenza vaccine (live
 *  attenuated, nasal)"); СЕСПА publishes no ATC code. */
export const isVaccineProduct = (name: string, inn: string): boolean =>
  /vaccin|ваксин/i.test(`${name} ${inn}`);

const cellText = (s: string) => decodeEntities(stripTags(s)).trim();

export const parseSespa = (html: string): ShortageList => {
  const v = html.match(
    /В сила от\s*(\d{2})\.(\d{2})\.(\d{4})[\s\S]{0,40}?до\s*(\d{2})\.(\d{2})\.(\d{4})/,
  );
  if (!v) throw new Error("СЕСПА: no validity window — page shape changed");
  const total = html.match(/Total Rows = (\d+)/);
  if (!total) throw new Error("СЕСПА: no report table");
  const rows: ShortageRow[] = [];
  for (const tr of html.matchAll(/<tr\s*>([\s\S]*?)<\/tr>/g)) {
    const cells: Record<string, string> = {};
    for (const td of tr[1].matchAll(
      /<td[^>]*headers="([A-Z_]+)"[^>]*>([\s\S]*?)<\/td>/g,
    ))
      cells[td[1]] = cellText(td[2]);
    if (!("NSCRLP_CODE" in cells)) continue;
    const name = cells.DRUG_TRADE_NAME ?? "";
    const inn = cells.INN ?? "";
    if (!cells.NSCRLP_CODE || !name)
      throw new Error(
        `СЕСПА: row without code or name ${JSON.stringify(cells)}`,
      );
    rows.push({
      ncprCode: cells.NSCRLP_CODE,
      name,
      inn,
      strength: cells.ACTIVE_SUBSTANCE ?? "",
      unit: cells.ACTIVE_SUBSTANCE_MEASUREMENT ?? "",
      form: cells.FORMA ?? "",
      pack: cells.NUMBER_IN_PACKAGE ?? "",
      isVaccine: isVaccineProduct(name, inn),
    });
  }
  // The interactive report pages; a partial page would read as products
  // leaving the list.
  if (rows.length !== Number(total[1]))
    throw new Error(
      `СЕСПА: parsed ${rows.length} rows, the report says ${total[1]} — paginated or changed`,
    );
  if (!rows.length) throw new Error("СЕСПА: empty shortage list");
  return {
    validFrom: `${v[3]}-${v[2]}-${v[1]}`,
    validTo: `${v[6]}-${v[5]}-${v[4]}`,
    rows,
  };
};

/** APEX needs its session cookie: the first GET sets it and redirects. */
export const fetchSespa = async (): Promise<ShortageList> => {
  const { spawnSync } = await import("child_process");
  const { mkdtempSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const dir = mkdtempSync(join(tmpdir(), "sespa-"));
  try {
    const jar = join(dir, "jar");
    const res = spawnSync(
      "curl",
      ["-sSL", "--max-time", "60", "-c", jar, "-b", jar, SESPA_URL],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (res.status !== 0 || !res.stdout)
      throw new Error(`СЕСПА unreachable: ${res.stderr?.trim() || res.status}`);
    return parseSespa(res.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------- НЦЗПБ

export const NCIPD_TABLE_URL = (offset: number): string =>
  `https://grippe.gateway.bg/table.php?offset=${offset}`;
export const NCIPD_LAB_URL = "https://grippe.gateway.bg/lab.php";

export const NCIPD_AGE_BANDS = [
  "0-4",
  "5-14",
  "15-29",
  "30-64",
  "65+",
] as const;

export interface IncidenceRow {
  /** НЦЗПБ's Bulgarian oblast name, or "Общо за страната". */
  area: string;
  isNational: boolean;
  /** One per NCIPD_AGE_BANDS, then the all-ages total. */
  served: number[];
  cases: number[];
  /** Per 10,000 served, as published. */
  rate: number[];
}

export interface IncidenceWeek {
  isoWeek: number;
  /** 'YYYY-MM-DD' */
  weekStart: string;
  weekEnd: string;
  rows: IncidenceRow[];
}

const num = (s: string, what: string): number => {
  const t = s.replace(/[\s\u00a0]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t))
    throw new Error(`НЦЗПБ: unreadable ${what} ${s}`);
  return Number(t);
};

export const parseIncidence = (html: string): IncidenceWeek => {
  const h = html.match(
    /за периода от (\d{2})-(\d{2})-(\d{4}) до (\d{2})-(\d{2})-(\d{4}) \(седмица (\d+)\)/,
  );
  if (!h) throw new Error("НЦЗПБ: no week heading — page shape changed");
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbody) throw new Error("НЦЗПБ: no table body");
  const rows: IncidenceRow[] = [];
  for (const tr of tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      cellText(m[1]),
    );
    if (!cells.length) continue;
    if (cells.length !== 20)
      throw new Error(
        `НЦЗПБ: row with ${cells.length} cells (expected 20): ${cells[0]}`,
      );
    const area = cells[0];
    rows.push({
      area,
      isNational: /общо за страната/i.test(area),
      served: cells.slice(2, 8).map((c) => num(c, "served")),
      cases: cells.slice(8, 14).map((c) => num(c, "cases")),
      rate: cells.slice(14, 20).map((c) => num(c, "rate")),
    });
  }
  const oblasts = rows.filter((r) => !r.isNational).length;
  if (oblasts !== 28 || rows.length !== 29)
    throw new Error(
      `НЦЗПБ: ${oblasts} oblasts / ${rows.length} rows (expected 28 + national)`,
    );
  return {
    isoWeek: Number(h[7]),
    weekStart: `${h[3]}-${h[2]}-${h[1]}`,
    weekEnd: `${h[6]}-${h[5]}-${h[4]}`,
    rows,
  };
};

export interface VirologyWeek {
  isoWeek: number;
  weekStart: string;
  weekEnd: string;
  tested: number;
  aH1n1: number;
  aH3n2: number;
  aH1n1pdm09: number;
  bVictoria: number;
  bYamagata: number;
}

/** Table 1 of lab.php: all ages, Real-Time RT-PCR, the current week. */
export const parseVirology = (html: string): VirologyWeek => {
  const h = html.match(
    /Седмица\s*(?:№|&#8470;?)\s*(\d+)\s*\(от (\d{2})\.(\d{2})\.(\d{4}) до (\d{2})\.(\d{2})\.(\d{4})\)/,
  );
  if (!h) throw new Error("НЦЗПБ lab: no week heading — page shape changed");
  const t1 = html.search(/Таблица(?:&nbsp;|\s)1:/);
  const body =
    t1 < 0 ? null : html.slice(t1).match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!body) throw new Error("НЦЗПБ lab: no table 1");
  const lastRow = [...body[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].pop();
  const cells = lastRow
    ? [...lastRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
        cellText(m[1]),
      )
    : [];
  const vals = cells
    .filter((c) => /^[\d\s]+$/.test(c))
    .map((c) => num(c, "virology"));
  if (vals.length !== 6)
    throw new Error(
      `НЦЗПБ lab: table 1 has ${vals.length} numeric cells (expected 6)`,
    );
  return {
    isoWeek: Number(h[1]),
    weekStart: `${h[4]}-${h[3]}-${h[2]}`,
    weekEnd: `${h[7]}-${h[6]}-${h[5]}`,
    tested: vals[0],
    aH1n1: vals[1],
    aH3n2: vals[2],
    aH1n1pdm09: vals[3],
    bVictoria: vals[4],
    bYamagata: vals[5],
  };
};

export const fetchIncidence = async (offset = 1): Promise<IncidenceWeek> => {
  const html = await fetchText(NCIPD_TABLE_URL(offset), { retries: 2 });
  if (!html) throw new Error("НЦЗПБ table unreachable");
  return parseIncidence(html);
};

export const fetchVirology = async (): Promise<VirologyWeek> => {
  const html = await fetchText(NCIPD_LAB_URL, { retries: 2 });
  if (!html) throw new Error("НЦЗПБ lab unreachable");
  return parseVirology(html);
};

// ---------------------------------------------------------------- Eurostat

/** CN 3002 41 10 (COVID-19) and 3002 41 90 (all other human vaccines).
 *  The codes are new in 2022, so the series starts 2022-01. */
export const VACCINE_CN_CODES = ["30024110", "30024190"] as const;
export const COMEXT_URL =
  "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409";
export const FLU_COVERAGE_URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/hlth_ps_immu?format=JSON&lang=en";

interface JsonStat {
  updated?: string;
  id: string[];
  size: number[];
  dimension: Record<string, { category: { index: Record<string, number> } }>;
  value: Record<string, number> | number[];
}

/** Flatten a JSON-stat v2 dataset into one record per non-missing cell. */
export const flattenJsonStat = (
  d: JsonStat,
): Array<{ dims: Record<string, string>; value: number }> => {
  const keys = d.id.map((dim) => {
    const idx = d.dimension[dim].category.index;
    const arr: string[] = [];
    for (const [k, i] of Object.entries(idx)) arr[i] = k;
    return arr;
  });
  const out: Array<{ dims: Record<string, string>; value: number }> = [];
  const entries = Array.isArray(d.value)
    ? d.value.map((v, i) => [String(i), v] as const)
    : Object.entries(d.value);
  for (const [flat, value] of entries) {
    if (value === null || value === undefined) continue;
    let rem = Number(flat);
    const rec: Record<string, string> = {};
    for (let k = d.id.length - 1; k >= 0; k--) {
      const size = d.size[k];
      rec[d.id[k]] = keys[k][rem % size];
      rem = Math.floor(rem / size);
    }
    out.push({ dims: rec, value: Number(value) });
  }
  return out;
};

export interface TradeRow {
  /** 'YYYY-MM' */
  period: string;
  flow: "import" | "export";
  product: string;
  partner: string;
  valueEur: number | null;
  quantity100kg: number | null;
}

export interface TradeSet {
  updated: string;
  rows: TradeRow[];
}

const fetchJsonStat = async (url: string): Promise<JsonStat> => {
  const text = await fetchText(url, { retries: 2 });
  if (!text) throw new Error(`Eurostat unreachable: ${url}`);
  const d = JSON.parse(text) as JsonStat & { error?: unknown };
  if (d.error || !d.dimension)
    throw new Error(
      `Eurostat error for ${url}: ${JSON.stringify(d.error).slice(0, 200)}`,
    );
  return d;
};

/** Comext answers 413 ("asynchronous") to a whole-history request, so the
 *  series is fetched one year × flow × indicator at a time. */
export const fetchVaccineTrade = async (
  fromYear = 2022,
  toYear = new Date().getUTCFullYear(),
): Promise<TradeSet> => {
  const cells = new Map<string, TradeRow>();
  let updated = "";
  for (let year = fromYear; year <= toYear; year++)
    for (const [flowCode, flow] of [
      ["1", "import"],
      ["2", "export"],
    ] as const)
      for (const indicator of ["VALUE_IN_EUROS", "QUANTITY_IN_100KG"]) {
        const q = new URLSearchParams({
          format: "JSON",
          lang: "en",
          reporter: "BG",
          freq: "M",
          flow: flowCode,
          indicators: indicator,
          sinceTimePeriod: `${year}-01`,
          untilTimePeriod: `${year}-12`,
        });
        for (const p of VACCINE_CN_CODES) q.append("product", p);
        const d = await fetchJsonStat(`${COMEXT_URL}?${q}`);
        if (d.updated && d.updated > updated) updated = d.updated;
        for (const c of flattenJsonStat(d)) {
          const period = c.dims.time;
          const key = `${period}|${flow}|${c.dims.product}|${c.dims.partner}`;
          const row = cells.get(key) ?? {
            period,
            flow,
            product: c.dims.product,
            partner: c.dims.partner,
            valueEur: null,
            quantity100kg: null,
          };
          if (indicator === "VALUE_IN_EUROS") row.valueEur = c.value;
          else row.quantity100kg = c.value;
          cells.set(key, row);
        }
      }
  const rows = [...cells.values()].sort((a, b) =>
    `${a.period}${a.flow}${a.product}${a.partner}`.localeCompare(
      `${b.period}${b.flow}${b.product}${b.partner}`,
    ),
  );
  if (!rows.length) throw new Error("Comext: no vaccine trade rows");
  return { updated, rows };
};

export interface CoverageRow {
  geo: string;
  year: number;
  pct: number;
}

export const fetchFluCoverage = async (): Promise<{
  updated: string;
  rows: CoverageRow[];
}> => {
  const d = await fetchJsonStat(FLU_COVERAGE_URL);
  const rows = flattenJsonStat(d).map((c) => ({
    geo: c.dims.geo,
    year: Number(c.dims.time),
    pct: c.value,
  }));
  if (!rows.some((r) => r.geo === "BG"))
    throw new Error("hlth_ps_immu: no Bulgarian rows");
  return { updated: d.updated ?? "", rows };
};
