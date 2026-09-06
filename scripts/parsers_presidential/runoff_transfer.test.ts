// The runoff transfer file's three separable claims, each of which would render as a working
// Sankey and a working map.
//
// ⚠ THE MUTATION CHECK IS THE POINT OF THIS FILE. „The margins match the published totals" is
// satisfied by the IDENTITY matrix — everyone stayed, nobody moved, turnout fell out of thin
// air — and that matrix is exactly what a broken NNLS produces. So the corpus arm asserts the
// estimate DISCRIMINATES: a measurable share of the winner's runoff votes must come from
// somebody else's round-1 column, or the chart is drawing a tautology.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` is gitignored, so every
// `runIf(hasCorpus)` below skips on a fresh clone — the shape `national_summary_shape.test.ts`
// records. The rules that can be pinned without the corpus are therefore pinned without it.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ABSTAIN_ID,
  INVALID_ID,
  NONE_ID,
  TRANSFER_FILE,
  buildRunoffTransfer,
  presidentialCyclesFor,
  sectionCounts,
  sectionPool,
  edgesOf,
  marginGap,
  nodesOf,
  ticketNodeId,
  vectorFor,
  writeRunoffTransfer,
} from "./build_runoff_transfer";
// ⚠ THE BROWSER'S OWN DECLARATION OF THIS FILE. A test in `scripts/` is the one place that may
// import both sides — `national_summary_shape.test.ts`'s argument, one artifact over.
import {
  runoffTransferPath,
  type RunoffTransfer as ServedTransfer,
} from "../../src/data/presidential/useRunoffTransfer";
import type { RunoffTransfer as ProducedTransfer } from "./build_runoff_transfer";

/** ⚠ THE STATIC HALF, AND IT IS AN ASSIGNMENT RATHER THAN AN ASSERTION. A producer change the
 *  browser type cannot describe — a field narrowed, a key removed — is a compile error on this
 *  line, i.e. `tsc -b` and therefore CI, not a runtime skip on a machine without the corpus. */
const _assignable: (t: ProducedTransfer) => ServedTransfer = (t) => t;
void _assignable;

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesFor(DATA_ROOT);
const hasCorpus = cycles.length > 0;

/** Every committed cycle that HAS a runoff, built once. ⚠ MODULE SCOPE, because two describe
 *  blocks need it and both are `runIf(hasCorpus)` — on a fresh clone `cycles` is empty, so
 *  this is an empty array and costs nothing. */
const built = cycles
  .map((cycle) => ({
    cycle,
    transfer: buildRunoffTransfer(cycle, DATA_ROOT),
  }))
  .filter(
    (r): r is { cycle: string; transfer: NonNullable<typeof r.transfer> } =>
      r.transfer !== null,
  );

const section = (
  votes: Record<number, number>,
  protocol: Record<string, number>,
) => ({
  code: "000000001",
  protocol,
  votes: Object.entries(votes).map(([partyNum, totalVotes]) => ({
    partyNum: Number(partyNum),
    totalVotes,
  })),
});

describe("section counts", () => {
  it("reads „не подкрепям никого“ as ABSENT, not zero, when the ballot had no such line", () => {
    // ⚠ THE WHOLE ERA DISTINCTION RIDES ON THIS. The option reached the ballot in 2016; a 0
    // here would put 2001's real abstainers into a category nobody was offered, and the
    // Sankey would draw a lane saying so.
    const pre2016 = sectionCounts(
      section({ 1: 100, 2: 80 }, { numRegisteredVoters: 300 }),
      [1, 2],
    );
    expect(pre2016.none).toBeNull();
    const y2021 = sectionCounts(
      section(
        { 6: 100 },
        { numRegisteredVoters: 300, numValidNoOnePaperVotes: 0 },
      ),
      [6],
    );
    // Present and zero is a different fact from absent, and must survive as one.
    expect(y2021.none).toBe(0);
  });

  it("counts a ticket that took no votes here, rather than dropping it", () => {
    const c = sectionCounts(
      section({ 1: 10 }, { numRegisteredVoters: 50 }),
      [1, 2, 3],
    );
    expect(c.ticket).toEqual([10, 0, 0]);
  });

  it("folds voters added on the day into the roll", () => {
    const c = sectionCounts(
      section({ 1: 10 }, { numRegisteredVoters: 50, numAdditionalVoters: 7 }),
      [1],
    );
    expect(c.registered).toBe(57);
  });
});

