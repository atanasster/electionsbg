import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEra2021Round, readSections, readTickets } from "./era2021";
import { assertCommitted } from "../lib/assert_committed";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = PRESIDENTIAL_SOURCES["2021_11_14_pvr"];
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
  readEra2021Round(roundDir(round), source, round);

/** Ticket → total votes, over the whole round. */
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

describe("era2021 — the official totals", () => {
  // ⚠ THE ANCHOR GATE. These are ЦИК's own published figures (decision № 956-ПВР),
  // and they are what a parser cannot satisfy by accident: dropping a form,
  // double-counting a machine row or mis-splitting a pair all move them.
  it("round 1 reproduces every published ticket total", () => {
    const totals = ticketTotals(read(1));
    expect(totals.get(6), "Радев/Йотова").toBe(1_322_385);
    expect(totals.get(15), "Герджиков/Митева").toBe(610_862);
    expect(totals.get(17), "Карадайъ (ДПС)").toBe(309_681);
    expect(totals.get(5), "Костадинов (Възраждане)").toBe(104_832);
    expect(totals.get(19), "Панов").toBe(98_488);
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(2_615_149);
  });

  it("round 2 reproduces the runoff", () => {
    const r = read(2);
    const totals = ticketTotals(r);
    expect(totals.get(6)).toBe(1_539_650);
    expect(totals.get(15)).toBe(733_791);
    // A runoff has exactly two tickets, and both must have stood in round 1.
    expect(r.tickets).toHaveLength(2);
    expect(r.tickets.map((t) => t.number).sort((a, b) => a - b)).toEqual([
      6, 15,
    ]);
  });

  it("counts every section the sections file lists", () => {
    expect(read(1).sections).toHaveLength(13_238);
    expect(read(2).sections).toHaveLength(13_234);
    // ⚠ Sections are RE-NUMBERED between rounds, so the two sets are not identical
    // and a join across rounds cannot assume they are.
    const r1 = new Set(read(1).sections.map((s) => s.code));
    const onlyR2 = read(2).sections.filter((s) => !r1.has(s.code));
    expect(onlyR2.length).toBeGreaterThan(0);
  });
});

describe('era2021 — „не подкрепям никого" is not a ticket', () => {
  // ⚠ THE DENOMINATOR THE WHOLE WINNER RULE HANGS ON. Радев is 50.57% of the ticket
  // votes and 49.42% of the VALID votes; only the second is the official figure, and
  // only the second sends him to a runoff.
  it("is counted in the protocol and never as a ticket", () => {
    const r = read(1);
    const none = sum(
      r,
      (s) =>
        (s.protocol.numValidNoOnePaperVotes ?? 0) +
        (s.protocol.numValidNoOneMachineVotes ?? 0),
    );
    expect(none).toBe(60_786);
    // It is not on the ballot, so no ticket may carry it.
    const totals = ticketTotals(r);
    expect(totals.has(99)).toBe(false);
    expect(r.tickets.some((t) => t.number === 99)).toBe(false);

    const tickets = [...totals.values()].reduce((a, b) => a + b, 0);
    const valid = tickets + none;
    expect(valid).toBe(2_675_935);
    // The two readings, so a future change that swaps them fails here rather than on
    // the surface: 49.42% is a runoff, 50.57% is an outright win.
    expect(((100 * 1_322_385) / valid).toFixed(2)).toBe("49.42");
    expect(((100 * 1_322_385) / tickets).toFixed(2)).toBe("50.57");
  });
});

