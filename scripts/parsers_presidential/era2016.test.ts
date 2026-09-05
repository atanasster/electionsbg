import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEra2016Round, readSections, readTickets } from "./era2016";
import { assertCommitted } from "../lib/assert_committed";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = PRESIDENTIAL_SOURCES["2016_11_06_pvr"];
const roundDir = (round: 1 | 2): string =>
  path.join(PROJECT_ROOT, "raw_data", source.cycle, roundFolderName(round));
// ⚠ ASSERTED, NOT SKIPPED. Both rounds are COMMITTED under `raw_data/`, and CI does a
// full checkout — so their absence is a broken working copy, not a supported state.
// Standing down for it would hide that as one more skip in a suite where ~160 data gates
// already skip for want of a database.
assertCommitted(
  `raw_data/${source.cycle}/${roundFolderName(1)}`,
  `raw_data/${source.cycle}/${roundFolderName(2)}`,
);
const read = (round: 1 | 2): PresidentialRound =>
  readEra2016Round(roundDir(round), source, round);

const ticketTotals = (r: PresidentialRound): Map<number, number> => {
  const out = new Map<number, number>();
  for (const s of r.sections) {
    for (const v of s.votes) {
      out.set(v.partyNum, (out.get(v.partyNum) ?? 0) + v.totalVotes);
    }
  }
  return out;
};
const sum = (
  r: PresidentialRound,
  f: (s: PresidentialRound["sections"][number]) => number,
): number => r.sections.reduce((a, s) => a + f(s), 0);

describe("era2016 — the official totals", () => {
  // ЦИК decisions № 3992-ПВР and № 4032-ПВР.
  it("round 1 reproduces every published ticket total", () => {
    const totals = ticketTotals(read(1));
    expect(totals.get(13), "Радев/Йотова").toBe(973_754);
    expect(totals.get(17), "Цачева/Манушев").toBe(840_635);
    expect(totals.get(19), "Каракачанов").toBe(573_016);
    expect(totals.get(2), "Марешки").toBe(427_660);
    expect(totals.get(4), "Орешарски").toBe(253_726);
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(3_613_556);
  });

  it("round 2 reproduces the runoff", () => {
    const r = read(2);
    const totals = ticketTotals(r);
    expect(totals.get(13)).toBe(2_063_032);
    expect(totals.get(17)).toBe(1_256_485);
    expect(r.tickets.map((t) => t.number).sort((a, b) => a - b)).toEqual([
      13, 17,
    ]);
  });

  // ⚠ EQUAL COUNTS ARE NOT THE SAME SET. Both rounds have 12,340 sections and they
  // are not identical: one code is dropped and one added between them (020400339 →
  // 312600105). Sections are re-numbered between rounds in every era, so a round-1 →
  // round-2 join must be keyed and its residue reported, never assumed total — which
  // an equal count would otherwise invite.
  it("has the same COUNT in both rounds but not the same codes", () => {
    const a = read(1).sections.map((s) => s.code);
    const b = read(2).sections.map((s) => s.code);
    expect(a).toHaveLength(12_340);
    expect(b).toHaveLength(12_340);
    const inA = new Set(a);
    const inB = new Set(b);
    expect(b.filter((c) => !inA.has(c))).toEqual(["312600105"]);
    expect(a.filter((c) => !inB.has(c))).toEqual(["020400339"]);
  });
});

describe('era2016 — „не подкрепям никого" is not a ticket', () => {
  it("is counted in the protocol and never as a ticket", () => {
    const r = read(1);
    const none = sum(
      r,
      (s) =>
        (s.protocol.numValidNoOnePaperVotes ?? 0) +
        (s.protocol.numValidNoOneMachineVotes ?? 0),
    );
    expect(none).toBe(214_094);
    const tickets = [...ticketTotals(r).values()].reduce((a, b) => a + b, 0);
    // The two readings of Радев's result. 25.44% is the published figure; 26.95% is
    // what dropping „никого" from the denominator produces.
    expect(((100 * 973_754) / (tickets + none)).toFixed(2)).toBe("25.44");
    expect(((100 * 973_754) / tickets).toFixed(2)).toBe("26.95");
  });
});

