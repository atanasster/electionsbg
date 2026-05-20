/**
 * АЗ (Агенция по заетостта) — oblast-grain long-term unemployment.
 *
 * The АЗ annual review breaks registered unemployment down by sub-category
 * (youth / long-term / 50+ / education) only at OBLAST grain — the
 * municipality tables carry just the headline rate (already ingested as the
 * `unemployment` municipality indicator). This step picks up the long-term
 * share and merges it into the oblast-grain artifact, data/regional.json,
 * as the `ltUnemployment` indicator.
 *
 * Reads the combined АЗ XLSX files cached under raw_data/indicators/az/ by
 * scripts/indicators/sources/az_unemployment.ts — sheet "Регистрирани
 * продължително БЛ", column "Дял (%)" (share of registered unemployed out
 * of work for more than a year).
 *
 * MUST run after scripts/regional/fetch_eurostat.ts — it merges into the
 * regional.json that fetcher writes. The `update-regional` skill runs both.
 *
 * Usage: npx tsx scripts/regional/fetch_az_oblast.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AZ_RAW_DIR = path.resolve(__dirname, "../../raw_data/indicators/az");
const REGIONAL_FILE = path.resolve(__dirname, "../../data/regional.json");
const SHEET_NAME = "Регистрирани продължително БЛ";

// АЗ oblast name (folded uppercase) → regional.json oblast code(s). Sofia
// city is one АЗ row "София (столица)" but three МИР keys in regional.json
// (mirrors the Eurostat fetcher, which duplicates BG411 across S23/S24/S25).
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
  ПЛОВДИВ: ["PDV"],
  РАЗГРАД: ["RAZ"],
  РУСЕ: ["RSE"],
  СИЛИСТРА: ["SLS"],
  СЛИВЕН: ["SLV"],
  СМОЛЯН: ["SML"],
  СОФИЯ: ["SFO"],
  "СОФИЯ (СТОЛИЦА)": ["S23", "S24", "S25"],
  "СТАРА ЗАГОРА": ["SZR"],
  ТЪРГОВИЩЕ: ["TGV"],
  ХАСКОВО: ["HKV"],
  ШУМЕН: ["SHU"],
  ЯМБОЛ: ["JAM"],
};

const fold = (s: string) =>
  s.toLocaleUpperCase("bg-BG").replace(/\s+/g, " ").trim();

type Cell = string | number | null | undefined;
type Point = { code: string; year: number; value: number };

// Parse one combined АЗ XLSX. Returns the long-term-unemployed share per
// oblast for that file's reporting year, or [] if the sheet is absent
// (pre-2024 АЗ files are per-topic and don't carry it).
const parseFile = (file: string): Point[] => {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  if (!wb.SheetNames.includes(SHEET_NAME)) return [];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[SHEET_NAME], {
    header: 1,
    raw: true,
  });

  // Header row: col 0 is "Област", col 1 holds the reporting year ("2025 г.").
  let headerIdx = -1;
  let year = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i] ?? [];
    if (typeof row[0] === "string" && row[0].trim() === "Област") {
      const ym = String(row[1] ?? "").match(/(20\d\d)/);
      if (ym) {
        headerIdx = i;
        year = Number(ym[1]);
      }
      break;
    }
  }
  if (headerIdx < 0)
    throw new Error(`fetch_az_oblast: no "Област" header row in ${file}`);

  // Columns: 0 name · 1 Брой (count) · 2 Дял (%) — the long-term share.
  const out: Point[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const raw = row[0];
    if (typeof raw !== "string") continue;
    const codes = OBLAST_NAME_TO_CODES[fold(raw)];
    if (!codes) continue;
    const share = row[2];
    if (typeof share !== "number" || !Number.isFinite(share)) continue;
    const value = Math.round(share * 10) / 10;
    for (const code of codes) out.push({ code, year, value });
  }
  return out;
};

const main = () => {
  if (!fs.existsSync(REGIONAL_FILE)) {
    throw new Error(
      `${REGIONAL_FILE} not found — run scripts/regional/fetch_eurostat.ts first.`,
    );
  }
  const azFiles = fs.existsSync(AZ_RAW_DIR)
    ? fs
        .readdirSync(AZ_RAW_DIR)
        .filter((f) => f.endsWith(".xlsx"))
        .map((f) => path.join(AZ_RAW_DIR, f))
    : [];
  if (azFiles.length === 0) {
    throw new Error(
      `no АЗ XLSX in ${AZ_RAW_DIR} — run scripts/indicators/fetch.ts first.`,
    );
  }

  // Collect points across every combined АЗ file; later years win on overlap.
  const byCodeYear = new Map<string, Point>();
  let filesWithSheet = 0;
  for (const file of azFiles) {
    const points = parseFile(file);
    if (points.length > 0) filesWithSheet++;
    for (const p of points) byCodeYear.set(`${p.code}|${p.year}`, p);
  }
  if (byCodeYear.size === 0) {
    throw new Error(
      `no "${SHEET_NAME}" sheet found in any АЗ file — only the 2024+ combined format carries it.`,
    );
  }

  const series: Record<string, { year: number; value: number }[]> = {};
  for (const p of byCodeYear.values()) {
    (series[p.code] ??= []).push({ year: p.year, value: p.value });
  }
  for (const code of Object.keys(series)) {
    series[code].sort((a, b) => a.year - b.year);
  }

  const regional = JSON.parse(fs.readFileSync(REGIONAL_FILE, "utf8"));
  regional.indicators.ltUnemployment = {
    titleEn: "Long-term unemployed share",
    titleBg: "Дял на продължително безработните",
    unitLabelEn: "% of registered unemployed",
    unitLabelBg: "% от регистрираните безработни",
    sourceUrl: "https://www.az.government.bg/stats/4/",
    datasetCode: "az-longterm",
  };
  regional.series.ltUnemployment = series;
  regional.fetchedAt = new Date().toISOString();
  fs.writeFileSync(REGIONAL_FILE, JSON.stringify(regional));

  const oblastCount = Object.keys(series).length;
  const years = [
    ...new Set(Object.values(series).flatMap((pts) => pts.map((p) => p.year))),
  ].sort();
  console.log(
    `Merged ltUnemployment into ${REGIONAL_FILE}: ${oblastCount} oblasts, years ${years.join(", ")} (${filesWithSheet} АЗ files with the sheet).`,
  );
};

main();
