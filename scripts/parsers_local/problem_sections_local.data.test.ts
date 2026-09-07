// The local neighbourhood corpus — the artifact whose SILENT SHRINK made a plan conclude the
// whole feature was impossible.
//
// ⚠⚠ THE TILE SELF-HIDES ON AN EMPTY RESULT, so a matcher regression and „this município
// genuinely has none" render identically — and that is not hypothetical: matched neighbourhoods
// fell from **7 in 2011 and 2015 to 2 in 2019 and 2023** with nothing failing, and
// `docs/plans/presidential-analysis-sections-v1.md` went on to record that local „cannot borrow
// the neighbourhood catalogue" at all. It can, and does; what it had was an unwatched shrink.
//
// ⚠ THE JOIN IS ЕКАТТЕ + ADDRESS, NOT THE SECTION CODE, and that is the whole design: local
// codes are NSI-oblast-prefixed while parliamentary ones are МИР-prefixed, so a code join is
// what would be impossible. These assertions are therefore about the ADDRESS match holding.
//
// ⚠ IT SKIPS ON A FRESH CLONE. `data/*_mi/problem_sections.json` is produced by
// `npm run data -- --local-problem-sections`; a checkout that has never run it has nothing to
// assert against, which must not read as „the corpus is fine".

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

type Neighborhood = {
  id: string;
  obshtinaCode: string;
  sectionCount: number;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
};

const DATA_ROOT = path.join(process.cwd(), "data");

const cycles = fs.existsSync(DATA_ROOT)
  ? fs
      .readdirSync(DATA_ROOT)
      .filter((d) => /^\d{4}_\d{2}_\d{2}_mi$/.test(d))
      .filter((d) =>
        fs.existsSync(path.join(DATA_ROOT, d, "problem_sections.json")),
      )
      .sort()
  : [];

const built = cycles.map((cycle) => ({
  cycle,
  neighborhoods:
    (
      JSON.parse(
        fs.readFileSync(
          path.join(DATA_ROOT, cycle, "problem_sections.json"),
          "utf8",
        ),
      ) as { neighborhoods?: Neighborhood[] }
    ).neighborhoods ?? [],
}));
const hasCorpus = built.length > 0;

describe.runIf(hasCorpus)("the local neighbourhood corpus", () => {
  it.each(built)(
    "$cycle: matched at least one curated neighbourhood",
    ({ neighborhoods }) => {
      // ⚠ A FLOOR AT ALL IS THE POINT. Zero renders as „no such places" on every município page,
      // which is exactly how a matcher that stopped matching would look.
      expect(neighborhoods.length).toBeGreaterThan(0);
    },
  );

  it("still matches SEVEN in the cycles that once did", () => {
    // ⚠ THE RATCHET, ON THE CYCLES WHOSE ANSWER CANNOT CHANGE. 2011 and 2015 are closed
    // historical corpora — their addresses are not going to move — so a drop there is a
    // matcher regression and nothing else. The recent cycles are deliberately NOT ratcheted:
    // 2019 and 2023 match 2, which may be a real address change, and pinning a number nobody
    // has explained would freeze a defect as a requirement.
    for (const { cycle, neighborhoods } of built)
      if (cycle.startsWith("2011") || cycle.startsWith("2015"))
        expect({ cycle, n: neighborhoods.length }).toEqual({ cycle, n: 7 });
  });

  it("REPORTS the shrink the recent cycles carry, rather than asserting it away", () => {
    // ⚠ THIS TEST EXISTS TO KEEP A KNOWN GAP VISIBLE. 7 → 2 between 2015 and 2019 is either a
    // real address change or a matcher regression; nobody has established which, and a suite
    // that simply passed would let the question disappear. It fails only if the recent cycles
    // ever EXCEED the historical ones — at which point this test has done its job and should be
    // rewritten rather than relaxed.
    const historical = built
      .filter((b) => b.cycle < "2019")
      .map((b) => b.neighborhoods.length);
    const recent = built
      .filter((b) => b.cycle >= "2019")
      .map((b) => b.neighborhoods.length);
    if (historical.length && recent.length)
      expect(Math.max(...recent)).toBeLessThanOrEqual(Math.max(...historical));
  });

  it.each(built)(
    "$cycle: every neighbourhood resolves to a município that cycle actually has",
    ({ cycle, neighborhoods }) => {
      // ⚠ THE JOIN THE PLAN BELIEVED WAS IMPOSSIBLE, asserted. A neighbourhood whose
      // `obshtinaCode` has no shard is a row rendered on a page that does not exist.
      const dir = path.join(DATA_ROOT, cycle, "municipalities");
      if (!fs.existsSync(dir)) return;
      const shards = new Set(
        fs.readdirSync(dir).map((f) => f.replace(/\.json$/, "")),
      );
      for (const n of neighborhoods)
        expect({ id: n.id, present: shards.has(n.obshtinaCode) }).toEqual({
          id: n.id,
          present: true,
        });
    },
  );

  it.each(built)(
    "$cycle: every neighbourhood carries sections and a countable vote",
    ({ neighborhoods }) => {
      // A matched neighbourhood with no sections is a name on a page and nothing behind it.
      for (const n of neighborhoods) {
        expect(n.sectionCount).toBeGreaterThan(0);
        expect(n.numRegisteredVoters).toBeGreaterThan(0);
        // ⚠ VALID ≤ TURNED OUT ≤ REGISTERED. The whole point of this corpus is a turnout and
        // invalid-ballot comparison, so an ordering that cannot hold makes every figure on the
        // tile unreadable rather than merely wrong.
        expect(n.numValidVotes).toBeLessThanOrEqual(n.totalActualVoters);
        expect(n.totalActualVoters).toBeLessThanOrEqual(n.numRegisteredVoters);
      }
    },
  );
});
