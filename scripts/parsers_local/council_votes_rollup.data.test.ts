// `regions_summary.json`'s per-oblast COUNCIL VOTES — the quantity the local country map is
// filled by, checked against the committed município bundles that produced it.
//
// ⚠ IT EXISTS BECAUSE „councilVotes" AND „councilSeats" ARE PLAUSIBLE-LOOKING SUBSTITUTES FOR
// EACH OTHER AND ARE NOT THE SAME ANSWER. Seats are apportioned per município under a local
// threshold, so a party spread thinly across many councils leads an oblast on votes and trails
// on seats. A map filled by the wrong one is a correct-looking choropleth that names a different
// party from the ranked list beside it, at a 200, on the two oblasts where they disagree.
//
// ⚠ AND THE MEMBERSHIP DIFFERS, NOT ONLY THE UNIT. The seats rollup skips `mandatesWon <= 0`;
// the votes rollup must not, or every below-threshold list drops out of the denominator that
// every share on the map is printed against. That is the assertion a „the two arrays have the
// same length" check would pass and this one does not.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { reportSkip } from "../lib/report_skip";
import type {
  LocalElectionIndex,
  LocalMunicipalityBundle,
} from "../../src/data/local/types";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CYCLES = ["2015_10_25_mi", "2019_10_27_mi", "2023_10_29_mi"];

type VotesRow = { canonicalId: string; color: string; votes: number };
type SummaryRow = {
  oblast: string;
  councilVotes?: VotesRow[];
  councilSeats?: { canonicalId: string; seats: number }[];
};

const read = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8")) as T;