describe("era2021 — a section is several rows", () => {
  // ⚠ THE ERA'S DEFINING TRAP. A section's paper protocol and EACH of its machines are
  // separate rows; a reader that takes the first row per section drops 84% of the
  // corpus. 010100001 is machine-only with two machines, verbatim from the tree.
  it("sums both machines of a two-machine section", () => {
    const s = read(1).sections.find((x) => x.code === "010100001");
    expect(s).toBeDefined();
    // Machine 1 gave Радев 111 and machine 2 gave him 99.
    expect(s!.votes.find((v) => v.partyNum === 6)?.totalVotes).toBe(210);
    expect(s!.votes.find((v) => v.partyNum === 15)?.totalVotes).toBe(80);
    expect(s!.machines).toBe(2);
    // Machine-only: no paper votes at all, and the protocol says 335 voted.
    expect(s!.votes.every((v) => (v.paperVotes ?? 0) === 0)).toBe(true);
    expect(s!.protocol.totalActualVoters).toBe(335);
    expect(s!.protocol.numValidMachineVotes).toBe(327);
    expect(s!.protocol.numValidNoOneMachineVotes).toBe(8);
  });

  // A combined paper+machine section: its form-26 row's 7.x fields are the BOX, and
  // the machine half is a separate control-receipt row. Adding the two is right;
  // treating the form-26 total as the whole section would lose the machine votes.
  it("adds the control-receipt row to the paper row", () => {
    const s = read(1).sections.find((x) => x.code === "010300050");
    expect(s).toBeDefined();
    const total = s!.votes.reduce((a, v) => a + v.totalVotes, 0);
    // 158 on paper (form 26) + 52 from the machine (form 27) = 210.
    expect(total).toBe(210);
    expect(s!.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0)).toBe(158);
    expect(s!.votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0)).toBe(52);
    expect(s!.protocol.numValidVotes).toBe(158);
    expect(s!.protocol.numValidMachineVotes).toBe(52);
  });

  it("splits the corpus into the measured paper and machine shares", () => {
    const r = read(1);
    const paper = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0),
    );
    const machine = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0),
    );
    expect(paper).toBe(309_742);
    expect(machine).toBe(2_305_407);
    expect(paper + machine).toBe(2_615_149);
    // Machine voting dominated this election — the reason the row-per-machine shape
    // matters so much here.
    expect(machine / (paper + machine)).toBeGreaterThan(0.85);
  });
});

describe("era2021 — the electorate figures", () => {
  it("takes them from the one form per section that carries them", () => {
    const r = read(1);
    // Signatures reproduce the CIK activity page exactly; registered voters do not,
    // which is why the aggregator must declare its basis rather than infer one.
    expect(sum(r, (s) => s.protocol.totalActualVoters ?? 0)).toBe(2_687_307);
    expect(sum(r, (s) => s.protocol.numRegisteredVoters ?? 0)).toBe(6_667_895);
    // ⚠ 28 sections DO report zero registered voters, and all 28 are abroad
    // (prefix 32): the list abroad is empty at handover and voters are added on the
    // day. That is why turnout abroad is votes CAST and never a share of registration
    // — a domestic section with no electorate would be a defect, an abroad one is
    // the ordinary case.
    const zero = r.sections.filter((s) => !s.protocol.numRegisteredVoters);
    expect(zero).toHaveLength(28);
    expect(zero.every((s) => s.code.startsWith("32"))).toBe(true);
    const domesticZero = r.sections.filter(
      (s) => !s.code.startsWith("32") && !s.protocol.numRegisteredVoters,
    );
    expect(domesticZero).toHaveLength(0);
  });
});

describe("era2021 — the ticket list", () => {
  it("reads all 23 tickets with both names and a nominator", () => {
    const tickets = readTickets(roundDir(1));
    expect(tickets).toHaveLength(23);
    const radev = tickets.find((t) => t.number === 6)!;
    expect(radev.president).toBe("Румен Георгиев Радев");
    expect(radev.vicePresident).toBe("Илияна Малинова Йотова");
    expect(radev.nominatedBy.kind).toBe("committee");
    // ⚠ The name comes from cik_candidates, never from cik_parties, whose ИК rows
    // run the committee name and the pair together with a hyphen.
    expect(radev.nominatedBy.name).not.toContain("Румен Георгиев Радев и");
    const gerb = tickets.find((t) => t.number === 15)!;
    expect(gerb.vicePresident).toBe("Невяна Михайлова Митева-Матеева");
    // Every ticket has both halves and a nominator.
    for (const t of tickets) {
      expect(t.president.length, `ticket ${t.number}`).toBeGreaterThan(3);
      expect(t.vicePresident.length, `ticket ${t.number}`).toBeGreaterThan(3);
      expect(t.nominatedBy.name.length, `ticket ${t.number}`).toBeGreaterThan(
        1,
      );
    }
  });

  it("gives the same person the same canonical key in both rounds", () => {
    const r1 = readTickets(roundDir(1)).find((t) => t.number === 6)!;
    const r2 = readTickets(roundDir(2)).find((t) => t.number === 6)!;
    expect(r2.canonicalKey).toBe(r1.canonicalKey);
  });
});

