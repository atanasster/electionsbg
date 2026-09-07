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
  oblastTransferFile,
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
import {
  oblastTransferPath,
  type OblastTransfer as ServedOblast,
} from "../../src/data/presidential/useOblastTransfer";
import type {
  RunoffTransfer as ProducedTransfer,
  OblastTransfer as ProducedOblast,
} from "./build_runoff_transfer";

/** ⚠ THE STATIC HALF, AND IT IS AN ASSIGNMENT RATHER THAN AN ASSERTION. A producer change the
 *  browser type cannot describe — a field narrowed, a key removed — is a compile error on this
 *  line, i.e. `tsc -b` and therefore CI, not a runtime skip on a machine without the corpus. */
const _assignable: (t: ProducedTransfer) => ServedTransfer = (t) => t;
void _assignable;
/** The same static pin for the SHARD, which is the half a region page reads on its own. */
const _shardAssignable: (o: ProducedOblast) => ServedOblast = (o) => o;
void _shardAssignable;

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesFor(DATA_ROOT);
const hasCorpus = cycles.length > 0;

/** Every committed cycle that HAS a runoff, built once. ⚠ MODULE SCOPE, because two describe
 *  blocks need it and both are `runIf(hasCorpus)` — on a fresh clone `cycles` is empty, so
 *  this is an empty array and costs nothing. */
const built = cycles
  .map((cycle) => ({ cycle, build: buildRunoffTransfer(cycle, DATA_ROOT) }))
  .filter(
    (r): r is { cycle: string; build: NonNullable<typeof r.build> } =>
      r.build !== null,
  )
  // ⚠ FLATTENED, so `transfer` still means the CYCLE file. One build now yields two artifacts
  // and `shards` is the second — the per-oblast matrices a region page fetches.
  .map(({ cycle, build }) => ({
    cycle,
    transfer: build.transfer,
    shards: build.oblasts,
  }));
/** ⚠ NOT `hasCorpus`. That is „any presidential folder"; `built` holds only cycles WITH a
 *  runoff, so an arm that dereferences `built[0]` under `hasCorpus` throws rather than skips
 *  on a corpus of round-1-decided cycles. Unreachable with today's five and exactly the shape
 *  this file's header says must skip cleanly. */
