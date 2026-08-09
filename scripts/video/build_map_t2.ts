/**
 * Precomputes T2's map: municipality outlines as SVG path strings, each tagged
 * with whether that municipality's winning party changed between the October 2024
 * and April 2026 parliamentary elections.
 *
 *   npm run video:map-t2
 *
 * WHY PRECOMPUTE. The scene could project in the browser, but then every frame
 * pays for 288 polygons and the composition needs `delayRender` around a fetch.
 * Projecting once here makes the render deterministic, removes the async harness,
 * and keeps the payload small (coordinates rounded to 0.1px).
 *
 * WHY d3-geo AND NOT A TILE MAP. The basemap carries no information in this story
 * — the DATA is the map. A tile provider would add a key, WebGL, headless-render
 * shimmer and a 4096px renderbuffer ceiling for no payload. See
 * .claude/skills/naiasno-video/references/scenes.md.
 *
 * ── THE PARTY-IDENTITY TRAP, and why this file does the comparison ────────────
 * `partyNum` is a BALLOT POSITION and it is reassigned every election: number 1
 * was ДОСТ in 2024 and ИТН in 2026. Comparing partyNum across cycles compares
 * different parties and reports that ~100% of municipalities changed hands, which
 * is how the first attempt at this went. The comparison must be on party IDENTITY.
 *
 * Two renames then have to be folded, or the answer is 256 changed instead of 236:
 *   ДПС-НН → ДПС      (Ново начало dropped the suffix)  — 19 municipalities
 *   БСП    → БСП-ОЛ   (БСП — Обединена левица)          —  1 municipality
 * Both are the same party under a new label. Verified against the published card
 * `2026-07-31-municipalities-changed-winner`, whose breakdown of the 29 that kept
 * their winner (19 ДПС, 6 ГЕРБ-СДС, 2 ПП-ДБ, 1 АПС, 1 БСП) reproduces exactly.
 *
 * ── THE UNIT OF COUNTING ──────────────────────────────────────────────────────
 * 265 municipalities = 264 ordinary codes + Sofia. The obshtina code list also
 * contains 24 `S2xxx` Sofia RAYONI (sub-municipal) and 6 abroad "continents"
 * (OC/EU/NA/SA/AS/AF); counting either inflates the denominator past 265. Sofia's
 * winner is therefore the sum of its 24 rayoni, while the MAP still draws all 24
 * polygons — coloured with Sofia's single verdict.
 */
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { geoMercator, geoPath } from "d3-geo";

const PREV = "2024_10_27";
const CURR = "2026_04_19";
/**
 * Emitted into `src/` rather than `public/` so the scene can IMPORT it: a
 * public-dir asset would need a fetch wrapped in `delayRender`, and this data is
 * static per election. Committed despite being derived — both source elections are
 * historical and frozen, and the assertions below (exactly 265 municipalities, no
 * unmatched polygon) make a regeneration safe rather than a coin flip.
 */
const OUT = resolve("video/src/generated/t2-municipalities.json");

/** Viewbox the paths are projected into; the scene scales it to the frame. */
const VIEW_W = 1000;
const VIEW_H = 640;

const ABROAD = new Set(["OC", "EU", "NA", "SA", "AS", "AF"]);
const isRayon = (code: string) => /^S2\d{3}$/.test(code);

/** Same party, new label. See the header. */
const FOLD: Record<string, string> = {
  "ДПС-НН": "ДПС",
  "БСП-ОЛ": "БСП",
};
export const foldParty = (name: string): string => FOLD[name] ?? name;