describe.each(CYCLES)("%s council votes by oblast", (cycle) => {
  const cycleDir = path.join(ROOT, "data", cycle);
  const summaryPath = path.join(cycleDir, "regions_summary.json");
  const indexPath = path.join(cycleDir, "index.json");
  const muniDir = path.join(cycleDir, "municipalities");
  // `data/2*` is gitignored, so a fresh clone has none of this.
  const have =
    fs.existsSync(summaryPath) &&
    fs.existsSync(indexPath) &&
    fs.existsSync(muniDir);

  const summary = have
    ? read<{ regions: SummaryRow[] }>(summaryPath)
    : { regions: [] as SummaryRow[] };

  // ⚠ SELF-ARMING, AND THE SKIP NAMES ITS OWN REASON. „the rollups predate the field" and „the
  // rollups are wrong" must never be the same green — the fix is `npm run data -- --local-rollups`.
  const built = summary.regions.length > 0 && !!summary.regions[0].councilVotes;
  if (!have || !built) {
    reportSkip(
      import.meta.url,
      `${cycle}: ${have ? "regions_summary.json carries no councilVotes yet — run `npm run data -- --local-rollups`" : "data/<cycle> is absent (gitignored)"}`,
    );
    it.skip("skipped", () => {});
    return;
  }

  it("sums, oblast by oblast, to the national council vote", () => {
    // ⚠ THE INDEX IS AN INDEPENDENT WITNESS. `index.json`'s `councilVoteShare` is built by a
    // DIFFERENT pass (`build_index_json`) over the same bundles, so agreement to the vote means
    // the oblast fan-out neither lost a município nor counted one twice — which a per-oblast
    // internal consistency check cannot see.
    const national = read<LocalElectionIndex>(
      indexPath,
    ).councilVoteShare.reduce((a, p) => a + p.totalVotes, 0);
    const summed = summary.regions.reduce(
      (a, r) => a + (r.councilVotes ?? []).reduce((b, p) => b + p.votes, 0),
      0,
    );
    expect(summed).toBe(national);
  });

  it("counts every list that stood, not only the ones that won a seat", () => {
    // The defect this is written against: copying the seats rollup's `mandatesWon <= 0` guard
    // into the votes rollup. It shrinks the denominator silently — every printed share goes UP,
    // and nothing about the map looks broken.
    // ⚠ SOFIA'S 24 РАЙОН SHARDS ARE EXCLUDED, exactly as the builder excludes them, and it is
    // not a rounding difference: each one carries the WHOLE Столичен общински съвет result, so
    // summing them adds the city's 326,464 votes twenty-four more times and takes the corpus
    // from 2,177,293 to 10,012,429. A район has a directly-elected mayor and no council of its
    // own — there is one city council — so the shards repeat it rather than partition it.
    const bundles = fs
      .readdirSync(muniDir)
      .filter((f) => f.endsWith(".json") && !/^S2\d{3}\.json$/.test(f))
      .map((f) => read<LocalMunicipalityBundle>(path.join(muniDir, f)));
    const seatless = bundles.reduce(
      (a, b) => a + b.council.filter((p) => p.mandatesWon <= 0).length,
      0,
    );
    // Anti-vacuity: if no list anywhere failed to win a seat, this case proves nothing.
    expect(seatless).toBeGreaterThan(0);

    const seatlessVotes = bundles.reduce(
      (a, b) =>
        a +
        b.council
          .filter((p) => p.mandatesWon <= 0)
          .reduce((c, p) => c + p.totalVotes, 0),
      0,
    );
    const seatedVotes = bundles.reduce(
      (a, b) =>
        a +
        b.council
          .filter((p) => p.mandatesWon > 0)
          .reduce((c, p) => c + p.totalVotes, 0),
      0,
    );
    const summed = summary.regions.reduce(
      (a, r) => a + (r.councilVotes ?? []).reduce((b, p) => b + p.votes, 0),
      0,
    );
    // Fails EITHER WAY: the seated-only total is what a copied guard would produce.
    expect(summed).toBe(seatedVotes + seatlessVotes);
    expect(summed).not.toBe(seatedVotes);
  });

  it("is sorted leader-first — [0] is what the choropleth reads", () => {
    // ⚠ `sorted()` KEYS ON `count ?? seats ?? votes`. Before `votes` joined that union every row
    // scored 0, the sort was a no-op, and [0] was whichever município the Map happened to see
    // first — an arbitrary leader rather than an empty result or an error.
    for (const r of summary.regions) {
      const v = (r.councilVotes ?? []).map((p) => p.votes);
      expect(v, r.oblast).toEqual([...v].sort((a, b) => b - a));
      expect(v.length, r.oblast).toBeGreaterThan(0);
    }
  });

  it("gives every leader a colour, so no oblast falls back to muted", () => {
    // `LocalCountryMap` renders a missing colour as `hsl(var(--muted))` — the same grey it uses
    // for „no answer here" — so an uncoloured leader is a real answer rendered as an absent one.
    for (const r of summary.regions)
      expect(r.councilVotes?.[0]?.color, r.oblast).toBeTruthy();
  });
});

describe("votes and seats are different answers", () => {
  // ⚠ THE POINT OF THE WHOLE FIELD, and it is asserted ACROSS the cycles rather than within
  // one. 2019 is unanimous — every oblast's votes leader is also its seats leader — so a
  // per-cycle „at least one" would fail on a cycle where nothing is wrong. What must hold is
  // that the two quantities are not interchangeable SOMEWHERE in the corpus the map is drawn
  // from; measured 2026-09-07: 6 oblasts in 2007, 3 in 2011, 2 in 2015, 0 in 2019, 2 in 2023.
  const rows = CYCLES.map((cycle) => {
    const p = path.join(ROOT, "data", cycle, "regions_summary.json");
    return fs.existsSync(p)
      ? read<{ regions: SummaryRow[] }>(p).regions
      : ([] as SummaryRow[]);
  }).flat();

  const built = rows.some((r) => r.councilVotes);
  if (!built) {
    reportSkip(
      import.meta.url,
      "no cycle carries councilVotes yet — run `npm run data -- --local-rollups`",
    );
    it.skip("skipped", () => {});
    return;
  }

  it("names a different party in at least one oblast", () => {
    const disagree = rows.filter(
      (r) =>
        r.councilVotes?.[0] &&
        r.councilSeats?.[0] &&
        r.councilVotes[0].canonicalId !== r.councilSeats[0].canonicalId,
    );
    expect(disagree.length).toBeGreaterThan(0);
  });
});
