/**
 * Bulgaria electricity generation mix, net trade & carbon intensity — from
 * Ember's Yearly Electricity Data (CC BY 4.0), the open dataset OWID/others build
 * on. Writes the compact data/energy/generation.json the /sector/energy physics
 * tiles read. One CSV download (global long-format ~49MB), filtered to Bulgaria.
 *
 *   pnpm exec tsx scripts/energy/fetch_generation.ts
 *
 * Source: https://ember-energy.org/data/  (release_generation_yearly_global.csv)
 * Attribution required on the tile: "Ember — Yearly Electricity Data (CC BY 4.0)".
 *
 * The story this feeds: nuclear-heavy mix, a persistent NET EXPORTER (negative
 * net imports), and a CO2-intensity path that the coal phase-out has to bend.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../data/energy/generation.json");
// The legacy yearly_full_release_long_format.csv is now a 320-byte "no longer
// updated" stub (since ~2026-11); this is the replacement named in that stub.
const CSV_URL =
  "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_global.csv";

const FIRST_YEAR = 2007; // align with the procurement corpus window (SCOPE_FIRST_YEAR era)

// Ember "Variable" (Subcategory="Fuel") → our compact key.
const FUEL_KEY: Record<string, string> = {
  Nuclear: "nuclear",
  Coal: "coal",
  Gas: "gas",
  Hydro: "hydro",
  Solar: "solar",
  Wind: "wind",
  Bioenergy: "bioenergy",
  "Other fossil": "otherFossil",
  "Other renewables": "otherRenewables",
};

interface Row {
  Area: string;
  Year: string;
  "Electricity source": string;
  "Is aggregated source": string;
  "Generation (TWh)": string;
  "Emissions (MtCO2e)": string;
  "Emissions intensity (gCO2e/kWh)": string;
}

const num = (v: string): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface YearRec {
  year: number;
  byFuel: Record<string, number>;
  totalGen: number | null;
  demand: number | null;
  netImports: number | null; // negative = net exporter
  co2Intensity: number | null; // gCO2/kWh
  totalEmissions: number | null; // mtCO2
}

const main = async (): Promise<void> => {
  console.log("energy/generation: downloading Ember yearly CSV…");
  const res = await fetch(CSV_URL, {
    headers: { "User-Agent": "electionsbg-data/1.0" },
  });
  if (!res.ok) throw new Error(`Ember CSV fetch failed: HTTP ${res.status}`);
  const csv = await res.text();

  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Row[];

  const byYear = new Map<number, YearRec>();
  const ensure = (y: number): YearRec => {
    let r = byYear.get(y);
    if (!r) {
      r = {
        year: y,
        byFuel: {},
        totalGen: null,
        demand: null,
        netImports: null,
        co2Intensity: null,
        totalEmissions: null,
      };
      byYear.set(y, r);
    }
    return r;
  };

  for (const row of rows) {
    if (row.Area !== "Bulgaria") continue;
    const year = Number(row.Year);
    if (!Number.isFinite(year) || year < FIRST_YEAR) continue;
    const src = row["Electricity source"];
    const gen = num(row["Generation (TWh)"]);
    const rec = ensure(year);

    if (row["Is aggregated source"] === "False" && FUEL_KEY[src]) {
      if (gen != null) rec.byFuel[FUEL_KEY[src]] = gen;
    } else if (src === "Total generation") {
      rec.totalGen = gen;
      rec.co2Intensity = num(row["Emissions intensity (gCO2e/kWh)"]);
      rec.totalEmissions = num(row["Emissions (MtCO2e)"]);
    } else if (src === "Demand") {
      rec.demand = gen;
    } else if (src === "Net imports") {
      rec.netImports = gen;
    }
  }

  const years = [...byYear.values()]
    .filter((r) => Object.keys(r.byFuel).length > 0)
    .sort((a, b) => a.year - b.year);

  if (years.length < 5)
    throw new Error(
      `energy/generation: only ${years.length} BG years parsed — upstream schema likely changed`,
    );

  const out = {
    updated: process.env.INGEST_DATE ?? new Date().toISOString().slice(0, 10),
    source: "Ember — Yearly Electricity Data (CC BY 4.0)",
    sourceUrl: "https://ember-energy.org/data/",
    latestYear: years[years.length - 1].year,
    years,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  const latest = years[years.length - 1];
  console.log(
    `energy/generation: ${years.length} years (${years[0].year}–${latest.year}) → ${path.relative(process.cwd(), OUT)}`,
  );
  console.log(
    `  latest ${latest.year}: total ${latest.totalGen} TWh, net imports ${latest.netImports} TWh (${(latest.netImports ?? 0) < 0 ? "net EXPORTER" : "net importer"}), CO2 ${latest.co2Intensity} gCO2/kWh`,
  );
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
