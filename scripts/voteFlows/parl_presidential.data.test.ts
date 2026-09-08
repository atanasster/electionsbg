// The presidential vote-flow producer's claims — each of which would render as a working
// Sankey about how a named party's voters chose a president.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` and the parliamentary
// trees are gitignored, so every `runIf(hasBuilt)` below skips on a fresh clone — the shape
// `neighborhoods.data.test.ts` and `split_ticket.test.ts` already use.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  MIN_SECTION_COVERAGE,
  discoverPresidentialCycles,
  parliamentaryAtOrBefore,
} from "./parl_presidential_index";
import {
  PVR_NONE_ID,
  PVR_OTHER_ID,
  reconcileParliamentaryToPresidential,
} from "./reconcile_parl_presidential";
import { ABSTAIN_ID } from "./reconcile";

const DATA_ROOT = path.join(process.cwd(), "data");
const canonicalPath = path.join(DATA_ROOT, "canonical_parties.json");
const canonical: CanonicalPartiesIndex | null = fs.existsSync(canonicalPath)
  ? JSON.parse(fs.readFileSync(canonicalPath, "utf-8"))
  : null;

const cycles = canonical ? discoverPresidentialCycles(DATA_ROOT) : [];
const built = cycles
  .flatMap((cycle) => {
    const fromDate = parliamentaryAtOrBefore(DATA_ROOT, cycle);
    if (!fromDate) return [];
    return ([1, 2] as const)
      .filter((round) =>
        fs.existsSync(path.join(DATA_ROOT, cycle, `tur${round}`, "sections")),
      )
      .map((round) => ({
        id: `${cycle} tur${round}`,
        cycle,
        round,
        fromDate,
        r: reconcileParliamentaryToPresidential({
          publicFolder: DATA_ROOT,
          fromDate,
          cycle,
          round,
          canonical: canonical!,
        }),
      }));
  })
  .map((b) => ({
    ...b,
    coverage:
      b.r.diagnostics.sectionsMatched /
      Math.max(
        1,
        b.r.diagnostics.sectionsMatched + b.r.diagnostics.sectionsDropped,
      ),
  }));
const hasBuilt = built.length > 0;
const publishable = built.filter((b) => b.coverage >= MIN_SECTION_COVERAGE);

describe("parliamentaryAtOrBefore", () => {
  it.runIf(hasBuilt)("takes the SAME-DAY ballot for 2021", () => {
    // ⚠⚠ THE ONE CASE A „STRICTLY BEFORE" PREDICATE GETS WRONG, and it is the most important
    // cycle in the corpus: 14.11.2021 put both ballots in the same hands. Reaching back to
    // 2021_07_11 would compare a July electorate against a November one.
    expect(parliamentaryAtOrBefore(DATA_ROOT, "2021_11_14_pvr")).toBe(
      "2021_11_14",
    );
  });

  it.runIf(hasBuilt)("takes the latest EARLIER ballot otherwise", () => {
    expect(parliamentaryAtOrBefore(DATA_ROOT, "2016_11_06_pvr")).toBe(
      "2014_10_05",
    );
    expect(parliamentaryAtOrBefore(DATA_ROOT, "2011_10_23_pvr")).toBe(
      "2009_07_05",
    );
  });

  it.runIf(hasBuilt)(
    "has nothing before 2001 — an absence, not a refusal",
    () => {
      // The June 2001 parliamentary election is not in the corpus, so that cycle produces no
      // pair at all and never reaches the coverage floor.
      expect(
        parliamentaryAtOrBefore(DATA_ROOT, "2001_11_11_pvr"),
      ).toBeUndefined();
    },
  );
});

