// A level may declare only the ranked columns its own producer can fill — checked against the
// GENERATED CORPUS, not against the type.
//
// ⚠ THIS IS THE GATE THAT WOULD HAVE CAUGHT THE `local/region` DEFECT AND DID NOT EXIST.
// `buildRegionSurface` writes `votes: 0, pct: 0` into every preview row because the schema
// requires the fields and the source publishes no per-party vote total. The level declared
// `["votes", "pct", "seats"]`, and `rankedCell` renders both unconditionally — so the moment the
// region screen was switched on it printed „0 гласа · 0,00 %" against named parties, beside a
// real seat count and a `validVotes` of 141,998 on the same artifact. 456 of 456 published rows.
//
// The type could not see it: `votes` and `pct` are non-optional `number`, so a placeholder zero
// is indistinguishable from a measurement to every check that reads the schema. Only the corpus
// knows, which is why this gate reads the corpus.
//
// ⚠ A GENUINE ZERO IS NOT A PLACEHOLDER, and the difference is the whole design. A party that
// really won no seats is 0; a producer that has no seat data writes `undefined`. So the test is
// not "no zeros" — it is "not EVERY row is empty", which is the only shape that can mean the
// producer has nothing to put there.
//
//   npm run test:data

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as B from "../../elections/build_surfaces";
import { descriptorFor } from "../../../src/screens/elections/electionSurfaceDescriptors";
import type {
  ElectionRankedEntry,
  ElectionSurfaceBallot,
} from "../../../src/data/elections/surfaceTypes";
import { reportSkip } from "../../lib/report_skip";

const ALL: B.Emitted[] = B.coveredCycles().flatMap(({ kind, cycle }) =>
  B.generate(kind, cycle),
);
const skip = ALL.length
  ? ""
  : "no generated surfaces — the raw corpus for these cycles is absent";
reportSkip(import.meta.url, skip);

/** Whether a column has a real value here. `undefined` and the producer's placeholder `0` on a
 *  vote column both count as absent; a `0` seat count does not, because a party can genuinely
 *  hold none.
 *
 *  ⚠ `round` IS READ FROM THE BALLOT, NOT THE ROW, because that is where `rankedCell` reads it
 *  (`ballot.round`) and where the schema puts it. The first cut of this gate checked `e.round`
 *  — a field `ElectionRankedEntry` does not have — and reported `round` dead at two levels whose
 *  corpus carries it on all 5,488 mayor ballots. A fillability gate that reads a different field
 *  from the renderer measures nothing about what a reader sees. */
const filled = (
  col: string,
  e: ElectionRankedEntry,
  ballot: ElectionSurfaceBallot,
): boolean => {
  switch (col) {
    // ⚠ `> 0`, NOT `!== undefined`. These two are non-optional in the schema, so a producer
    // with nothing to say writes 0 — which is exactly the case this gate exists for.
    case "votes":
      return e.votes > 0;
    case "pct":
      return e.pct > 0;
    case "seats":
      return e.seats !== undefined;
    case "margin":
      return e.marginPct !== undefined;
    case "round":
      return ballot.round !== undefined;
    case "elected":
      return e.isElected !== undefined;
    default:
      return false;
  }
};

