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
import {
  MAX_BALLOT_PREVIEW,
  type ElectionRankedEntry,
  type ElectionSurfaceBallot,
} from "../../../src/data/elections/surfaceTypes";
import { reportSkip } from "../../lib/report_skip";
import { stripComments } from "../../lib/strip_comments";

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

      // ⚠ READ THE ELEMENT, NOT THE FILE — every one of these numbers is explained by a
      // comment that quotes it, so a file-wide `toContain` passes on a deleted prop.
      expect(byLevel.get("local/region")).toBe(1);
      expect(
        skeletonFor("src/screens/LocalRegionDashboardScreen.tsx", "region"),
        "local/region reserves a fact it does not render",
      ).toContain("facts={1}");

      expect(byLevel.get("local/country")).toBe(2);
      expect(
        skeletonFor(LOCAL_SCREEN, "country"),
        "local/country reserves a fact it does not render",
      ).toContain("facts={2}");
    });

    // ─── and the other two skeleton levers, against the same corpus ──────────────────────────

    /** The reservation that minimises the expected layout shift for one canvas: the `k` for
     *  which the mean |published rows − k| is smallest.
     *
     *  ⚠ NOT THE MAXIMUM, and that is the whole point of measuring it. „Reserve the tallest so
     *  nothing shifts downward" is right only where the tallest is also the common case — true
     *  of a municipal council ballot (8 rows on 578 of 578) and false of a mayor race (median
     *  2). Reserving 8 at `local/settlement` does not avoid a shift, it guarantees one on
     *  99.8% of pages; it is simply upward instead of downward, which CLS counts identically. */
    const bestRows = (ns: number[]): number => {
      let best = 1;
      let bestCost = Infinity;
      for (let k = 1; k <= MAX_BALLOT_PREVIEW; k++) {
        const cost = ns.reduce((a, n) => a + Math.abs(n - k), 0) / ns.length;
        if (cost < bestCost) {
          bestCost = cost;
          best = k;
        }
      }
      return best;
    };

    const at = (key: string): B.Emitted[] =>
      ALL.filter((e) => `${e.surface.kind}/${e.surface.place.level}` === key);

    /** The `<ElectionSurfaceSkeleton …/>` a given boundary passes, keyed by the LEVEL that
     *  boundary declares — never by file, and never by "the first one".
     *
     *  ⚠ SCANNING THE WHOLE FILE IS VACUOUS HERE AND WAS, FOR ONE COMMIT. Every one of these
     *  reservations carries a comment explaining the measurement behind it, and those comments
     *  quote the prop — so `expect(src).toContain("rows={2}")` passed with the prop DELETED,
     *  satisfied by the paragraph that justifies it. Same family as the superseded-mayor gate
     *  that matched its own prose.
     *
     *  ⚠ AND "THE FIRST SKELETON IN THE FILE" IS NOT A KEY EITHER: `LocalElectionScreen.tsx`
     *  holds the município boundary and the country one, so a file-keyed reader silently
     *  asserts one level's numbers against the other's. Splitting on the boundary element is
     *  what ties each reservation to the level it reserves for — and it drops the JSX banner
     *  above each boundary into the PREVIOUS chunk. `stripComments` cannot remove that banner:
     *  it strips comments that own their line, and a JSX comment opens with a brace. */
    const skeletonFor = (file: string, level: string): string => {
      const src = stripComments(
        fs.readFileSync(path.join(process.cwd(), file), "utf8"),
      );
      const chunks = src
        .split("<ElectionSurfaceBoundary")
        .slice(1)
        // ⚠ CUT AT THE CLOSE TAG. Without it a chunk runs to the NEXT boundary and swallows
        // that one's JSX banner — which names its level in prose — so both chunks matched both
        // levels and the reader had no key at all.
        .map((c) => {
          const stop = c.indexOf("</ElectionSurfaceBoundary>");
          return stop === -1 ? c : c.slice(0, stop);
        })
        .filter((c) => new RegExp(`level=\\{?"${level}"`).test(c));
      expect(chunks.length, `${file} boundaries at level="${level}"`).toBe(1);
      const chunk = chunks[0];
      const open = chunk.indexOf("<ElectionSurfaceSkeleton");
      expect(open, `no skeleton on the ${level} boundary`).toBeGreaterThan(-1);
      const close = chunk.indexOf("/>", open);
      expect(close, `unterminated skeleton on ${level}`).toBeGreaterThan(-1);
      return chunk.slice(open, close + 2).replace(/\s+/g, " ");
    };

    const SETTLEMENT_CALL =
      "src/screens/dashboard/local/LocalSettlementDashboardCards.tsx";
    const LOCAL_SCREEN = "src/screens/LocalElectionScreen.tsx";

    /** The cheapest reservation for each canvas POSITION, since `rows` is positional. */
    const bestRowsPerCanvas = (key: string): number[] => {
      const cols: number[][] = [];
      for (const e of at(key))
        e.surface.ballots.forEach((b, i) => {
          (cols[i] ??= []).push(b.preview.length);
        });
      return cols.map(bestRows);
    };

    it("reserves, per canvas, the row count that costs the corpus the least shift", () => {
      // ⚠ THE RULE IS CONDITIONAL, because the component already defaults to the producer's
      // preview cap. A level whose best value IS that cap needs no prop; a level whose best
      // value differs must say so, or it silently inherits a number measured for somebody else.
      const settlement = bestRowsPerCanvas("local/settlement");
      expect(settlement).toEqual([2]);
      expect(
        skeletonFor(SETTLEMENT_CALL, "settlement"),
        `local/settlement would default to ${MAX_BALLOT_PREVIEW} rows and the corpus wants ${settlement[0]}`,
      ).toContain(`rows={${settlement[0]}}`);

      const muni = bestRowsPerCanvas("local/municipality");
      expect(muni).toEqual([2, 8]);
      expect(
        skeletonFor(LOCAL_SCREEN, "municipality"),
        "local/municipality reserves one number for two differently-shaped ballots",
      ).toContain(`rows={[${muni.join(", ")}]}`);
    });

    it("pins the BALLOT ORDER the positional reservation depends on", () => {
      // ⚠ THIS IS THE ONE MISTAKE THE ARRAY FORM MAKES POSSIBLE. `rows={[8, 2]}` type-checks,
      // renders two tables, and is wrong on all 578 pages — nothing above can see it, because
      // the multiset of reservations is unchanged. So the order is asserted against the corpus
      // by KIND rather than being read off the same array the source declares.
      const orders = new Set(
        at("local/municipality").map((e) =>
          e.surface.ballots.map((b) => b.kind).join(">"),
        ),
      );
      expect([...orders]).toEqual(["municipality_mayor>municipal_council"]);
      expect(
        bestRows(
          at("local/municipality").map(
            (e) => e.surface.ballots[0].preview.length,
          ),
        ),
        "the mayor ballot is the short one and it comes first",
      ).toBe(2);
    });

    it("reserves one canvas per ballot the level publishes", () => {
      // `canvases` is the lever whose absence cost a whole ranked table of shift at
      // `local/municipality`; both call sites now declare it, and both claims are corpus facts.
      const ballotCount = (key: string) =>
        new Set(at(key).map((e) => e.surface.ballots.length));
      expect([...ballotCount("local/settlement")]).toEqual([1]);
      expect([...ballotCount("local/municipality")]).toEqual([2]);
      expect(skeletonFor(SETTLEMENT_CALL, "settlement")).toContain(
        "canvases={1}",
      );
      expect(skeletonFor(LOCAL_SCREEN, "municipality")).toContain(
        "canvases={2}",
      );
    });

    it("discriminates — `bestRows` is not just returning the cap or the mode", () => {
      // ⚠ WITHOUT THIS, "the corpus wants 2" passes on a `bestRows` that returns a constant.
      expect(bestRows([1, 1, 1, 1])).toBe(1);
      expect(bestRows([8, 8, 8, 8])).toBe(MAX_BALLOT_PREVIEW);
      expect(bestRows([2, 2, 2, 8])).toBe(2);
      // And it minimises SHIFT, not frequency: the mode of this sample is 1 while the cheapest
      // reservation is 5, so an implementation returning the most common value fails here.
      expect(bestRows([1, 1, 1, 5, 5, 8, 8])).toBe(5);
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