describe("the pooled electorate", () => {
  it("gives both rounds ONE denominator, so the two margins carry the same mass", () => {
    // ⚠ THE DEFECT THIS EXISTS FOR: the two published rolls disagree — measured, +6.4% in
    // Софийска област in 2006 — and fed to RAS as two different totals that is a matrix whose
    // rows and columns cannot both be satisfied.
    const a = sectionCounts(section({ 1: 60, 2: 40 }, { numRegisteredVoters: 200 }), [1, 2]); // prettier-ignore
    const b = sectionCounts(
      section({ 1: 90 }, { numRegisteredVoters: 212 }),
      [1],
    );
    const pool = sectionPool(a, b);
    const from = vectorFor(a, pool);
    const to = vectorFor(b, pool);
    const sum = (v: number[]) => v.reduce((x, y) => x + y, 0);
    expect(sum(from)).toBe(sum(to));
    expect(pool).toBe(212);
  });

  it("is big enough to hold whichever round counted more, even past its own roll", () => {
    // A section can report more ballots than registered voters — that is what
    // `numAdditionalVoters` is for, and a pool below it would make „did not vote" negative.
    const a = sectionCounts(
      section({ 1: 300 }, { numRegisteredVoters: 100 }),
      [1],
    );
    const b = sectionCounts(
      section({ 1: 50 }, { numRegisteredVoters: 100 }),
      [1],
    );
    expect(sectionPool(a, b)).toBe(300);
    expect(vectorFor(a, sectionPool(a, b)).at(-1)).toBe(0);
  });
});

describe("node ids", () => {
  it("marks every synthetic lane with the `__` prefix the renderer reads", () => {
    // `VoteFlowSankey` and `voteFlows/aggregate.ts` both derive „is this a real contestant"
    // from that prefix, so a lane named otherwise is drawn as somebody who stood for office.
    for (const id of [NONE_ID, INVALID_ID, ABSTAIN_ID])
      expect(id.startsWith("__")).toBe(true);
    expect(ticketNodeId(6).startsWith("__")).toBe(false);
  });
});

const flowNode = (id: string, votes: number) => ({
  id,
  label: id,
  labelEn: id,
  color: "#000",
  votes,
});

describe("the edge floor", () => {
  it("is ABSOLUTE, so a small lane keeps its ribbons", () => {
    // ⚠ THE PARLIAMENTARY GENERATOR'S 0.005%-OF-MASS FLOOR DOES NOT TRANSFER, and this is the
    // measurement that says so: with a 6.7M electorate the floor would be 335 votes, which
    // deletes a „недействителни" lane of 2,776 almost entirely while the node still prints its
    // published total. What makes an edge noise is its own size, not the electorate's.
    const flows = [
      [6_700_000 - 300, 300],
      [19, 0],
    ];
    const { edges, droppedVotes } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      flows,
      new Set(["t1", "t2"]),
    );
    expect(edges.map((e) => e.votes)).toEqual([6_699_700, 300]);
    // The 19-vote cell is the only thing dropped — under a mass-relative floor the 300 would
    // go too, which is the whole finding.
    expect(droppedVotes).toBe(19);
  });
});

describe("nodesOf", () => {
  const tickets = [
    { number: 1, president: "А", rounds: [1, 2] },
    { number: 2, president: "Б", rounds: [1] },
  ];

  it("drops a ticket with no votes on this axis — it ran in only one round", () => {
    // ⚠ ON THE RUNOFF AXIS EVERY ELIMINATED PAIR IS EXACTLY THAT. Drawn at 0 they are bare
    // labels implying 21 more people stood in 2021's second round.
    const nodes = nodesOf([1, 2], tickets, [100, 0, 0, 0, 50], true);
    expect(nodes.map((n) => n.id)).toEqual([
      "t1",
      NONE_ID,
      INVALID_ID,
      ABSTAIN_ID,
    ]);
  });

  it("keeps a pseudo lane at zero — „nobody spoiled a ballot“ is a result", () => {
    const nodes = nodesOf([1], tickets, [100, 0, 0, 50], true);
    expect(nodes.some((n) => n.id === INVALID_ID)).toBe(true);
  });

  it("drops the „никого“ lane when the ballot did not carry it", () => {
    const nodes = nodesOf([1], tickets, [100, 0, 0, 50], false);
    expect(nodes.some((n) => n.id === NONE_ID)).toBe(false);
    expect(nodes.some((n) => n.id === ABSTAIN_ID)).toBe(true);
  });
});

