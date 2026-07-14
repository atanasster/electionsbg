// e-government adoption — Eurostat isoc_ciegi_ac, indicator I_IUGOV1
// ("interaction with public authorities, last 12 months", the canonical
// e-government-user metric, current methodology as of 2022 — the direct
// successor to the discontinued I_IUGOV12 which stopped at 2021),
// % of individuals. National BG series + the EU27 aggregate + the standard peer
// set (RO/GR/HU/HR) so /sector/administration can show where Bulgaria stands in
// Europe on digital public-service use. Written as a small self-contained
// artifact (data/administration/egov.json) rather than folded into macro.json —
// the peer geos don't belong in the BG-only macro series.
//
//   npx tsx scripts/administration/fetch_egov.ts
//
// Refresh cadence is annual (Eurostat publishes this once a year, usually late
// autumn). A future watcher on the dataset can flip it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(REPO_ROOT, "data/administration/egov.json");

const DATASET = "isoc_ciegi_ac";
const GEOS = ["BG", "EU27_2020", "RO", "EL", "HU", "HR"] as const; // EL = Greece
const BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

interface Point {
  year: number;
  value: number;
}

const fetchGeo = async (geo: string): Promise<Point[]> => {
  const qs = new URLSearchParams({
    format: "JSON",
    lang: "EN",
    freq: "A",
    indic_is: "I_IUGOV1",
    unit: "PC_IND",
    ind_type: "IND_TOTAL",
    geo,
  });
  const url = `${BASE}/${DATASET}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${geo} (${url})`);
  const j = (await res.json()) as {
    dimension?: { time?: { category?: { index?: Record<string, number> } } };
    value?: Record<string, number>;
  };
  const timeIndex = j.dimension?.time?.category?.index ?? {};
  // Invert time.category.index (year → position) to position → year.
  const posToYear: Record<string, number> = {};
  for (const [year, pos] of Object.entries(timeIndex)) {
    posToYear[String(pos)] = Number(year);
  }
  const out: Point[] = [];
  for (const [posStr, val] of Object.entries(j.value ?? {})) {
    const year = posToYear[posStr];
    if (year != null && typeof val === "number") out.push({ year, value: val });
  }
  return out.sort((a, b) => a.year - b.year);
};

const run = async (): Promise<void> => {
  const byGeo: Record<string, Point[]> = {};
  for (const geo of GEOS) {
    const pts = await fetchGeo(geo);
    byGeo[geo] = pts;
    console.log(
      `  ${geo}: ${pts.length} yrs, latest ${pts.at(-1)?.year}=${pts.at(-1)?.value}`,
    );
  }
  // Anchor on BG's OWN latest year, not the max across all geos — Eurostat often
  // publishes the EU27 aggregate or a peer for year N+1 before BG, and the tile's
  // whole point is "where Bulgaria stands", so the BG bar must never drop out.
  const bgPts = byGeo.BG ?? [];
  const latestYear = bgPts.length
    ? Math.max(...bgPts.map((p) => p.year))
    : Math.max(
        ...Object.values(byGeo).flatMap((pts) => pts.map((p) => p.year)),
      );
  const payload = {
    indicator: {
      dataset: DATASET,
      code: "I_IUGOV1",
      titleBg:
        "Взаимодействие с публичната администрация онлайн (последните 12 м.)",
      titleEn: "Interaction with public authorities online (last 12 months)",
      unit: "% of individuals",
    },
    source: {
      name: "Eurostat",
      url: `https://ec.europa.eu/eurostat/databrowser/view/${DATASET}/default/table`,
    },
    fetchedAt: new Date().toISOString(),
    latestYear,
    byGeo,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(
    `✓ wrote ${path.relative(REPO_ROOT, OUT)} (latest ${latestYear})`,
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