describe("era2016 — the machine half lives in COLUMNS, not rows", () => {
  // ⚠ THE ERA'S DEFINING DIFFERENCE FROM 2021. One protocol row and one votes row per
  // section; the machine figures are extra columns. Only 500 of 12,340 sections had a
  // machine at all, so a reader that took Б as "the paper vote" everywhere would zero
  // the paper vote for the other 11,840.
  it("splits a machine section and leaves a paper one whole", () => {
    const r = read(1);
    // 010300011 is machine-flagged; ticket 13 there is 126 = 86 paper + 40 machine.
    const machineSection = r.sections.find((s) => s.code === "010300011")!;
    const v13 = machineSection.votes.find((v) => v.partyNum === 13)!;
    expect(v13.totalVotes).toBe(126);
    expect(v13.paperVotes).toBe(86);
    expect(v13.machineVotes).toBe(40);
    expect(machineSection.machines).toBe(1);

    // 010100001 is not; its whole tally is paper.
    const paperSection = r.sections.find((s) => s.code === "010100001")!;
    expect(paperSection.machines).toBe(0);
    expect(paperSection.votes.every((v) => (v.machineVotes ?? 0) === 0)).toBe(
      true,
    );
    expect(paperSection.votes.find((v) => v.partyNum === 17)?.paperVotes).toBe(
      129,
    );
  });

  it("counts the 500 machine sections and their share of the vote", () => {
    const r = read(1);
    expect(r.sections.filter((s) => s.machines > 0)).toHaveLength(500);
    const machine = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0),
    );
    const paper = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0),
    );
    expect(machine).toBe(41_585);
    expect(paper + machine).toBe(3_613_556);
    // Machine voting was an experiment here — 1.2% — where in 2021 it was 88%.
    expect(machine / (paper + machine)).toBeLessThan(0.02);
  });

  // ⚠ WHY THE TOTAL COMES FROM THE SOURCE'S OWN COLUMN AND THE SPLIT IS DERIVED.
  // The decomposition does not always add up: one cell in 259,140 states a total of 0
  // with a machine vote of 1. Summing Б+М would put the national total one vote above
  // ЦИК's published figure — a number a reader can check against the register.
  it("trusts the stated total where the decomposition contradicts it", () => {
    const s = read(1).sections.find((x) => x.code === "273100059")!;
    const t8 = s.votes.find((v) => v.partyNum === 8);
    expect(t8?.totalVotes).toBe(0);
    // …and the derived split never goes negative or exceeds the total.
    for (const v of read(1).sections.flatMap((x) => x.votes)) {
      expect(v.paperVotes ?? 0).toBeGreaterThanOrEqual(0);
      expect((v.paperVotes ?? 0) + (v.machineVotes ?? 0)).toBe(v.totalVotes);
    }
  });
});