const hasRunoff = built.length > 0;

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
    // ⚠ t2 CARRIES A SECOND, LARGER CELL so this fixture keeps testing the FLOOR rather than
    // the orphan rescue below it: with `[19, 0]` the 19-vote cell is the whole of t2's row and
    // comes back as its only ribbon, which is a different rule being exercised.
    const flows = [
      [6_700_000 - 300, 300],
      [19, 500],
    ];
    const { edges, droppedVotes } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      flows,
      new Set(["t1", "t2"]),
      new Set(["t1", "t2"]),
    );
    expect(edges.map((e) => e.votes)).toEqual([6_699_700, 300, 500]);
    // The 19-vote cell is the only thing dropped — under a mass-relative floor the 300 would
    // go too, which is the whole finding.
    expect(droppedVotes).toBe(19);
  });

  it("never leaves a node drawn with no ribbon at all, however small the node", () => {
    // ⚠ AN ABSOLUTE FLOOR EVENTUALLY MEETS A NODE WHOSE WHOLE MASS IS UNDER IT, and cutting
    // the matrix per oblast is what makes that ordinary rather than theoretical: measured,
    // Sofia's S25 „недействителни" is **20 votes** in 2021 and every cell of its row falls
    // below 20. Drawn, that is a labelled bar with nothing attached — a chart printing a total
    // it accounts for none of, and `marginGap` 1.0. The node's LARGEST lost cell comes back,
    // because relative to the node it is most of it rather than noise.
    const flows = [
      [10_000, 5_000],
      [7, 4],
    ];
    const { edges, droppedVotes } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      flows,
      new Set(["t1", "t2"]),
      new Set(["t1", "t2"]),
    );
    // ⚠ THE WHOLE ARRAY, so the canonical `(from, to)` order is pinned too: a restored edge
    // appended at the end would make the committed artifact's diff depend on which nodes
    // happened to be orphaned.
    expect(edges).toEqual([
      { from: "t1", to: "t1", votes: 10_000 },
      { from: "t1", to: "t2", votes: 5_000 },
      { from: "t2", to: "t1", votes: 7 },
    ]);
    // The rescued cell leaves the dropped mass, so the two still account for the matrix.
    expect(droppedVotes).toBe(4);
  });

  it("still drops a hairline whose node is already drawn", () => {
    // ⚠ THE MUTATION CHECK for the rescue above: „no node is orphaned" is also satisfied by a
    // floor that stopped filtering, which would put every 1-vote cell back on the chart.
    const flows = [
      [10_000, 900],
      [12, 40],
    ];
    const { edges, droppedVotes } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      flows,
      new Set(["t1", "t2"]),
      new Set(["t1", "t2"]),
    );
    expect(edges.map((e) => e.votes)).toEqual([10_000, 900, 40]);
    expect(droppedVotes).toBe(12);
  });

  it("rescues a node whose every cell rounds to ZERO", () => {
    // ⚠ THE ROUNDED CELL IS NOT THE RANKING KEY. A node whose margin rounds to 1 while every
    // one of its cells rounds to 0 has no rounded candidate at all — so a rescue that ranked
    // on `Math.round(flow)` skipped it and left the exact orphan it exists to prevent, with
    // `marginGap` 1. The raw magnitude is what decides, and the restored ribbon is floored at
    // one vote, because a 0-vote ribbon is the same orphan wearing a different mask.
    const { edges } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      [
        [10_000, 5_000],
        [0.3, 0.3],
      ],
      new Set(["t1", "t2"]),
      new Set(["t1", "t2"]),
    );
    const rescued = edges.filter((e) => e.from === "t2");
    expect(rescued.length).toBe(1);
    expect(rescued[0].votes).toBeGreaterThanOrEqual(1);
  });

  it("draws no ribbon from a node the FROM axis does not carry", () => {
    // ⚠ ONE UNION SET CANNOT ANSWER TWO QUESTIONS. A finalist survives on the to-axis and is
    // dropped from the from-axis in an oblast where they polled nothing in round 1; asked
    // „is this id drawn anywhere", a union says yes and admits a ribbon LEAVING a node the
    // chart does not draw.
    const { edges, droppedVotes } = edgesOf(
      ["t1", "t2"],
      ["t1", "t2"],
      [
        [120, 0],
        [900, 40],
      ],
      new Set(["t2"]),
      new Set(["t1", "t2"]),
    );
    expect(edges.every((e) => e.from === "t2")).toBe(true);
    expect(droppedVotes).toBe(120);
  });

  it("rescues a pseudo lane on EACH side independently", () => {
    // ⚠ A PSEUDO LANE IS BOTH A FROM-NODE AND A TO-NODE, so „the largest cell this node lost"
    // is two questions, not one. Answered with a single map, S25's „недействителни" was
    // rescued by its largest INCOMING cell and left with no outgoing ribbon — still orphaned,
    // on the side the rescue existed for, with the gate green.
    const flows = [
      [10_000, 15],
      [9, 4],
    ];
    const { edges } = edgesOf(
      ["t1", "__invalid__"],
      ["t1", "__invalid__"],
      flows,
      new Set(["t1", "__invalid__"]),
      new Set(["t1", "__invalid__"]),
    );
    const out = edges.filter((e) => e.from === "__invalid__");
    const into = edges.filter((e) => e.to === "__invalid__");
    expect(out.length).toBeGreaterThan(0);
    expect(into.length).toBeGreaterThan(0);
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

  it("agrees on the SHARD path too, which fails even more quietly", () => {
    // ⚠ THE SHARD'S 404 IS `absent` AS WELL, so a rename here does not error anywhere: the
    // region page's transfer section simply never appears, on a page that otherwise works.
    expect(oblastTransferPath("2021_11_14_pvr", "BGS")).toBe(
      path.join("2021_11_14_pvr", oblastTransferFile("BGS")),
    );
  });
});

