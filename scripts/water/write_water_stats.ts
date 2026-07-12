// НСИ water-services statistics → data/water/water_stats.json. Parses the NSI
// "Относителен дял на населението с водни услуги" timeseries XLSX (Ecology_9.8),
// the national series that carries the воден-режим share (population under water
// rationing), plus population connected to public water supply and to wastewater
// treatment — by year. Static-JSON served like the flood artifact (plan §0b.5 /
// §3 Tier B). The same NSI timeseries fetch pattern as scripts/indicators.
//
// Run: npx tsx scripts/water/write_water_stats.ts

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../raw_data/water/nsi");
const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";
const URL =
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Ecology_9.8.xlsx";
const CACHE = path.join(RAW_DIR, "Ecology_9.8.xlsx");

const fetchXlsx = async (): Promise<Buffer> => {
  if (existsSync(CACHE)) return readFileSync(CACHE);
  const res = await fetch(URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`NSI fetch ${URL} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(CACHE, buf);
  return buf;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

const main = async () => {
  const wb = XLSX.read(await fetchXlsx());
  const sheet = wb.Sheets["9.8.1. POP BG"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
  });

  // The row whose cells are years (2010, 2011, …) is the column spine.
  const yearRowIdx = rows.findIndex((r) =>
    r.slice(1).some((c) => {
      const y = Number(c);
      return Number.isInteger(y) && y >= 2000 && y <= 2100;
    }),
  );
  if (yearRowIdx < 0) throw new Error("no year row found in Ecology_9.8");
  const yearCols: { col: number; year: number }[] = [];
  rows[yearRowIdx].forEach((c, col) => {
    const y = Number(c);
    if (Number.isInteger(y) && y >= 2000 && y <= 2100)
      yearCols.push({ col, year: y });
  });

  // Match metric rows by label prefix (robust to row shifts).
  const rowByLabel = (needle: string): unknown[] | undefined =>
    rows.find((r) =>
      String(r[0] ?? "")
        .trim()
        .startsWith(needle),
    );
  const connectedWater = rowByLabel("Население, свързано с обществено");
  const rationing = rowByLabel("Население с режим");
  const seasonal = rowByLabel("сезонен");
  const yearRound = rowByLabel("целогодишен");
  const wasteTreatment = rowByLabel(
    "Население, свързано с пречиствателни станции за отпа",
  );

  const pick = (r: unknown[] | undefined, col: number): number | null =>
    r ? num(r[col]) : null;

  const years = yearCols.map(({ col, year }) => ({
    year,
    connectedWaterPct: pick(connectedWater, col),
    wasteTreatmentPct: pick(wasteTreatment, col),
    rationingPct: pick(rationing, col),
    rationingSeasonalPct: pick(seasonal, col),
    rationingYearRoundPct: pick(yearRound, col),
  }));

  const out = {
    source:
      "НСИ — Относителен дял на населението с водни услуги (Статистика на водите, Ecology_9.8)",
    sourceUrl: "https://www.nsi.bg/bg/content/2613",
    unit: "процент от населението",
    latestYear: years[years.length - 1]?.year ?? null,
    years,
  };

  mkdirSync("data/water", { recursive: true });
  writeFileSync(
    "data/water/water_stats.json",
    JSON.stringify(out, null, 2) + "\n",
  );
  const last = years[years.length - 1];
  console.log(
    `water_stats.json: ${years.length} years (${years[0]?.year}–${last?.year}) · ${last?.year} режим ${last?.rationingPct}% · водоснабд ${last?.connectedWaterPct}%`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