describe("marginGap", () => {
  it("is UNSIGNED — an overshoot counts as much as a shortfall", () => {
    // ⚠ THE COPY DEPENDS ON THIS. 2006's largest gap is an OVERSHOOT on the winner's own node,
    // so a sentence saying the ribbons „fall short of" the labels is false there. Both locales
    // say „differ by" for that reason.
    const from = [flowNode("a", 100)];
    const over = marginGap(
      from,
      [flowNode("b", 100)],
      [{ from: "a", to: "b", votes: 120 }],
    );
    const under = marginGap(
      from,
      [flowNode("b", 100)],
      [{ from: "a", to: "b", votes: 80 }],
    );
    expect(over).toBeCloseTo(0.2, 6);
    expect(under).toBeCloseTo(0.2, 6);
  });

  it("ignores a node with no votes rather than dividing by zero", () => {
    expect(marginGap([flowNode("a", 0)], [flowNode("b", 0)], [])).toBe(0);
  });
});

describe("one file, named from both sides", () => {
  it("agrees on the filename the producer writes and the browser fetches", () => {
    // ⚠ TWO PINS THAT NEVER MEET OTHERWISE. A rename on one side passes both suites and 404s
    // in production — where `fetchRunoffTransfer` reads a 404 as `absent`, the EXPECTED state,
    // so nothing is logged either and the section simply stops appearing.
    expect(runoffTransferPath("2021_11_14_pvr")).toBe(
      path.join("2021_11_14_pvr", TRANSFER_FILE),
    );
  });
});