describe("era2021 — refusals", () => {
  it("names the file it cannot find", () => {
    expect(() =>
      readEra2021Round(path.join(PROJECT_ROOT, "raw_data"), source, 1),
    ).toThrow(/no "cik_candidates\*\.txt"/);
  });

  it("reads the section metadata the aggregator needs", () => {
    const meta = readSections(roundDir(1));
    expect(meta.size).toBe(13_238);
    const bansko = meta.get("010100001")!;
    // ⚠ PADDED. The file itself says `2676`; settlements.json keys `02676`, so an
    // unpadded read loses the place for ~1,490 sections while every vote still adds
    // up.
    expect(bansko.ekatte).toBe("02676");
    expect(bansko.placeName).toBe("гр.Банско");
    expect(bansko.machines).toBe(2);
    // Every domestic code ends up 5 wide, and abroad's 6-digit codes are untouched.
    const domestic = [...meta.entries()].filter(([c]) => !c.startsWith("32"));
    expect(domestic.every(([, m]) => (m.ekatte ?? "").length === 5)).toBe(true);
    // Abroad sections are prefix 32 in this era and carry a "Country, City" place.
    const abroad = [...meta.entries()].filter(([c]) => c.startsWith("32"));
    expect(abroad.length).toBe(750);
    expect(abroad[0][1].placeName).toContain(",");
  });
});

// ⚠ EVERY PROTOCOL FIELD, PINNED TO A ROW PRINTED HERE IN FULL. Without this, a wrong
// column index ships silently: mutating any one of ballotsReceived, additional,
// unused, destroyed, inBox, invalid or machineConfirmed left the anchor totals green,
// because none of them feeds a vote count. The verbatim rows are the point — a reader
// can check the mapping against them without opening the corpus.
describe("era2021 — the protocol field indices", () => {
  it("maps a machine-only section's row (form 25 + two form 32s)", () => {
    // 25;010100001;1;|01110137|…;;;600;623;8;335;598;2;;;335;;;;
    // 32;010100001;1;;CHCA4E1A00008262;;;;;;;;;;;;166;164;2
    // 32;010100001;1;;CHCA4E1A00012276;;;;;;;;;;;;169;163;6
    const p = read(1).sections.find((s) => s.code === "010100001")!.protocol;
    expect(p.ballotsReceived, "А. received").toBe(600);
    expect(p.numRegisteredVoters, "1. registered").toBe(623);
    expect(p.numAdditionalVoters, "2. added on the day").toBe(8);
    expect(p.totalActualVoters, "3. signatures").toBe(335);
    expect(p.numUnusedPaperBallots, "4а. unused").toBe(598);
    expect(p.numInvalidAndDestroyedPaperBallots, "4б. destroyed").toBe(2);
    // Machine-only: no paper box at all.
    expect(p.numValidVotes ?? 0).toBe(0);
    expect(p.numPaperBallotsFound ?? 0).toBe(0);
    // Summed from the two machines: 166 + 169 voted, 164 + 163 valid, 2 + 6 никого.
    expect(p.numMachineBallots, "machine voters").toBe(335);
    expect(p.numValidMachineVotes).toBe(327);
    expect(p.numValidNoOneMachineVotes).toBe(8);
    expect(p.numValidMachineVotes! + p.numValidNoOneMachineVotes!).toBe(
      p.numMachineBallots,
    );
  });

  it("maps a paper+machine section's row (form 26 + form 27)", () => {
    // 26;010300050;1;|01120001|…;;;500;444;7;220;335;1;218;164;54;3;161;158;3
    // 27;010300050;1;|01130050|…;EPDA4E2A00019284;1;;;;;;;;;;;;54;52;2
    const p = read(1).sections.find((s) => s.code === "010300050")!.protocol;
    expect(p.ballotsReceived).toBe(500);
    expect(p.numRegisteredVoters).toBe(444);
    expect(p.numAdditionalVoters).toBe(7);
    expect(p.totalActualVoters).toBe(220);
    expect(p.numUnusedPaperBallots).toBe(335);
    expect(p.numInvalidAndDestroyedPaperBallots).toBe(1);
    // 5.1 — found in the BOX (5. total is 218 = 164 box + 54 machine)
    expect(p.numPaperBallotsFound, "5.1 in the box").toBe(164);
    expect(p.numInvalidBallotsFound, "6. invalid in the box").toBe(3);
    expect(p.numValidVotes, "7.1 paper ticket votes").toBe(158);
    expect(p.numValidNoOnePaperVotes, "7.2 paper никого").toBe(3);
    // …and the machine half from the control receipt.
    expect(p.numMachineBallots).toBe(54);
    expect(p.numValidMachineVotes).toBe(52);
    expect(p.numValidNoOneMachineVotes).toBe(2);
    // The paper box reconciles: 164 found − 3 invalid = 161 = 158 + 3.
    expect(p.numPaperBallotsFound! - p.numInvalidBallotsFound!).toBe(
      p.numValidVotes! + p.numValidNoOnePaperVotes!,
    );
  });

  // ⚠ WHY `numMachineBallots` COMES FROM THE MACHINES AND NOT FROM FIELD 5.2. The
  // section's own statement of its machine total disagrees with its machines on 97
  // sections, and where it does the machines are right: this one claims 712 against
  // 398 signatures, which is impossible, while its two machines report 197 + 155.
  it("prefers the machines' own count over an impossible protocol figure", () => {
    const s = read(1).sections.find((x) => x.code === "244606005")!;
    expect(s.protocol.totalActualVoters).toBe(398);
    expect(s.protocol.numMachineBallots, "not the 712 the form claims").toBe(
      352,
    );
    expect(s.protocol.numValidMachineVotes).toBe(342);
    expect(s.protocol.numValidNoOneMachineVotes).toBe(10);
    // Here the machines' count sits inside the signature count, which the form's own
    // 712 does not — that is what makes 352 the defensible figure for THIS section.
    // (It is not a corpus-wide invariant; see the two tests below.)
    expect(s.protocol.numMachineBallots!).toBeLessThanOrEqual(
      s.protocol.totalActualVoters,
    );
  });

  // ⚠ THE INVARIANT THAT ACTUALLY HOLDS, and the one that does not. Machine ballots
  // are never fewer than the machines' own valid + „никого" — that reconciles on all
  // 13,238 sections. They DO exceed the signature count on 53 of them (round 2: 16),
  // by up to 1,040. That is a property of the source rather than a parsing error, so
  // it is reported under a pinned ceiling instead of being asserted away — the same
  // treatment the per-section vote residue gets in the plan's §2.5-10.
  it("reconciles machine ballots against the machines' own tally", () => {
    const broken = read(1).sections.filter(
      (s) =>
        (s.protocol.numMachineBallots ?? 0) <
        (s.protocol.numValidMachineVotes ?? 0) +
          (s.protocol.numValidNoOneMachineVotes ?? 0),
    );
    expect(broken.map((s) => s.code)).toEqual([]);
  });

  it("reports, rather than hides, the sections that out-count their signatures", () => {
    const over = read(1).sections.filter(
      (s) =>
        (s.protocol.numMachineBallots ?? 0) >
        (s.protocol.totalActualVoters ?? 0),
    );
    // Pinned so a parsing change that inflated machine ballots would push it up.
    expect(over).toHaveLength(53);
    const excess = over.reduce(
      (a, s) =>
        a +
        (s.protocol.numMachineBallots ?? 0) -
        (s.protocol.totalActualVoters ?? 0),
      0,
    );
    expect(excess).toBe(2_710);
    // Abroad is 15 of the 53 — not a majority, but far above its 5.7% share of all
    // sections, and it carries the largest single excess (325800665, +1,040). So the
    // over-count concentrates where the signature list is weakest without being
    // explained away by it.
    const abroad = over.filter((s) => s.code.startsWith("32"));
    expect(abroad).toHaveLength(15);
    const worst = over.sort(
      (a, b) =>
        (b.protocol.numMachineBallots ?? 0) -
        (b.protocol.totalActualVoters ?? 0) -
        ((a.protocol.numMachineBallots ?? 0) -
          (a.protocol.totalActualVoters ?? 0)),
    )[0];
    expect(worst.code).toBe("325800665");
  });
});