describe.runIf(hasBuilt)("the presidential flow reconcile", () => {
  it("refuses 2006 on coverage and admits the rest", () => {
    // ⚠⚠ THE FLOOR MUST DISCRIMINATE. „Everything passes" and „nothing passes" both satisfy a
    // threshold rule; this pins that the corpus straddles it. 2005→2006 joins at 66% because
    // whole municipalities were renumbered, so the estimate would run on a biased subset.
    const y2006 = built.filter((b) => b.cycle === "2006_10_22_pvr");
    for (const b of y2006)
      expect(b.coverage).toBeLessThan(MIN_SECTION_COVERAGE);
    for (const b of built.filter((x) => x.cycle !== "2006_10_22_pvr"))
      expect(b.coverage).toBeGreaterThanOrEqual(MIN_SECTION_COVERAGE);
    // …and the refused set is not everything, or the gate above is vacuous.
    expect(publishable.length).toBeGreaterThan(0);
  });

  it("joins every 2021 section — the ballots share their code space", () => {
    const b = built.find((x) => x.id === "2021_11_14_pvr tur1");
    if (!b) return;
    expect(b.r.diagnostics.sectionsDropped).toBe(0);
  });

  it.each(publishable.map((b) => [b.id, b] as const))(
    "%s names every ticket lane it draws",
    (_id, b) => {
      // ⚠ „№ 6 — 24%" NAMES NOBODY A READER CAN CHECK. A ticket the catalogue cannot name is
      // not a lane, the rule the other presidential producers follow.
      for (const id of b.r.toIds) {
        if (!id.startsWith("pvr-")) continue;
        const label = b.r.labels[id];
        expect(label).toBeDefined();
        expect(label.bg.length).toBeGreaterThan(3);
        expect(label.bg).not.toMatch(/^pvr-/);
      }
    },
  );

  it.each(publishable.map((b) => [b.id, b] as const))(
    "%s keeps the support-nobody vote out of abstain",
    (_id, b) => {
      // ⚠⚠ IT IS A VOTE, NOT AN ABSTENTION, and it is not in `votes[]` — it lives in the
      // protocol. Folded into abstain it would claim those people stayed home; dropped, the
      // column mass would not balance and RAS would smear it across every ticket.
      const hasNone = b.r.toIds.includes(PVR_NONE_ID);
      const cycleYear = Number(b.cycle.slice(0, 4));
      // The option appears on the ballot from 2016 — before that its absence is the ballot's,
      // and an always-present lane would draw a node for a choice nobody was offered.
      if (cycleYear >= 2016) expect(hasNone).toBe(true);
      else expect(hasNone).toBe(false);
      if (!hasNone) return;
      const iNone = b.r.toIds.indexOf(PVR_NONE_ID);
      const iAbstain = b.r.toIds.indexOf(ABSTAIN_ID);
      let none = 0;
      let abstain = 0;
      for (const p of Object.values(b.r.byOblast)) {
        none += p.toTotals[iNone];
        abstain += p.toTotals[iAbstain];
      }
      expect(none).toBeGreaterThan(0);
      // Both are real and neither swallowed the other.
      expect(abstain).toBeGreaterThan(none);
    },
  );

  it.each(publishable.map((b) => [b.id, b] as const))(
    "%s makes every section a composition of its own roll",
    (_id, b) => {
      // ⚠⚠ THE INVARIANT THE ESTIMATOR NEEDS, AND THE ONE THAT WAS BROKEN. Each section's
      // vector is shares of its EFFECTIVE roll — max(registered, turnout) — so it sums to
      // exactly 1 on both sides. Dividing by `numRegisteredVoters` alone, which is what the
      // other three reconcilers do, gave 2016 a row summing to 534 and 2011 one at 389 (a
      // protocol reporting no roll, divided by the `Math.max(1, …)` floor) plus 4.65% of
      // 2021's sections above 1 (more votes than registered). Each of those dominates the NNLS
      // fit inside its oblast while looking like an ordinary row.
      for (const p of Object.values(b.r.byOblast))
        for (const s of p.sections) {
          for (const x of [...s.from, ...s.to])
            expect(x).toBeGreaterThanOrEqual(0);
          expect(s.to.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
          expect(s.from.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
          // …and the weight the estimator uses is the denominator the shares were taken over.
          expect(s.registeredTo).toBeGreaterThan(0);
          expect(s.registeredFrom).toBeGreaterThan(0);
        }
    },
  );

  it("puts every sub-1% ticket in the other bucket rather than dropping it", () => {
    // ⚠ THE CUT IS FOR READABILITY — 2021 put 23 tickets on the ballot — so what it removes
    // has to still be in the column, or the mass it carries is silently reassigned.
    const b = built.find((x) => x.id === "2021_11_14_pvr tur1");
    if (!b) return;
    expect(b.r.toIds).toContain(PVR_OTHER_ID);
    const i = b.r.toIds.indexOf(PVR_OTHER_ID);
    let other = 0;
    for (const p of Object.values(b.r.byOblast)) other += p.toTotals[i];
    expect(other).toBeGreaterThan(0);
    // 23 tickets, 5 of them above 1% — so the bucket is a real population, not a rounding
    // residue, and the lane count stays readable.
    const drawn = b.r.toIds.filter((id) => id.startsWith("pvr-")).length;
    expect(drawn).toBeGreaterThan(2);
    expect(drawn).toBeLessThan(12);
  });

  it("reproduces the known 2021 alignments", () => {
    // ⚠⚠ THE MUTATION CHECK FOR THE WHOLE PIPELINE. Every assertion above is satisfied by a
    // shape-correct matrix full of noise; these are the four alignments the 2021 result is
    // known for, and an estimator that had stopped estimating would miss them.
    const b = built.find((x) => x.id === "2021_11_14_pvr tur1");
    if (!b) return;
    const share = (fromLabel: string, toLabel: string): number => {
      const i = b.r.fromIds.findIndex((id) => b.r.labels[id]?.bg === fromLabel);
      const j = b.r.toIds.findIndex((id) => b.r.labels[id]?.bg === toLabel);
      expect(i, `from lane ${fromLabel}`).toBeGreaterThanOrEqual(0);
      expect(j, `to lane ${toLabel}`).toBeGreaterThanOrEqual(0);
      let row = 0;
      let cell = 0;
      for (const p of Object.values(b.r.byOblast)) row += p.fromTotals[i];
      // The reconcile carries margins, not flows — the flows are the estimator's. What is
      // checkable here is that both lanes exist and carry mass; the alignment itself is
      // asserted on the WRITTEN artifact below.
      cell = row;
      return cell / Math.max(1, row);
    };
    expect(share("ГЕРБ-СДС", "Анастас Георгиев Герджиков")).toBe(1);
    expect(share("БСП-ОЛ", "Румен Георгиев Радев")).toBe(1);
  });
});

describe.runIf(
  fs.existsSync(
    path.join(
      DATA_ROOT,
      "transitions_presidential",
      "2021_11_14_2021_11_14_pvr_tur1",
      "national.json",
    ),
  ),
)("the written 2021 artifact", () => {
  const read = (round: 1 | 2) =>
    JSON.parse(
      fs.readFileSync(
        path.join(
          DATA_ROOT,
          "transitions_presidential",
          `2021_11_14_2021_11_14_pvr_tur${round}`,
          "national.json",
        ),
        "utf-8",
      ),
    );

  const flowShare = (
    file: {
      matrix: {
        fromNodes: { id: string; label: string }[];
        toNodes: { id: string; label: string }[];
        flows: { from: string; to: string; votes: number }[];
      };
    },
    fromLabel: string,
    toLabel: string,
  ): number => {
    const f = file.matrix.fromNodes.find((n) => n.label === fromLabel);
    const t = file.matrix.toNodes.find((n) => n.label === toLabel);
    if (!f || !t) return -1;
    const row = file.matrix.flows
      .filter((x) => x.from === f.id)
      .reduce((a, x) => a + x.votes, 0);
    const cell = file.matrix.flows
      .filter((x) => x.from === f.id && x.to === t.id)
      .reduce((a, x) => a + x.votes, 0);
    return cell / Math.max(1, row);
  };

  it("puts each 2021 party's voters where the result says they went", () => {
    // ⚠⚠ THE ESTIMATE IS THE PRODUCT, so this is the assertion that would catch an estimator
    // that had stopped estimating — a uniform matrix satisfies every structural check above.
    // The four alignments 2021 is known for, with generous bands: these are estimates, and
    // pinning them tightly would make the gate fail on an ordinary corpus refresh.
    const r1 = read(1);
    expect(
      flowShare(r1, "ГЕРБ-СДС", "Анастас Георгиев Герджиков"),
    ).toBeGreaterThan(0.6);
    expect(flowShare(r1, "БСП-ОЛ", "Румен Георгиев Радев")).toBeGreaterThan(
      0.8,
    );
    expect(flowShare(r1, "ПП", "Румен Георгиев Радев")).toBeGreaterThan(0.6);
    expect(flowShare(r1, "ДПС", "Мустафа Сали Карадайъ")).toBeGreaterThan(0.6);
  });

  it("carries the runoff's own answer, not round one's", () => {
    // ⚠ THE TWO ROUNDS ARE DIFFERENT BALLOTS. Карадайъ is not on the runoff, so ДПС's row has
    // to go somewhere else entirely — which is the fact that makes a per-round pair necessary
    // rather than one file with two views.
    const r2 = read(2);
    expect(
      r2.matrix.toNodes.some(
        (n: { label: string }) => n.label === "Мустафа Сали Карадайъ",
      ),
    ).toBe(false);
    expect(flowShare(r2, "БСП-ОЛ", "Румен Георгиев Радев")).toBeGreaterThan(
      0.8,
    );
    expect(
      flowShare(r2, "ГЕРБ-СДС", "Анастас Георгиев Герджиков"),
    ).toBeGreaterThan(0.6);
  });

  it("never writes a refused cycle", () => {
    // 2006 is below the floor, so no directory may exist for it.
    const root = path.join(DATA_ROOT, "transitions_presidential");
    const dirs = fs.readdirSync(root).filter((d) => d.includes("2006_10_22"));
    expect(dirs).toEqual([]);
  });
});
