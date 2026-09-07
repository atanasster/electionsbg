/**
 * Copies the one flyover artifact into Remotion and refuses to write when any figure the
 * money-map script is built around has moved.
 *
 *   npm run video:data-flyover
 *
 * The output is byte-for-byte identical to `data/home/flyover.json`. Keeping a video-local
 * copy lets Remotion import synchronously without a fetch or a path outside its public root.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { FlyoverWorld } from "../../src/lib/flyover/types";

export const SOURCE = resolve("data/home/flyover.json");
export const OUT = resolve("video/src/generated/flyover.json");

const EXPECTED = {
  computedAt: "2026-09-04",
  contracts: 407_512,
  procurementEur: 93_979_268_978,
  sofiaBuyerPct: 56.6,
  flowTotalEur: 94_189_514_880,
  bothPlacedEur: 43_915_446_808,
  bothPlacedPct: 46.6,
  samePct: 56.5,
  intoSofiaPct: 23.9,
  outOfSofiaPct: 11.8,
  topFlow: ["PDV", "SOF", 1_580] as const,
  fundsPlacedEur: 16_096_493_169,
  fundsTotalEur: 33_656_640_175,
  fundsPlacedPct: 47.8,
  agriTotalEur: 11_037_181_927,
  agriPlovdivMeur: 819,
  agriSofiaMeur: 717,
  agriDobrichMeur: 698,
} as const;

const pct = (ratio: number): number => Math.round(ratio * 1_000) / 10;

const claim = (actual: unknown, expected: unknown, name: string): void => {
  if (actual !== expected) {
    throw new Error(
      `Refusing to write — the flyover story moved: ${name} is ${String(actual)}, expected ${String(expected)}`,
    );
  }
};

/** Assert every quantitative claim the E3 script will show or speak. */
export const assertFlyoverClaims = (world: FlyoverWorld): void => {
  const { figures, flows } = world;
  claim(world.computedAt, EXPECTED.computedAt, "latest contract date");
  claim(figures.procContracts, EXPECTED.contracts, "contract rows");
  claim(
    figures.procTotalEur,
    EXPECTED.procurementEur,
    "procurement tile euros",
  );
  claim(
    pct(figures.sofiaBuyerShare),
    EXPECTED.sofiaBuyerPct,
    "Sofia buyer share",
  );
  claim(flows.coverage.totalEur, EXPECTED.flowTotalEur, "flow denominator");
  claim(
    flows.coverage.bothPlacedEur,
    EXPECTED.bothPlacedEur,
    "both-placed euros",
  );
  claim(
    pct(flows.coverage.bothPlacedEur / flows.coverage.totalEur),
    EXPECTED.bothPlacedPct,
    "both-placed share",
  );
  claim(pct(figures.sameOblastArcShare), EXPECTED.samePct, "same-oblast share");
  claim(
    pct(figures.intoSofiaArcShare),
    EXPECTED.intoSofiaPct,
    "into-Sofia share",
  );
  claim(
    pct(figures.outOfSofiaArcShare),
    EXPECTED.outOfSofiaPct,
    "out-of-Sofia share",
  );
  claim(
    JSON.stringify(figures.topFlow),
    JSON.stringify(EXPECTED.topFlow),
    "top flow",
  );
  claim(figures.fundsPlacedEur, EXPECTED.fundsPlacedEur, "placed EU funds");
  claim(figures.fundsTotalEur, EXPECTED.fundsTotalEur, "total EU funds");
  claim(
    pct(figures.fundsPlacedEur / figures.fundsTotalEur),
    EXPECTED.fundsPlacedPct,
    "placed EU-funds share",
  );
  claim(figures.agriTotalEur, EXPECTED.agriTotalEur, "farm-subsidy total");
  claim(
    world.layers.all?.agri?.PDV,
    EXPECTED.agriPlovdivMeur,
    "Plovdiv farm subsidies",
  );
  claim(
    world.layers.all?.agri?.SOF,
    EXPECTED.agriSofiaMeur,
    "Sofia farm subsidies",
  );
  claim(
    world.layers.all?.agri?.DOB,
    EXPECTED.agriDobrichMeur,
    "Dobrich farm subsidies",
  );
};

export const buildFlyoverVideoData = (): void => {
  const sourceBytes = readFileSync(SOURCE);
  const world = JSON.parse(sourceBytes.toString("utf8")) as FlyoverWorld;
  assertFlyoverClaims(world);
  mkdirSync(dirname(OUT), { recursive: true });
  copyFileSync(SOURCE, OUT);
  claim(readFileSync(OUT).equals(sourceBytes), true, "copied artifact bytes");
  console.log(
    `flyover video data: ${world.computedAt} · ${world.figures.procContracts} contracts · ` +
      `${EXPECTED.sofiaBuyerPct}% Sofia buyer share · ${EXPECTED.bothPlacedPct}% both ends placed`,
  );
  console.log(`  ${SOURCE} → ${OUT} (${sourceBytes.length} B)`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildFlyoverVideoData();
}