type GeoFeature = {
  type: "Feature";
  properties?: { nuts4?: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};

const partyNames = (cycle: string): Map<number, string> => {
  const raw = JSON.parse(
    readFileSync(resolve(`data/${cycle}/cik_parties.json`), "utf8"),
  ) as unknown;
  const arr = (Array.isArray(raw) ? raw : Object.values(raw as object)) as {
    number?: number;
    partyNum?: number;
    nickName?: string;
    name?: string;
  }[];
  return new Map(
    arr.map((p) => [
      (p.number ?? p.partyNum)!,
      (p.nickName || p.name || "").trim(),
    ]),
  );
};

const winnerOf = (
  cycle: string,
  codes: string[],
  names: Map<number, string>,
): string | null => {
  const tally = new Map<number, number>();
  for (const c of codes) {
    const p = resolve(`data/${cycle}/municipalities/${c}.json`);
    if (!existsSync(p)) continue;
    const shard = JSON.parse(readFileSync(p, "utf8")) as {
      results?: { votes?: { partyNum: number; totalVotes?: number }[] };
    };
    for (const v of shard.results?.votes ?? []) {
      tally.set(v.partyNum, (tally.get(v.partyNum) ?? 0) + (v.totalVotes ?? 0));
    }
  }
  let best: [number, number] | null = null;
  for (const [n, v] of tally) if (!best || v > best[1]) best = [n, v];
  if (!best || !best[1]) return null;
  return foldParty(names.get(best[0]) ?? String(best[0]));
};

const main = () => {
  const muni = JSON.parse(
    readFileSync(resolve("data/municipalities.json"), "utf8"),
  );
  const allCodes = [
    ...new Set(
      (Array.isArray(muni) ? muni : Object.values(muni)).map(
        (x: { obshtina?: string }) => x.obshtina,
      ),
    ),
  ].filter(Boolean) as string[];

  const rayoni = allCodes.filter(isRayon);
  const standard = allCodes.filter((c) => !isRayon(c) && !ABROAD.has(c));
  const units: { name: string; codes: string[] }[] = [
    ...standard.map((c) => ({ name: c, codes: [c] })),
    { name: "SOF", codes: rayoni },
  ];

  const prevNames = partyNames(PREV);
  const currNames = partyNames(CURR);

  /** unit name → changed? */
  const verdict = new Map<string, boolean>();
  let changed = 0;
  let kept = 0;
  const keptBy = new Map<string, number>();
  for (const u of units) {
    const a = winnerOf(PREV, u.codes, prevNames);
    const b = winnerOf(CURR, u.codes, currNames);
    if (a == null || b == null) continue;
    const isChanged = a !== b;
    verdict.set(u.name, isChanged);
    if (isChanged) changed++;
    else {
      kept++;
      keptBy.set(b, (keptBy.get(b) ?? 0) + 1);
    }
  }

  // Geometry. `32.json` is the abroad synthetic — including it would fit Bulgaria
  // plus Oceania into the frame.
  const features: GeoFeature[] = [];
  const dir = resolve("data/maps/regions");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "32.json") continue;
    features.push(
      ...(
        JSON.parse(readFileSync(resolve(dir, f), "utf8")) as {
          features: GeoFeature[];
        }
      ).features,
    );
  }

  const collection = {
    type: "FeatureCollection",
    features,
  } as unknown as Parameters<ReturnType<typeof geoPath>>[0];
  const projection = geoMercator().fitExtent(
    [
      [8, 8],
      [VIEW_W - 8, VIEW_H - 8],
    ],
    collection,
  );
  const path = geoPath(projection);

  const out: { code: string; d: string; changed: boolean }[] = [];
  let unmatched = 0;
  for (const f of features) {
    const code = f.properties?.nuts4;
    if (!code) continue;
    // A Sofia rayon inherits the city's single verdict.
    const unit = isRayon(code) ? "SOF" : code;
    const isChanged = verdict.get(unit);
    if (isChanged === undefined) {
      unmatched++;
      continue;
    }
    const d = path(f as never);
    if (!d) continue;
    out.push({
      code,
      d: d.replace(/(\d+\.\d)\d+/g, "$1"), // 0.1px is finer than a rendered pixel
      changed: isChanged,
    });
  }

  if (changed + kept !== 265) {
    console.error(
      `Refusing to write: classified ${changed + kept} municipalities, expected 265. ` +
        `Check the rayon/abroad filters.`,
    );
    process.exit(1);
  }
  if (unmatched) {
    console.error(`Refusing to write: ${unmatched} polygons had no verdict.`);
    process.exit(1);
  }

  mkdirSync(resolve("video/src/generated"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      changed,
      kept,
      total: changed + kept,
      features: out,
    }),
    "utf8",
  );

  console.log(
    `  ${changed} changed · ${kept} kept · ${changed + kept} municipalities`,
  );
  console.log(
    `  kept by party: ${[...keptBy]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p} ${n}`)
      .join(", ")}`,
  );
  console.log(`  ${out.length} polygons → ${OUT}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