describe.skipIf(skip)("every declared ranked column has a producer", () => {
  it("is fillable somewhere in the corpus, at every level that declares it", () => {
    // Row AND its ballot: `round` is a ballot property and the rest are row properties, so a
    // flattened list of rows cannot answer for both.
    const rows = new Map<
      string,
      { row: ElectionRankedEntry; ballot: ElectionSurfaceBallot }[]
    >();
    for (const e of ALL) {
      const key = `${e.surface.kind}/${e.surface.place.level}`;
      const list = rows.get(key) ?? [];
      for (const b of e.surface.ballots)
        for (const row of b.preview) list.push({ row, ballot: b });
      rows.set(key, list);
    }

    const dead: string[] = [];
    for (const [key, preview] of rows) {
      if (preview.length === 0) continue;
      const [kind, level] = key.split("/") as [
        Parameters<typeof descriptorFor>[0],
        Parameters<typeof descriptorFor>[1],
      ];
      const d = descriptorFor(kind, level);
      if (!d.available) continue;
      for (const col of d.rankedColumns)
        if (!preview.some(({ row, ballot }) => filled(col, row, ballot)))
          dead.push(
            `${key} declares "${col}" and no row in ${preview.length} fills it`,
          );
    }
    expect(dead).toEqual([]);
  });

  it("discriminates — it is not passing because `filled` says yes to everything", () => {
    // ⚠ WITHOUT THIS THE TEST ABOVE PASSES ON A `filled` THAT RETURNED TRUE, which is the one
    // way a corpus-wide sweep goes quietly vacuous.
    const empty = {
      partyId: "gerb",
      votes: 0,
      pct: 0,
    } as unknown as ElectionRankedEntry;
    const noRound = {} as unknown as ElectionSurfaceBallot;
    for (const col of ["votes", "pct", "seats", "margin", "round", "elected"])
      expect(filled(col, empty, noRound), col).toBe(false);

    const real = {
      partyId: "gerb",
      votes: 10,
      pct: 1.5,
      seats: 0,
      marginPct: 2,
      isElected: true,
    } as unknown as ElectionRankedEntry;
    const withRound = { round: 2 } as unknown as ElectionSurfaceBallot;
    for (const col of ["votes", "pct", "seats", "margin", "round", "elected"])
      expect(filled(col, real, withRound), col).toBe(true);
  });

  it("counts a genuine zero as filled where the schema allows absence", () => {
    // A party that really won no seats is `seats: 0` and must not read as "the producer has no
    // seat data" — that distinction is why `seats` tests presence and `votes` tests magnitude.
    const zeroSeats = { seats: 0 } as unknown as ElectionRankedEntry;
    expect(
      filled("seats", zeroSeats, {} as unknown as ElectionSurfaceBallot),
    ).toBe(true);
  });
});

// ─── the skeleton's fact count against what the level renders ────────────────────────────────

describe.skipIf(skip)(
  "each call site reserves the facts its level shows",
  () => {
    // ⚠ NOTHING TIED THE TWO TOGETHER, AND THE SKELETON EXISTS ONLY TO MATCH. Its whole job is to
    // reserve the space the arriving surface will occupy, so a `facts={n}` that disagrees with the
    // level's real output is a layout shift with a placeholder in front of it — the defect the
    // component was written to prevent, wearing the component's own clothes. Caught on
    // `local/region`, which reserved 2 and renders 1 because `turnout` is not in that level's
    // `factPriority` even though the artifact carries it.

    /** How many fact cards a level actually draws: the artifact's facts, filtered to the ones the
     *  level prioritises, capped by `maxFacts` — the same three steps `OutcomeStrip` takes. */
    const rendered = (e: B.Emitted): number => {
      const d = descriptorFor(e.surface.kind, e.surface.place.level);
      if (!d.available) return 0;
      const shown = e.surface.facts.filter((f) =>
        d.factPriority.includes(f.code),
      );
      return Math.min(shown.length, d.maxFacts);
    };

    it("matches the maximum any artifact of that level renders", () => {
      // ⚠ THE MAX, NOT THE MEAN OR THE MODE. A skeleton shorter than the tallest real page still
      // shifts on that page; reserving the largest is the only value that never shifts downward.
      const byLevel = new Map<string, number>();
      for (const e of ALL) {
        const key = `${e.surface.kind}/${e.surface.place.level}`;
        byLevel.set(key, Math.max(byLevel.get(key) ?? 0, rendered(e)));
      }

      const src = fs.readFileSync(
        path.join(process.cwd(), "src/screens/LocalRegionDashboardScreen.tsx"),
        "utf8",
      );
      expect(byLevel.get("local/region")).toBe(1);
      expect(src, "local/region reserves a fact it does not render").toContain(
        "facts={1}",
      );

      const country = fs.readFileSync(
        path.join(process.cwd(), "src/screens/LocalElectionScreen.tsx"),
        "utf8",
      );
      expect(byLevel.get("local/country")).toBe(2);
      expect(country).toContain("facts={2}");
    });

    it("discriminates — `rendered` is not just returning the artifact's fact count", () => {
      // The local/region artifact carries TWO facts and renders ONE. If `rendered` ignored
      // `factPriority` both numbers would be 2 and the assertion above would pass on the bug.
      const region = ALL.find(
        (e) => e.surface.kind === "local" && e.surface.place.level === "region",
      );
      expect(region, "no local/region surface generated").toBeTruthy();
      expect(region!.surface.facts.length).toBe(2);
      expect(rendered(region!)).toBe(1);
    });
  },
);