// ⚠ EVERY PROTOCOL FIELD, PINNED TO ROWS PRINTED HERE IN FULL, because none of them
// feeds a vote total and a wrong column would leave the anchors green.
describe("era2016 — the protocol field indices", () => {
  it("maps a machine section's row (form 8, the only decomposing form)", () => {
    // 8;010300011;1;|7010009|…;700;606;10;385;218;167;479;1;0;0;0;2;385;218;167;
    //   17;8;9;368;341;195;146;27;15;12;9;8;17
    const p = read(1).sections.find((s) => s.code === "010300011")!.protocol;
    expect(p.ballotsReceived, "А. received").toBe(700);
    expect(p.numRegisteredVoters, "1. registered").toBe(606);
    expect(p.numAdditionalVoters, "2. added").toBe(10);
    expect(p.totalActualVoters, "3. signatures").toBe(385);
    expect(p.numUnusedPaperBallots, "4.а unused").toBe(479);
    // 4.б–4.е are five separate destruction reasons: 1 + 0 + 0 + 0 + 2.
    expect(p.numInvalidAndDestroyedPaperBallots, "4.б–4.е").toBe(3);
    expect(p.numPaperBallotsFound, "5.а in the box").toBe(218);
    expect(p.numInvalidBallotsFound, "6. invalid total").toBe(17);
    expect(p.numMachineBallots, "5.б machine, in the FOUND block").toBe(167);
    expect(p.numValidVotes, "7.1 from the box").toBe(195);
    expect(p.numValidMachineVotes, "7.1 from a machine").toBe(146);
    expect(p.numValidNoOnePaperVotes, "7.2 box").toBe(15);
    expect(p.numValidNoOneMachineVotes, "7.2 machine").toBe(12);
    // The row's own arithmetic: 7 = 7.1 + 7.2, and each half decomposes.
    expect(p.numValidVotes! + p.numValidMachineVotes!).toBe(341);
    expect(p.numValidNoOnePaperVotes! + p.numValidNoOneMachineVotes!).toBe(27);
    expect(p.numPaperBallotsFound! + p.numMachineBallots!).toBe(
      p.totalActualVoters,
    );
  });

  it("maps a paper section's row (form 1)", () => {
    // 1;010100001;1;|3010005|…;600;596;7;429;;;170;1;0;0;0;0;429;;;14;;;415;405;;;10;;;;;14
    const p = read(1).sections.find((s) => s.code === "010100001")!.protocol;
    expect(p.ballotsReceived).toBe(600);
    expect(p.numRegisteredVoters).toBe(596);
    expect(p.numAdditionalVoters).toBe(7);
    expect(p.totalActualVoters).toBe(429);
    expect(p.numUnusedPaperBallots).toBe(170);
    expect(p.numInvalidAndDestroyedPaperBallots).toBe(1);
    expect(p.numPaperBallotsFound, "5. found — no machine half").toBe(429);
    expect(p.numInvalidBallotsFound).toBe(14);
    expect(p.numValidVotes, "7.1 total, since none of it is machine").toBe(405);
    expect(p.numValidNoOnePaperVotes).toBe(10);
    // No machine fields at all on this form — not zero-meaning-none, absent.
    expect(p.numValidMachineVotes).toBeUndefined();
    expect(p.numMachineBallots).toBeUndefined();
    // 429 found − 14 invalid = 415 = 405 + 10.
    expect(p.numPaperBallotsFound! - p.numInvalidBallotsFound!).toBe(
      p.numValidVotes! + p.numValidNoOnePaperVotes!,
    );
  });
});

describe("era2016 — the ticket list", () => {
  it("reads all 21 tickets, and the file's own elected flag", () => {
    const r1 = readTickets(roundDir(1));
    expect(r1.tickets).toHaveLength(21);
    // Nobody is elected in round 1 — that is what a runoff means.
    expect(r1.electedNumbers).toEqual([]);
    const radev = r1.tickets.find((t) => t.number === 13)!;
    expect(radev.president).toBe("Румен Георгиев Радев");
    expect(radev.vicePresident).toBe("Илияна Малинова Йотова");
    expect(radev.nominatedBy.kind).toBe("committee");

    // ⚠ The elected flag is a CROSS-CHECK for the computed winner rule, never its
    // source — see the plan's decision 5.
    const r2 = readTickets(roundDir(2));
    expect(r2.electedNumbers).toEqual([13]);
  });

  it("gives Радев the same canonical key as his 2021 ticket", () => {
    const radev2016 = readTickets(roundDir(1)).tickets.find(
      (t) => t.number === 13,
    )!;
    // He stood as ticket 13 here and ticket 6 in 2021, so the ballot number cannot
    // link them and the folded name must.
    expect(radev2016.canonicalKey).toBe("румен георгиев радев");
    expect(radev2016.number).not.toBe(6);
  });

  it("does not call Обединени патриоти a party", () => {
    const t = readTickets(roundDir(1)).tickets.find((x) => x.number === 19)!;
    expect(t.nominatedBy.name).toContain("ОБЕДИНЕНИ ПАТРИОТИ");
    expect(t.nominatedBy.kind).toBe("coalition");
  });
});

