// The producer's `NationalSummary` and the browser's `PresidentialSummary` describe one file.
//
// ⚠ TWO DECLARATIONS ARE DELIBERATE (see `src/data/presidential/summary.ts`), and this is what
// makes them safe. Nothing else in the repo can see both: the browser type may not import the
// producer's module, and the producer has no reason to import the browser's. A test file in
// `scripts/` is the one place that can hold them side by side, so the assignability is checked
// here — statically, so it costs nothing at runtime — and the guard is run over the committed
// corpus so „the types agree" cannot pass while the FILES fail.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { NationalSummary } from "./nationalSummary";
import {
  isPresidentialSummary,
  type PresidentialSummary,
} from "../../src/data/presidential/summary";

/** ⚠ THE STATIC HALF, AND IT IS AN ASSIGNMENT RATHER THAN AN ASSERTION. A producer change the
 *  browser type cannot describe — a field narrowed, a union widened, a key removed — is a
 *  compile error on this line, which is `tsc -b` and therefore CI, not a runtime skip on a
 *  machine without the corpus. */
const _assignable: (s: NationalSummary) => PresidentialSummary = (s) => s;
void _assignable;

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = (): string[] =>
  fs.existsSync(DATA_ROOT)
    ? fs
        .readdirSync(DATA_ROOT)
        .filter((d) => /^\d{4}_\d{2}_\d{2}_pvr$/.test(d))
        .sort()
    : [];

const hasCorpus = cycles().length > 0;

/** A minimal VALID summary, built by hand.
 *
 * ⚠ THE REFUSAL TABLE MUST RUN IN CI, and the corpus does not: `data/*_pvr` is gitignored, so
 * every `runIf(hasCorpus)` arm below skips on a fresh clone. A guard whose only exercise skips
 * in CI is a guard nobody is checking — so the shapes it must refuse are derived from this
 * literal instead, and the committed corpus is used only for the claim that needs it (that the
 * real files pass).
 *
 * ⚠ IT IS TYPED, so a widened `PresidentialSummary` fails to compile here rather than leaving
 * the fixture quietly short of the real shape. */
const FIXTURE: PresidentialSummary = {
  cycle: "2021_11_14_pvr",
  round1Date: "2021-11-14",
  round2Date: "2021-11-21",
  decidedInRound: 2,
  winner: { number: 6, president: "П", vicePresident: "В" },
  rounds: [
    {
      round: 1,
      date: "2021-11-14",
      ranking: [
        {
          number: 6,
          president: "П",
          vicePresident: "В",
          nominatedBy: { name: "ИК", kind: "committee" },
          votes: 10,
          shareOfValid: 0.5,
        },
      ],
      votes: {
        tickets: 10,
        valid: 20,
        invalid: 1,
        invalidBasis: "paper-ballots-found-invalid",
      },
      turnout: {
        registeredVoters: 100,
        cast: 20,
        pct: 0.2,
        basis: "подписи",
      },
      outcome: {
        meetsMajority: false,
        meetsTurnout: false,
        winsOutright: false,
      },
      abroad: {
        sections: 1,
        ticketVotes: 1,
        ballotsFound: 2,
        countries: 1,
        sectionsWithoutCountry: 0,
        sectionsWithoutSignatures: 0,
      },
    },
  ],
  swing: null,
};

describe.runIf(hasCorpus)("the published national summary", () => {
  it("satisfies the browser's guard in every committed cycle", () => {
    for (const cycle of cycles()) {
      const file = path.join(DATA_ROOT, cycle, "national_summary.json");
      expect(fs.existsSync(file), file).toBe(true);
      const body = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      expect(isPresidentialSummary(body), cycle).toBe(true);
    }
  });
});

describe("the browser's shape guard", () => {
  // ⚠ NO CORPUS — see `FIXTURE`. These run everywhere, including CI, which is where the
  // guard's refusals matter most: they are the only thing between a bad body and a render
  // that throws past the `unusable` state.
  it("has a guard that still refuses — it is not `typeof === object`", () => {
    // ⚠ THE CONTROL. A guard this permissive is worth nothing, and the shapes below are the
    // ones it exists to catch: a 404 body, an HTML error page rendered as JSON, and a
    // truncated file. Each would otherwise reach a screen as an election with no candidates.
    const good = FIXTURE;
    const round = good.rounds[0];
    for (const bad of [
      null,
      "<!doctype html>",
      {},
      { ...good, rounds: [] },
      { ...good, decidedInRound: 3 },
      { ...good, winner: { number: 1 } },
      { ...good, rounds: [{ ...round, turnout: undefined }] },
      { ...good, rounds: [{ ...round, round: 0 }] },
      // ⚠ THE LEAVES THE RENDERER DEREFERENCES. A guard that checked only the containers
      // accepted all four of these, and the screen then threw inside the render — past the
      // `unusable` state that exists so a bad body degrades to a sentence.
      {
        ...good,
        rounds: [
          {
            ...round,
            ranking: [{ ...round.ranking[0], votes: undefined }],
          },
        ],
      },
      {
        ...good,
        rounds: [{ ...round, votes: { ...round.votes, invalid: undefined } }],
      },
      { ...good, rounds: [{ ...round, abroad: { sections: 1 } }] },
      // ⚠ THE UNIT. The catalogue stores 40.3 for the same quantity this file stores as
      // 0.403; a producer that swapped them would render „4030.00%".
      {
        ...good,
        rounds: [{ ...round, turnout: { ...round.turnout, pct: 40.3 } }],
      },
    ])
      expect(isPresidentialSummary(bad), JSON.stringify(bad).slice(0, 60)).toBe(
        false,
      );
  });

  it("accepts a null turnout rate — the state that is not in this corpus yet", () => {
    // ⚠ NO ROUND IN THE FIVE COMMITTED CYCLES HAS ONE (measured 2026-09-06: all ten carry a
    // rate), so a corpus-driven assertion here would be vacuous and would go on passing if the
    // guard started rejecting `null`. The producer types it `number | null` and 2006's basis
    // already shows how a round loses population; the day a round loses its rate entirely,
    // rejecting the null would send it down the „malformed" path — the one state that must
    // stay distinguishable from „this figure does not exist". Asserted directly instead.
    const good = FIXTURE;
    const withNull = {
      ...good,
      rounds: good.rounds.map((r) => ({
        ...r,
        turnout: { ...r.turnout, pct: null },
      })),
    };
    expect(isPresidentialSummary(withNull)).toBe(true);
    // …and it is the NULL that is accepted, not everything: a string is still refused.
    const withString = {
      ...good,
      rounds: good.rounds.map((r) => ({
        ...r,
        turnout: { ...r.turnout, pct: "40%" },
      })),
    };
    expect(isPresidentialSummary(withString)).toBe(false);
  });
});