describe("writeRunoffTransfer", () => {
  const fixture = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-"));
    fs.mkdirSync(path.join(root, "2099_01_01_pvr"), { recursive: true });
    return root;
  };

  it("writes NOTHING and returns null for a cycle with no runoff", () => {
    // ⚠ THE CASE `scripts/main.ts` DEPENDS ON — `if (written) r.files.push(written)`. A build
    // that returned a path here would put a file the ingest never wrote into its own manifest.
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "2099_01_01_pvr", "tickets.json"),
      JSON.stringify({ tickets: [{ number: 1, president: "А", rounds: [1] }] }),
    );
    expect(writeRunoffTransfer("2099_01_01_pvr", { root })).toBeNull();
    expect(fs.readdirSync(path.join(root, "2099_01_01_pvr"))).toEqual([
      "tickets.json",
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.runIf(hasCorpus)(
    "returns a ROOT-relative path and honours the indent the pipeline passes",
    () => {
      // ⚠ THE SHAPE `ingestPresidentialCycle` PUTS IN ITS `files` LIST is cycle-relative; an
      // absolute path there would read as a second, different file. And `--prod` passes
      // indent 0 — measured, the presidential tree is 134 MB minified, so this is not cosmetic.
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-"));
      const cycle = built[0].cycle;
      fs.cpSync(path.join(DATA_ROOT, cycle), path.join(root, cycle), {
        recursive: true,
      });
      const rel = writeRunoffTransfer(cycle, { root, indent: 0 });
      expect(rel).toBe(path.join(cycle, TRANSFER_FILE));
      const text = fs.readFileSync(path.join(root, rel as string), "utf8");
      expect(text.includes("\n  ")).toBe(false);
      expect(JSON.parse(text).cycle).toBe(cycle);
      fs.rmSync(root, { recursive: true, force: true });
    },
  );
});

describe.runIf(hasCorpus)("the committed corpus", () => {
  it("has a runoff to estimate at all", () => {
    // All five cycles went to a second round; a build that suddenly found none would mean the
    // `rounds` field on `tickets.json` had stopped being written, not that history changed.
    expect(built.length).toBeGreaterThan(0);
  });

  it.each(built)(
    "$cycle: the file on disk is the file the builder makes",
    ({ cycle, transfer }) => {
      // ⚠ PARSED, NOT BYTES. `--prod` writes the tree minified and a dev run indents it, so a
      // byte comparison would fail on the indent rather than on the content.
      const file = path.join(DATA_ROOT, cycle, TRANSFER_FILE);
      expect(fs.existsSync(file)).toBe(true);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(transfer);
    },
  );

  it.each(built)(
    "$cycle: names the winner the summary names, first",
    ({ cycle, transfer }) => {
      // ⚠ AN INDEPENDENT SOURCE. `national_summary.json` resolves the winner through
      // `winnerRule.ts` (art. 93), this file through the round-2 marginals. Agreement is
      // evidence; deriving both from the same sort would be none.
      const summary = JSON.parse(
        fs.readFileSync(
          path.join(DATA_ROOT, cycle, "national_summary.json"),
          "utf8",
        ),
      ) as { winner: { president: string } };
      expect(transfer.finalists[0].president).toBe(summary.winner.president);
      expect(transfer.finalists[0].votes).toBeGreaterThan(
        transfer.finalists[1].votes,
      );
    },
  );

  it.each(built)(
    "$cycle: draws no edge to a node it does not carry",
    ({ transfer }) => {
      const ids = new Set([
        ...transfer.national.matrix.fromNodes.map((n) => n.id),
        ...transfer.national.matrix.toNodes.map((n) => n.id),
      ]);
      for (const e of transfer.national.matrix.flows) {
        expect(ids.has(e.from)).toBe(true);
        expect(ids.has(e.to)).toBe(true);
      }
    },
  );

  it.each(built)(
    "$cycle: draws the „никого“ lane only where the ballot carried it",
    ({ transfer }) => {
      // ⚠ ABSENT IS NOT ZERO. Pseudo lanes survive at 0 — „nobody spoiled a ballot" is a result
      // — except the one the ballot did not have, which drawn at 0 says nobody chose an option
      // nobody was offered.
      const asked = transfer.oblasts.some(
        (o) => o.n1 !== null || o.n2 !== null,
      );
      const drawn = transfer.national.matrix.fromNodes.some(
        (n) => n.id === NONE_ID,
      );
      expect(drawn).toBe(asked);
    },
  );

  it.each(built)(
    "$cycle: the estimate DISCRIMINATES — it is not „everyone stayed“",
    ({ transfer }) => {
      // ⚠ THE MUTATION CHECK. An identity matrix satisfies every margin assertion above and is
      // what a collapsed NNLS returns. A Bulgarian runoff eliminates every pair but two, so a
      // large share of the winner's second-round votes MUST arrive from another column; if it
      // does not, the chart is drawing its own inputs back at the reader.
      const winner = ticketNodeId(transfer.finalists[0].number);
      const into = transfer.national.matrix.flows.filter(
        (e) => e.to === winner,
      );
      const total = into.reduce((s, e) => s + e.votes, 0);
      const fromElsewhere = into
        .filter((e) => e.from !== winner)
        .reduce((s, e) => s + e.votes, 0);
      expect(total).toBeGreaterThan(0);
      expect(fromElsewhere / total).toBeGreaterThan(0.05);
    },
  );

  it.each(built)(
    "$cycle: says how far its ribbons fall short of its own totals",
    ({ transfer }) => {
      // The gap is real and cannot be zero: RAS converges geometrically and a nearly degenerate
      // oblast does not get there in 500 iterations. What must hold is that it is SMALL and
      // REPORTED — a surface printing a node's published total beside ribbons that do not add up
      // to it owes the reader this number.
      expect(transfer.national.marginGap).toBeGreaterThan(0);
      expect(transfer.national.marginGap).toBeLessThan(0.08);
      expect(transfer.national.droppedVotes).toBeLessThan(
        transfer.finalists[0].votes * 0.001,
      );
    },
  );

  it.each(built)(
    "$cycle: every section on disk is matched, refused or named",
    ({ cycle, transfer }) => {
      // ⚠ THE ONE ASSERTION THAT LOOKS OUTSIDE THE FILE. Every other count here is an internal
      // identity and holds however much the builder dropped — which is how 2011's 1,355
      // placement-refused Sofia sections (422,726 runoff votes, 13.3% of the domestic vote)
      // stayed out of `coverage` with everything reconciling.
      //
      // ⚠ THE RUNOFF ROUND, and the arithmetic only closes against that one. `unplacedSections`
      // is read from `tur2`'s refused shard — the votes the file's headline figures do not
      // contain — and 2011's two rounds refuse a DIFFERENT number of sections (1,354 in round 1,
      // 1,355 in the runoff). Pairing tur1's tree with a tur2 counter is off by one, which is
      // exactly the kind of near-miss a reconciliation test exists to refuse.
      const dir = path.join(DATA_ROOT, cycle, "tur2", "sections");
      const onDisk = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .reduce(
          (n, f) =>
            n +
            (
              JSON.parse(
                fs.readFileSync(path.join(dir, f), "utf8"),
              ) as unknown[]
            ).length,
          0,
        );
      expect(
        transfer.coverage.domesticSections +
          transfer.residue.round2Only.length +
          transfer.coverage.unplacedSections,
      ).toBe(onDisk);
    },
  );

  it("counts the placement-refused shard where the corpus has one", () => {
    // ⚠ THE MUTATION ARM. Four of the five cycles refuse nothing, so a field that silently
    // stopped being counted would pass at 0 everywhere and this whole declaration would go
    // back to being a comment.
    expect(built.some((b) => b.transfer.coverage.unplacedSections > 0)).toBe(
      true,
    );
    const refused = built.filter(
      (b) => b.transfer.coverage.unplacedSections > 0,
    );
    for (const b of refused)
      expect(b.transfer.coverage.unplacedVotes).toBeGreaterThan(0);
  });

  it.each(built)(
    "$cycle: covers all 31 oblasts and accounts for every section it read",
    ({ transfer }) => {
      expect(transfer.oblasts).toHaveLength(31);
      const c = transfer.coverage;
      expect(c.sectionsWithEkatte + c.sectionsWithoutEkatte).toBe(
        c.domesticSections,
      );
      expect(transfer.national.sections).toBe(c.domesticSections);
      for (const o of transfer.oblasts) {
        expect(Number.isFinite(o.rasResidual)).toBe(true);
        expect(o.rasResidual).toBeGreaterThanOrEqual(0);
        // The observed half is arithmetic: the winner cannot outpoll the pairs' own total.
        expect(o.w1).toBeLessThanOrEqual(o.v1);
        expect(o.w2).toBeLessThanOrEqual(o.v2);
        expect(o.elim).toBeLessThanOrEqual(o.v1);
      }
    },
  );

  it.each(built)(
    "$cycle: keeps BOTH published rolls, because they disagree",
    ({ transfer }) => {
      // ⚠ NOT A STYLE CHOICE. If `reg1 === reg2` everywhere, the whole pooled-electorate
      // argument above is a fiction and one column would do. It is not: rolls are corrected
      // between the rounds and voters are added at the section on the day.
      expect(transfer.oblasts.some((o) => o.reg1 !== o.reg2)).toBe(true);
    },
  );

  it.each(built)("$cycle: states what it does not cover", ({ transfer }) => {
    // Abroad is outside the matrix entirely, and the settlement join under-covers by design —
    // both are refusals, and a refusal nobody can see is indistinguishable from a defect.
    expect(transfer.coverage.abroadVotes).toBeGreaterThan(0);
    expect(transfer.coverage.settlementsJoined).toBeGreaterThan(1000);
    expect(transfer.coverage.votesWithoutEkatte).toBeGreaterThan(0);
    for (const s of [transfer.basis, transfer.basisEn, transfer.coverage.basis, transfer.coverage.basisEn]) // prettier-ignore
      expect(s.length).toBeGreaterThan(80);
  });
});