describe("writeRunoffTransfer", () => {
  const fixture = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-"));
    fs.mkdirSync(path.join(root, "2099_01_01_pvr"), { recursive: true });
    return root;
  };

  it("writes NOTHING and returns an EMPTY list for a cycle with no runoff", () => {
    // ⚠ THE CASE `scripts/main.ts` DEPENDS ON — it spreads the answer into `r.files`. A build
    // that returned a path here would put a file the ingest never wrote into its own manifest,
    // and one that created an empty `runoff_transfer/` directory would publish a shard folder
    // for a cycle that has no transfer to shard.
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "2099_01_01_pvr", "tickets.json"),
      JSON.stringify({ tickets: [{ number: 1, president: "А", rounds: [1] }] }),
    );
    expect(writeRunoffTransfer("2099_01_01_pvr", { root })).toEqual([]);
    expect(fs.readdirSync(path.join(root, "2099_01_01_pvr"))).toEqual([
      "tickets.json",
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.runIf(hasRunoff)(
    "deletes a shard the rebuild no longer produces, and keeps the ones it does",
    () => {
      // ⚠ THE MODULE'S ONLY IRREVERSIBLE OPERATION, and until this test it never executed:
      // the other cases write into a FRESH temp root, so `readdirSync` always returns exactly
      // the files just written and the delete branch is skipped. A regression that dropped
      // the `!` would delete every shard it had just written and pass the whole suite, because
      // the returned path list is built from `build.oblasts` rather than from disk.
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "rt-"));
      const cycle = built[0].cycle;
      fs.cpSync(path.join(DATA_ROOT, cycle), path.join(root, cycle), {
        recursive: true,
      });
      const dir = path.join(root, cycle, "runoff_transfer");
      fs.mkdirSync(dir, { recursive: true });
      // An oblast the corpus no longer produces, plus a non-JSON file that must survive.
      fs.writeFileSync(path.join(dir, "ZZZ.json"), "{}");
      fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
      const rels = writeRunoffTransfer(cycle, { root });
      expect(fs.existsSync(path.join(dir, "ZZZ.json"))).toBe(false);
      // ⚠ THE OTHER HALF. „Deletes the stale one" is also satisfied by „deletes everything".
      expect(
        fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length,
      ).toBe(rels.length - 1);
      expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
      fs.rmSync(root, { recursive: true, force: true });
    },
  );

  it.runIf(hasRunoff)(
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
      const rels = writeRunoffTransfer(cycle, { root, indent: 0 });
      // ⚠ THE CYCLE FILE FIRST, then one shard per oblast. The order is what lets a reader of
      // the ingest's manifest tell the two artifacts apart at a glance.
      expect(rels[0]).toBe(path.join(cycle, TRANSFER_FILE));
      expect(rels.length).toBe(1 + built[0].shards.length);
      for (const rel of rels) {
        expect(path.isAbsolute(rel)).toBe(false);
        const text = fs.readFileSync(path.join(root, rel), "utf8");
        expect(text.includes("\n  ")).toBe(false);
        expect(JSON.parse(text).cycle).toBe(cycle);
      }
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

describe.runIf(hasCorpus)("the per-oblast shards", () => {
  it.each(built)(
    "$cycle: has one for every oblast the cycle file carries a row for",
    ({ transfer, shards }) => {
      expect(shards.map((s) => s.oblast).sort()).toEqual(
        transfer.oblasts.map((o) => o.oblast).sort(),
      );
      expect(shards.length).toBeGreaterThan(25);
    },
  );

  it.each(built)(
    "$cycle: sums EXACTLY to the national margins, both sides",
    ({ transfer, shards }) => {
      // ⚠⚠ THE ASSERTION THAT SAYS THESE ARE THE SAME ESTIMATE. A shard built from a second
      // regression would render a perfectly plausible Sankey and disagree with the country
      // page's by an amount no reader could see — the exact drift `basis` exists to prevent,
      // one level down. Node totals come from the oblast's own margins, and the margins are
      // what RAS scaled to the published totals, so equality here is not an approximation.
      for (const side of ["fromNodes", "toNodes"] as const) {
        const summed = new Map<string, number>();
        for (const shard of shards)
          for (const n of shard.matrix[side])
            summed.set(n.id, (summed.get(n.id) ?? 0) + n.votes);
        for (const n of transfer.national.matrix[side])
          expect({ id: n.id, votes: summed.get(n.id) ?? 0 }).toEqual({
            id: n.id,
            votes: n.votes,
          });
      }
    },
  );

  it.each(built)(
    "$cycle: never draws a node with no ribbon at all",
    ({ shards }) => {
      // ⚠ THE PER-OBLAST CUT IS WHAT MAKES THIS POSSIBLE — nationally no node is orphaned
      // (worst gap 0.047), and the same absolute floor strands whole lanes once the matrix is
      // one oblast wide. A bare labelled bar is the chart printing a total it accounts for
      // none of.
      for (const shard of shards) {
        const out = new Map<string, number>();
        const into = new Map<string, number>();
        for (const e of shard.matrix.flows) {
          out.set(e.from, (out.get(e.from) ?? 0) + e.votes);
          into.set(e.to, (into.get(e.to) ?? 0) + e.votes);
        }
        for (const [nodes, side] of [
          [shard.matrix.fromNodes, out],
          [shard.matrix.toNodes, into],
        ] as const)
          for (const n of nodes)
            if (n.votes > 0)
              expect({
                oblast: shard.oblast,
                id: n.id,
                ribbons: (side.get(n.id) ?? 0) > 0,
              }).toEqual({ oblast: shard.oblast, id: n.id, ribbons: true });
        // ⚠ AND THE GAP IS BOUNDED, not merely non-total. A shard whose worst node showed a
        // tenth of its own votes would satisfy the loop above and still be unreadable.
        // RATCHETED ON THE MEASURED MAXIMUM (0.70, at 2011/S23), not on a round number above
        // it: at 0.75 the assertion admitted a shard drawing a quarter of a node's votes,
        // which is the condition the comment says it exists to refuse.
        expect({ oblast: shard.oblast, ok: shard.marginGap <= 0.7 }).toEqual({
          oblast: shard.oblast,
          ok: true,
        });
      }
      // ⚠ AND THE SHAPE, not only the worst case. A regression that lifts the whole
      // distribution — the estimator converging less well everywhere — leaves the maximum
      // where it is and is invisible to the ceiling above.
      //
      // ⚠ THE BOUND IS PER CYCLE AND THE CORPUS-WIDE FIGURE IS NOT IT. Over all 155 shards
      // the p90 is 0.287; per cycle it ranges 0.068 (2006) to 0.458 (2021), because the
      // residual is much larger in the cycles with more eliminated tickets. A ceiling set
      // from the pooled number fails two cycles that are behaving exactly as measured.
      // Per-cycle medians / p90s / maxima, 2026-09-07:
      //   2001 0.072 / 0.227 / 0.311    2006 0.029 / 0.068 / 0.286
      //   2011 0.077 / 0.422 / 0.700    2016 0.159 / 0.284 / 0.616
      //   2021 0.175 / 0.458 / 0.549
      const gaps = shards.map((s) => s.marginGap).sort((a, b) => a - b);
      expect(gaps[Math.floor(0.9 * (gaps.length - 1))]).toBeLessThan(0.5);
      expect(gaps[Math.floor(0.5 * (gaps.length - 1))]).toBeLessThan(0.25);
    },
  );

  it.each(built)(
    "$cycle: carries the coverage REFUSAL in every shard, verbatim",
    ({ transfer, shards }) => {
      // ⚠⚠ THE OTHER HALF OF THE CAVEAT, and on 2011 it is the larger half: the ingest refused
      // to place 1,355 sections / 422,726 runoff votes, all Sofia, against 32,024 inside
      // Sofia's three shards — 93% of Sofia's runoff vote outside its own shards. A region
      // page fetches one shard and nothing else, so a refusal declared only in the cycle file
      // is a refusal nobody can see.
      for (const shard of shards) {
        expect(shard.coverage.basis).toBe(transfer.coverage.basis);
        expect(shard.coverage.basisEn).toBe(transfer.coverage.basisEn);
        expect(shard.coverage.unplacedSectionsInCycle).toBe(
          transfer.coverage.unplacedSections,
        );
        expect(shard.coverage.unplacedVotesInCycle).toBe(
          transfer.coverage.unplacedVotes,
        );
        expect(shard.coverage.abroadVotesInCycle).toBe(
          transfer.coverage.abroadVotes,
        );
      }
    },
  );

  it("has a cycle whose shards declare a NON-ZERO placement refusal", () => {
    // ⚠ THE MUTATION CHECK for the rule above. Four of the five cycles refuse nothing, so a
    // field that had silently stopped being carried passes at 0 on all of them.
    expect(
      built.some((b) =>
        b.shards.some((s) => s.coverage.unplacedVotesInCycle > 0),
      ),
    ).toBe(true);
  });

  it.each(built)(
    "$cycle: no shard draws an edge to a node it does not carry",
    ({ shards }) => {
      // The shard twin of the national gate. This is where the precondition is reachable: a
      // node's row sum and its margin routinely disagree once the matrix is one oblast wide,
      // which is what `marginGap` reports.
      for (const shard of shards) {
        const from = new Set(shard.matrix.fromNodes.map((n) => n.id));
        const to = new Set(shard.matrix.toNodes.map((n) => n.id));
        for (const e of shard.matrix.flows)
          expect({
            oblast: shard.oblast,
            from: from.has(e.from),
            to: to.has(e.to),
          }).toEqual({ oblast: shard.oblast, from: true, to: true });
      }
    },
  );

  it.each(built)(
    "$cycle: no shard drops a meaningful share of its own mass",
    ({ shards }) => {
      // The shard twin of the national 0.1% bound, loosened to match what the per-oblast cut
      // costs: the floor is absolute, so it bites hardest on the smallest shards. Measured
      // worst case 1.305% (2011/S24).
      for (const shard of shards) {
        const mass = shard.matrix.fromNodes.reduce((a, n) => a + n.votes, 0);
        expect({
          oblast: shard.oblast,
          ok: shard.droppedVotes < mass * 0.02,
        }).toEqual({ oblast: shard.oblast, ok: true });
      }
    },
  );

  it.each(built)(
    "$cycle: the shards on disk are the shards the builder makes",
    ({ cycle, shards }) => {
      // The cycle file has this gate; the shards did not, so a change to `oblastTransferFile`
      // or a half-completed write would have been invisible to the suite.
      for (const shard of shards) {
        const file = path.join(
          DATA_ROOT,
          cycle,
          oblastTransferFile(shard.oblast),
        );
        expect({ oblast: shard.oblast, exists: fs.existsSync(file) }).toEqual({
          oblast: shard.oblast,
          exists: true,
        });
        // ⚠ PARSED, NOT BYTES — `--prod` minifies and a dev run indents.
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(shard);
      }
    },
  );

  it.each(built)(
    "$cycle: carries the caveat in EVERY shard, verbatim",
    ({ transfer, shards }) => {
      // ⚠⚠ A REGION PAGE FETCHES ONE SHARD AND NOTHING ELSE. `basis` living only in the cycle
      // file would be a matrix rendered with no caveat anywhere in the document — the failure
      // `useRunoffTransfer`'s refusal exists to prevent, one level down. Identity rather than
      // „non-empty", so the two surfaces cannot state different qualifications.
      for (const shard of shards) {
        expect(shard.basis).toBe(transfer.basis);
        expect(shard.basisEn).toBe(transfer.basisEn);
      }
    },
  );

  it.each(built)(
    "$cycle: keeps the NATIONAL winner first and reports the oblast's own votes",
    ({ transfer, shards }) => {
      // ⚠ NOT RE-RANKED LOCALLY. „Winner first" is a fact about the runoff, not about this
      // oblast: re-sorting per shard would name Герджиков the winner on Кърджали's page in
      // 2021 — a claim the runoff did not make.
      const order = transfer.finalists.map((f) => f.number);
      for (const shard of shards) {
        expect(shard.finalists.map((f) => f.number)).toEqual(order);
        // The shard's own figures, and they must be the matrix's own node totals rather than
        // a second read of the shards — otherwise the header and the chart can disagree.
        for (const f of shard.finalists) {
          const node = shard.matrix.toNodes.find(
            (n) => n.id === ticketNodeId(f.number),
          );
          expect(f.votes).toBe(node?.votes ?? 0);
        }
      }
    },
  );

  it.runIf(hasRunoff)(
    "has an oblast SOMEWHERE that the national runner-up carried",
    () => {
      // ⚠ THE MUTATION CHECK for the rule above: „winner first" is also satisfied by a shard
      // that happens to be sorted by votes, on a corpus where the winner led everywhere. Two of
      // the five cycles are exactly that (2006 and 2016 have no flipped oblast at all), so this
      // is asserted ACROSS the corpus and never per cycle.
      const flipped = built.flatMap(({ cycle, shards }) =>
        shards
          .filter((s) => s.finalists[1].votes > s.finalists[0].votes)
          .map((s) => `${cycle}/${s.oblast}`),
      );
      expect(flipped.length).toBeGreaterThan(0);
    },
  );

  it.each(built)(
    "$cycle: is small enough to be a page's own fetch",
    ({ shards }) => {
      // ⚠ THE WHOLE REASON THESE ARE SEPARATE FILES. Folded into `runoff_transfer.json` they
      // would grow the COUNTRY page's payload several-fold to answer a question it never asks.
      // ⚠ THE BYTES ACTUALLY SERVED — indented, UTF-8 — not `JSON.stringify().length`, which
      // is minified CHARACTERS and runs ~40% under on a corpus of Cyrillic labels. Measured
      // 6.3-15.2 KB on disk, mean 10.4 KB, ~2.3 KB after `bucket:gz`.
      for (const shard of shards) {
        const bytes = Buffer.byteLength(
          `${JSON.stringify(shard, null, 2)}\n`,
          "utf8",
        );
        expect({ oblast: shard.oblast, ok: bytes < 20_000 }).toEqual({
          oblast: shard.oblast,
          ok: true,
        });
      }
    },
  );
});
