// EKATTE → place resolver for the price ingest.
// Joins the KZP feed's settlement codes to the project's canonical
// settlement/muni/oblast tree (data/settlements.json) + census population
// (data/census_2021_settlements.json) for size-class peer banding.

import fs from "node:fs";
import path from "node:path";
import type { PlaceLoc, PopBand } from "../types";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);

interface SettlementRec {
  ekatte: string;
  name: string;
  name_en: string;
  oblast: string;
  obshtina: string;
  nuts3: string;
}

const settlements: SettlementRec[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/settlements.json"), "utf8"),
);
const census: { ekatte: string; population: number }[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/census_2021_settlements.json"), "utf8"),
);

const byEkatte = new Map(settlements.map((s) => [s.ekatte, s]));
const popByEkatte = new Map(census.map((c) => [c.ekatte, c.population]));

export const popBand = (pop: number | null): PopBand => {
  if (pop == null) return "S";
  if (pop >= 100_000) return "XL";
  if (pop >= 30_000) return "L";
  if (pop >= 10_000) return "M";
  return "S";
};

/**
 * Normalize a raw feed settlement code to a clean 5-digit EKATTE:
 * strip BOM/quotes, drop any Sofia district suffix (`68134-01` → `68134`),
 * zero-pad to 5 (`151` → `00151`).
 */
export const normalizeEkatte = (raw: string): string => {
  let c = raw
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim();
  c = c.split("-")[0];
  return c.padStart(5, "0");
};

// Sofia city (гр. София, EKATTE 68134) is not a single settlement in our
// tree — it is 24 райони across oblasts S23/S24/S25. The feed reports it as
// one place, so we synthesize a city node. Oblast S23 is representative so it
// joins an existing region code; the city's own settlement page (68134) is
// exact, only its oblast-rollup attribution is approximate.
const SOFIA: PlaceLoc = {
  ekatte: "68134",
  name: "София",
  nameEn: "Sofia",
  obshtina: "SOF46",
  oblast: "S23",
  population: 1_300_000,
  popBand: "XL",
};

export const resolvePlace = (rawEkatte: string): PlaceLoc | null => {
  const ekatte = normalizeEkatte(rawEkatte);
  if (ekatte === "68134") return SOFIA;
  const s = byEkatte.get(ekatte);
  if (!s) return null;
  const population = popByEkatte.get(ekatte) ?? null;
  return {
    ekatte,
    name: s.name,
    nameEn: s.name_en,
    obshtina: s.obshtina,
    oblast: s.oblast,
    population,
    popBand: popBand(population),
  };
};