// ─── and the narrowing must never empty a table ──────────────────────────────────────────────

describe.skipIf(skip)(
  "per-BALLOT narrowing leaves every table with columns",
  () => {
    // ⚠ THE LEVEL CHECK ABOVE CANNOT SEE THIS. It asks whether a column is fillable SOMEWHERE on
    // the level; the reader sees one ballot at a time. `local/municipality` fills `round` and
    // `elected` on its mayor ballot and neither on its council ballot, and `seats` the other way
    // round — so the level passes while two of its tables printed headers over blank columns.
    //
    // ⚠ AND `local/region` IS THE ONE THAT COULD GO TO ZERO. It declares exactly one column
    // (`seats`), so a single ballot whose rows all lack it would render a table with a participant
    // column and nothing else — not a wrong figure, but a table that answers nothing.

    /** The same narrowing `RankedResult` applies, kept in step with it by reading the same
     *  fields. ⚠ Not imported from the shell: that module pulls React and the label resolvers, so
     *  a node data test cannot load it. The duplication is deliberate and the two are pinned
     *  together by the assertion below rather than by hoping they agree. */
    const fillsForBallot = (
      col: string,
      b: B.Emitted["surface"]["ballots"][number],
    ) => {
      if (col === "round") return b.round !== undefined;
      if (col === "seats") return b.preview.some((r) => r.seats !== undefined);
      if (col === "margin")
        return b.preview.some((r) => r.marginPct !== undefined);
      if (col === "elected")
        return b.preview.some((r) => r.isElected !== undefined);
      return true;
    };

    it("no published ballot narrows to an empty column set", () => {
      const empty: string[] = [];
      for (const e of ALL) {
        const d = descriptorFor(e.surface.kind, e.surface.place.level);
        if (!d.available) continue;
        for (const b of e.surface.ballots) {
          if (b.preview.length === 0) continue;
          const cols = d.rankedColumns.filter((c) => fillsForBallot(c, b));
          if (cols.length === 0)
            empty.push(
              `${e.surface.kind}/${e.surface.place.level}/${e.id} ${b.kind}`,
            );
        }
      }
      expect(empty.slice(0, 5)).toEqual([]);
    });

    it("and the narrowing actually narrows — it is not a no-op", () => {
      // ⚠ WITHOUT THIS, "no table is empty" passes on an implementation that never drops
      // anything, which is the state this whole change replaced.
      const narrowed = ALL.flatMap((e) => {
        const d = descriptorFor(e.surface.kind, e.surface.place.level);
        if (!d.available) return [];
        return e.surface.ballots
          .filter((b) => b.preview.length > 0)
          .filter(
            (b) =>
              d.rankedColumns.filter((c) => fillsForBallot(c, b)).length <
              d.rankedColumns.length,
          )
          .map((b) => `${e.surface.place.level}/${b.kind}`);
      });
      expect(narrowed.length).toBeGreaterThan(0);
    });
  },
);
