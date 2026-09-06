// A small hand-built world for the engine's tests, and for nothing else.
//
// It is NOT the committed artifact: `data/home/flyover.json` is 34 KB of real geometry, and a
// unit test that loaded it would be measuring the corpus rather than the code — a corpus
// reload would then move assertions in a file that has no opinion about corpora. What this
// fixture keeps is the SHAPE, which `FlyoverWorld` and the data gate's assignability check
// both pin against the real thing.
//
// ⚠️ THE TWO KEY SPACES ARE KEPT APART HERE ON PURPOSE, because the renderer reads both and
// getting them the wrong way round is the easiest mistake in the file. `geo.regions`,
// `prices.byMir` and `elections` are keyed by МИР (31 in the real artifact, and Sofia city is
// THREE of them); `geo.cities`, `layers.*`, `pop` and `flows.keys` are keyed by the 28 money
// OBLASTS. A fixture that used one key set for both would make swapping the lookups invisible
// to every test — so this one gives Sofia two МИР (`S23`, `S24`) over one oblast (`SOF`), and
// no money key is ever a valid МИР key.

import type { FlyoverWorld } from "./types";

const square = (x: number, y: number, r: number): number[][] => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
  [x - r, y - r],
];

export const TEST_WORLD: FlyoverWorld = {
  v: 1,
  computedAt: "2026-09-03",
  frame: { w: 1000, h: 625 },
  geo: {
    regions: {
      // МИР keys, in tenths, like the artifact. Sofia city is two of them here and three in
      // the real corpus; both fold to the one money oblast `SOF`.
      S23: { oblast: "SOF", rings: [square(1800, 3400, 260)], c: [1800, 3400] },
      S24: { oblast: "SOF", rings: [square(1800, 2950, 200)], c: [1800, 2950] },
      "PDV-00": {
        oblast: "PDV",
        rings: [square(4000, 4000, 500)],
        c: [4000, 4000],
      },
      VAR: { oblast: "VAR", rings: [square(8000, 2000, 450)], c: [8000, 2000] },
    },
    // OBLAST keys — the money grain. Sofia's column stands at the CITY (plan §14), which is
    // why this point is not either МИР centroid above.
    cities: {
      SOF: [1780, 3150, "София (столица)", "Sofia-grad"],
      PDV: [4000, 4000, "Пловдив", "Plovdiv"],
      VAR: [8000, 2000, "Варна", "Varna"],
    },
  },
  layers: {
    all: {
      proc: { SOF: 52709, PDV: 5950, VAR: 3100 },
      funds: { SOF: 4345, PDV: 1200, VAR: 900 },
      agri: { SOF: 717, PDV: 819, VAR: 400 },
    },
    "ns:2026_04_19": { proc: { SOF: 2000, PDV: 400, VAR: 200 } },
  },
  pop: { SOF: 1274290, PDV: 634497, VAR: 432198 },
  flows: {
    scope: "all",
    keys: ["PDV", "SOF", "VAR"],
    m: [
      // PDV → PDV, SOF, VAR
      [500, 1116, 20],
      // SOF → …
      [80, 4000, 60],
      // VAR → …
      [15, 1005, 300],
    ],
    // ⚠️ `coverage`, `figures` AND `carrierLead` COME FROM ONE ARTIFACT VINTAGE, and that is an
    // invariant rather than tidiness. `carrierLead` was added with post-T3.3 values while these
    // were left at their pre-T3.1 ones, which made the fixture assert simultaneously that 2,049
    // carriers had been placed at a lead member AND that the `carriers` bucket still held every
    // euro of unplaced consortium money — a state the generator cannot produce. The pair is
    // rendered together in the ARCS loop, so `arcs_consortia` beside `arcs_coverage` then read
    // „€9.8bn of €22.1bn" (44%) where production reads 22%, and any eyeball or snapshot check
    // of the two captions calibrated against a relationship that cannot occur.
    // Refreshed 2026-09-06 from `data/home/flyover.json`.
    coverage: {
      totalEur: 94_189_514_880,
      bothPlacedEur: 43_915_446_808,
      buyerPlacedEur: 93_254_399_806,
      unplaced: {
        trNoSeat: 30_673_505_354,
        notInTr: 18_479_955_103,
        carriers: 753_818_491,
        synthetic: 87_305_164,
        buyerUnplaced: 279_483_961,
      },
    },
    // ⚠️ PRESENT HERE EVEN THOUGH THE FIELD IS OPTIONAL. `captions.test.ts` resolves every
    // caption against this world and asserts each gives at least one finite number, so a
    // fixture without it would make `arcs_consortia` return null and drop out of that sweep —
    // a caption shipped to readers with nothing checking its params. The absent case is
    // covered by its own test instead, which is the half that must not be the default.
    carrierLead: {
      eur: 9_791_395_167,
      consortia: 2_031,
      unplaced: 331,
      multiOblast: 540,
    },
  },
  // МИР keys again — the election corpus is per-МИР and Sofia's three vote separately.
  elections: {
    "2024_10_27": {
      S23: { nick: "ПП-ДБ", color: "#1c6fd6", share: 28.4 },
      S24: { nick: "ПП-ДБ", color: "#1c6fd6", share: 26.2 },
      "PDV-00": { nick: "ГЕРБ-СДС", color: "#0a4a8f", share: 24.1 },
      VAR: { nick: "ГЕРБ-СДС", color: "#0a4a8f", share: 22.9 },
    },
    "2026_04_19": {
      S23: { nick: "ПрБ", color: "#034a3f", share: 32.6 },
      S24: { nick: "ПрБ", color: "#034a3f", share: 31.0 },
      "PDV-00": { nick: "ПрБ", color: "#034a3f", share: 30.1 },
      VAR: { nick: "ГЕРБ-СДС", color: "#0a4a8f", share: 21.4 },
    },
  },
  prices: {
    asOf: "2026-09-04",
    // МИР keys, like the price panel's own `regions` block.
    byMir: { S23: 97.5, S24: 99.1, "PDV-00": 100, VAR: 102.8 },
    national: 98,
  },
  figures: {
    procTotalEur: 93_907_350_255,
    procContracts: 407_392,
    sofiaBuyerShare: 0.566,
    sameOblastArcShare: 0.565,
    intoSofiaArcShare: 0.239,
    outOfSofiaArcShare: 0.118,
    topFlow: ["PDV", "SOF", 1116],
    fundsPlacedEur: 16_062_388_216,
    fundsTotalEur: 33_695_060_498,
    agriTotalEur: 11_037_181_927,
  },
  available: {
    proc: true,
    funds: true,
    agri: true,
    flows: true,
    elections: true,
    prices: true,
    scopedLayers: ["proc"],
  },
};

export const TEST_PALETTE = {
  land: "#e8eef3",
  landEdge: "#b9c6d2",
  landHighlight: "#ffd166",
  column: { proc: "#0b6e99", funds: "#7b5ea7", agri: "#3f8f4a" },
  arcIn: "#d64545",
  arcOut: "#2f9e6f",
  arcNeutral: "#8899a6",
  label: "#12212e",
  labelHalo: "#ffffff",
  priceDown: "#2f9e6f",
  priceUp: "#d64545",
};