describe("era2016 — the sections file", () => {
  it("pads ЕКАТТЕ and flags the machine sections", () => {
    const meta = readSections(roundDir(1));
    expect(meta.size).toBe(12_340);
    expect(meta.get("010100001")!.ekatte).toBe("02676");
    expect(meta.get("010100001")!.placeName).toBe("гр.Банско");
    expect(meta.get("010300011")!.hasMachine).toBe(true);
    expect(meta.get("010100001")!.hasMachine).toBe(false);
    // Abroad is prefix 32 in this era too, and its 6-digit codes stay unpadded.
    const abroad = [...meta.entries()].filter(([c]) => c.startsWith("32"));
    expect(abroad).toHaveLength(325);
  });
});

// ⚠ THE TWO SPLITS. The protocol's 7.1 box/machine pair and the votes file's Б/М
// columns are two published statements of the same thing, and they disagree on 56 of
// the 500 machine sections. Both reconcile to ЦИК's per-ticket totals, so nothing
// downstream would flag it — which is exactly why it is pinned here, with each basis
// named. A surface must say which one a "% cast on machines" figure came from.
describe("era2016 — the two paper/machine bases disagree, and both are kept", () => {
  it("keeps them apart and reports the divergence", () => {
    const r = read(1);
    const fromProtocol = sum(r, (s) => s.protocol.numValidMachineVotes ?? 0);
    const fromVotes = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0),
    );
    expect(fromProtocol).toBe(41_792);
    expect(fromVotes).toBe(41_585);
    expect(fromProtocol).not.toBe(fromVotes);

    const disagreeing = r.sections.filter(
      (s) =>
        (s.protocol.numValidMachineVotes ?? 0) !==
        s.votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0),
    );
    expect(disagreeing).toHaveLength(56);
    // …and the disagreement is confined to sections that actually had a machine.
    expect(disagreeing.every((s) => s.machines === 1)).toBe(true);
    // Neither basis disturbs the ticket totals, which is why this needs pinning.
    expect([...ticketTotals(r).values()].reduce((a, b) => a + b, 0)).toBe(
      3_613_556,
    );
  });

  // ⚠ 5.а and 5.б must come from the SAME block, or a section's found-total
  // contradicts its own row: the signatures block (3.а/3.б) and the found block
  // (5.а/5.б) disagree on 2 sections. With both halves read from the found block, the
  // two sum to the signature count everywhere except ONE section, which found one
  // ballot more than it has signatures (397 + 90 = 487 against 486) — a discrepancy
  // in the СИК's own protocol, where its 5. total agrees with the found block and not
  // with its signatures.
  it("takes both halves of the found total from the found block", () => {
    const broken = read(1)
      .sections.filter((s) => s.machines === 1)
      .filter(
        (s) =>
          (s.protocol.numPaperBallotsFound ?? 0) +
            (s.protocol.numMachineBallots ?? 0) !==
          (s.protocol.totalActualVoters ?? 0),
      );
    expect(broken.map((s) => s.code)).toEqual(["223100016"]);
    const odd = broken[0];
    expect(odd.protocol.numPaperBallotsFound).toBe(397);
    expect(odd.protocol.numMachineBallots).toBe(90);
    expect(odd.protocol.totalActualVoters).toBe(486);
  });
});

describe("era2016 — a zero-machine form-8 section", () => {
  // ⚠ Six form-8 sections recorded no machine votes at all. Branching on "are the
  // machine fields non-zero" files them as paper, which publishes `machines: 1` beside
  // absent machine fields — destroying the absent-vs-zero distinction. The branch is
  // the section's own flag instead.
  it("is still read as a machine section, with zeros rather than absences", () => {
    const zeroMachine = read(1)
      .sections.filter((s) => s.machines === 1)
      .filter((s) => (s.protocol.numMachineBallots ?? 0) === 0);
    expect(zeroMachine.length).toBe(4);
    for (const s of zeroMachine) {
      // Present and zero — not undefined.
      expect(s.protocol.numValidMachineVotes, s.code).toBe(0);
      expect(s.protocol.numValidNoOneMachineVotes, s.code).toBe(0);
    }
    // …while a genuine paper section has them ABSENT, because form 1 does not ask.
    const paper = read(1).sections.find((s) => s.code === "010100001")!;
    expect(paper.protocol.numValidMachineVotes).toBeUndefined();
  });
});