// ⚠ WHAT THE 2021 BALLOT ACTUALLY DECLARES ABOUT ITS OWN NOMINATORS. Pinned as a
// distribution rather than per-ticket, so a rule change that starts asserting a legal
// form the register never stated shows up here as a shift out of `unknown`.
describe("era2021 — the nominators", () => {
  it("claims a kind only where the label states one", () => {
    const byKind = new Map<string, number>();
    for (const t of readTickets(roundDir(1))) {
      byKind.set(t.nominatedBy.kind, (byKind.get(t.nominatedBy.kind) ?? 0) + 1);
    }
    // Measured on the 2021 ballot: 9 инициативни комитета, 3 self-declared „ПП",
    // 1 overridden coalition (Патриотичен фронт) — and 10 labels that state nothing
    // at all, including ВЪЗРАЖДАНЕ, АТАКА, ДПС and ВМРО. That the unmarked group is
    // the LARGEST is the whole argument for refusing rather than defaulting.
    expect(byKind.get("committee")).toBe(9);
    expect(byKind.get("party")).toBe(3);
    expect(byKind.get("coalition")).toBe(1);
    expect(byKind.get("unknown")).toBe(10);
    expect([...byKind.values()].reduce((a, b) => a + b, 0)).toBe(23);
  });

  it("does not call Патриотичен фронт a party", () => {
    const t = readTickets(roundDir(1)).find((x) => x.number === 4)!;
    expect(t.nominatedBy.name).toContain("ПАТРИОТИЧЕН ФРОНТ");
    expect(t.nominatedBy.kind).toBe("coalition");
  });
});
