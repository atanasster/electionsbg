import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABROAD_PREFIX_2011,
  readEra2011Round,
  readResult,
  readSections,
  readTickets,
} from "./era2011";
import { assertCommitted } from "../lib/assert_committed";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = PRESIDENTIAL_SOURCES["2011_10_23_pvr"];
const roundDir = (round: 1 | 2): string =>
  path.join(PROJECT_ROOT, "raw_data", source.cycle, roundFolderName(round));
const read = (round: 1 | 2): PresidentialRound =>
  readEra2011Round(roundDir(round), source, round);

// ⚠ ASSERTED, NOT SKIPPED. Both rounds are COMMITTED under `raw_data/`, and CI does a
// full checkout — so their absence is a broken working copy, not a supported state.
// Standing down for it would hide that as one more skip in a suite where ~160 data gates
// already skip for want of a database.
assertCommitted(
  `raw_data/${source.cycle}/${roundFolderName(1)}`,
  `raw_data/${source.cycle}/${roundFolderName(2)}`,
);

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

/** windows-1251 bytes for a Cyrillic string, written through `latin1`. А–я occupy
 *  0xC0–0xFF contiguously, which covers every flag this era uses. */
const cp1251 = (text: string): string =>
  [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x410 && cp <= 0x44f
        ? String.fromCharCode(cp - 0x410 + 0xc0)
        : ch;
    })
    .join("");

/**
 * A throwaway round folder.
 *
 * Files are written under the era's REAL names, because the reader matches them exactly
 * — see `FILE_PREFIX`. Bodies are ASCII (or cp1251 bytes via `cp1251()`): they are
 * decoded as windows-1251, so Cyrillic written as UTF-8 would come back as mojibake and
 * mislead anyone reading the fixture.
 */
const withFixture = (
  files: Record<string, string>,
  fn: (dir: string) => void,
): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "era2011-"));
  try {
    for (const [suffix, body] of Object.entries(files)) {
      fs.writeFileSync(
        path.join(dir, `el2011_president_${suffix}.txt`),
        body,
        "latin1",
      );
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("era2011 — the official totals", () => {
  it("round 1 reproduces every published ticket total", () => {
    const totals = ticketTotals(read(1));
    expect(totals.get(2), "Плевнелиев/Попова").toBe(1_349_380);
    expect(totals.get(8), "Калфин/Данаилов").toBe(974_300);
    expect(totals.get(1), "Кунева").toBe(470_808);
    expect(totals.get(9), "Сидеров").toBe(122_466);
    expect(read(1).sections).toHaveLength(11_784);
  });

  it("round 2 reproduces the runoff, between the two who led round 1", () => {
    const r = read(2);
    const totals = ticketTotals(r);
    expect(totals.get(2)).toBe(1_698_136);
    expect(totals.get(8)).toBe(1_531_193);
    expect(r.sections).toHaveLength(11_779);

    // Plan T2.6: a runoff carries exactly two tickets, and both are round 1's — a
    // renumbered ballot would otherwise attach round 2's votes to the wrong people.
    expect(r.tickets).toHaveLength(2);
    const r1 = new Set(read(1).tickets.map((t) => t.number));
    expect(r.tickets.every((t) => r1.has(t.number))).toBe(true);
    expect(r.tickets.map((t) => t.number).sort((a, b) => a - b)).toEqual([
      2, 8,
    ]);
  });

  // ⚠ result.txt is a CROSS-CHECK for the computed winner rule, never its source —
  // plan decision 5. Its value is that it is an independent statement by ЦИК: round 1
  // sent both leaders to a runoff (`Б`) and round 2 elected one (`И`).
  it("agrees with ЦИК's own statement of the outcome", () => {
    const r1 = readResult(roundDir(1));
    expect(r1).toHaveLength(2);
    expect(r1.every((x) => x.outcome === "runoff")).toBe(true);
    // …and its vote figures match what the sections add up to.
    const totals1 = ticketTotals(read(1));
    for (const row of r1) expect(totals1.get(row.number)).toBe(row.votes);

    const r2 = readResult(roundDir(2));
    expect(r2).toEqual([{ number: 2, outcome: "elected", votes: 1_698_136 }]);
  });
});

describe("era2011 — the oblast grid, not the МИР grid", () => {
  // ⚠ THE TRAP THAT MAKES THIS ERA DIFFERENT. The election ran through the ОИК
  // alongside that year's local vote, so the nine-digit codes mean different places
  // than the parliamentary ones. Prefix 22 is София-град, 16 is the WHOLE of Пловдив
  // (parliamentary splits it into 16 and 17), and abroad is 29 — not 32.
  it("uses 29 for abroad, and 32 does not exist", () => {
    const r = read(1);
    const prefixes = new Set(r.sections.map((s) => s.code.slice(0, 2)));
    expect(prefixes.has(ABROAD_PREFIX_2011)).toBe(true);
    // Reading `32` here — the prefix every other era uses — finds nothing and would
    // silently publish zero votes abroad.
    expect(prefixes.has("32")).toBe(false);
    expect(prefixes.size).toBe(29);
    expect(r.sections.filter((s) => s.abroad)).toHaveLength(161);
  });

  it("marks abroad sections with a city and no country", () => {
    const abroad = read(1).sections.filter((s) => s.abroad);
    // ⚠ This era names only a CITY („Канбера"), never a country, so `country` is null
    // rather than guessed. Resolving it is the aggregator's job (T3.1).
    expect(abroad.every((s) => s.abroad?.country === null)).toBe(true);
    expect(abroad.every((s) => (s.abroad?.city ?? "").length > 1)).toBe(true);
    expect(abroad.some((s) => s.abroad?.city === "Канбера")).toBe(true);
  });

  it("puts all of Пловдив under one prefix, unlike the МИР grid", () => {
    const meta = readSections(roundDir(1));
    const plovdiv = [...meta.entries()].filter(([c]) => c.startsWith("16"));
    // The parliamentary grid splits Пловдив into МИР 16 (city) and 17 (oblast); here
    // both are 16, so a code-based join across elections would mis-place them.
    const names = new Set(plovdiv.map(([, m]) => m.oblastName));
    expect(names.size).toBe(1);
    expect([...names][0]).toContain("ПЛОВДИВ");
    expect(plovdiv.length).toBeGreaterThan(900);
  });
});

// The invariants that hold in BOTH rounds. Round 2 is a structurally different file —
// two tickets, 6-column votes rows against round 1's 38, five fewer sections — so
// exercising it only on its two headline totals would leave that re-shaping unchecked.
describe.each([1, 2] as const)("era2011 round %i — both rounds", (round) => {
  it("leaves „никого“ absent, has no machine votes, and 9-digit codes", () => {
    const r = read(round);
    // ⚠ „не подкрепям никого" did not exist before 2016, so the valid total IS the
    // ticket total here. Storing a 0 would be a claim that nobody chose it, which is a
    // different fact from the form not asking — and the winner rule reads exactly this
    // to build its denominator.
    expect(
      r.sections.every((s) => s.protocol.numValidNoOnePaperVotes === undefined),
    ).toBe(true);
    expect(
      r.sections.every(
        (s) => s.protocol.numValidNoOneMachineVotes === undefined,
      ),
    ).toBe(true);

    expect(r.sections.every((s) => s.machines === 0)).toBe(true);
    expect(
      r.sections.every((s) =>
        s.votes.every((v) => (v.machineVotes ?? 0) === 0),
      ),
    ).toBe(true);
    // Every vote is paper, so the two must agree exactly.
    const paper = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0),
    );
    const total = sum(r, (s) => s.votes.reduce((a, v) => a + v.totalVotes, 0));
    expect(paper).toBe(total);

    // Every row begins with a flag column, so the code is field 2. Read as field 1,
    // every code would be the empty string.
    expect(r.sections.every((s) => /^\d{9}$/.test(s.code))).toBe(true);
    expect(r.sections.filter((s) => s.abroad)).toHaveLength(161);
  });

  // ⚠ THE TWO LOOPS TREAT MULTIPLICITY ASYMMETRICALLY AND NEITHER CHECKS IT. A duplicate
  // protocols row silently OVERWRITES; a duplicate votes row silently DOUBLES that
  // section's tally, because `addTicketVotes` sums by design (written for era2021, where
  // several rows per section are normal). The anchor test covers 4 of 18 tickets, so a
  // doubled row on any other would pass everything above.
  it("has exactly one protocol row and one votes row per section", () => {
    const r = read(round);
    expect(new Set(r.sections.map((s) => s.code)).size).toBe(r.sections.length);
    for (const s of r.sections) {
      expect(new Set(s.votes.map((v) => v.partyNum)).size, s.code).toBe(
        s.votes.length,
      );
    }
  });

  it("carries only the two flag values the corpus actually holds", () => {
    // ⚠ The read-me declares a third value, `Е` (Експериментална преброителна
    // комисия), and NO section in either round carries it. Pinned so the reader's
    // `isExperimental` branch is understood as documented-but-unexercised rather than
    // as a category somebody could report on: „N experimental commissions" would be a
    // claim about a corpus that holds none.
    const meta = readSections(roundDir(round));
    expect([...meta.values()].some((m) => m.isExperimental)).toBe(false);
    expect([...meta.values()].filter((m) => m.isMobile)).toHaveLength(
      round === 1 ? 82 : 80,
    );
  });
});

describe("era2011 — the protocol", () => {
  it("maps the fields of a row printed here in full", () => {
    // ;010300004;844;0;2;18;432;0;0;4;0;0;2;0;0;0;0;1;0;432;3;0;9;0;0;12;420
    const p = read(1).sections.find((s) => s.code === "010300004")!.protocol;
    expect(p.numRegisteredVoters, "3. registered").toBe(844);
    // 4) below the line = 0 and 5) supplementary list = 2, summed into one figure.
    expect(p.numAdditionalVoters, "4 + 5").toBe(2);
    expect(p.totalActualVoters, "7. signatures").toBe(432);
    expect(p.numInvalidAndDestroyedPaperBallots, "10. сгрешени").toBe(4);
    expect(p.numPaperBallotsFound, "20. found in the boxes").toBe(432);
    expect(p.numInvalidBallotsFound, "26. invalid").toBe(12);
    expect(p.numValidVotes, "27. valid").toBe(420);
    // The row's own arithmetic: found = invalid + valid.
    expect(p.numInvalidBallotsFound! + p.numValidVotes!).toBe(
      p.numPaperBallotsFound,
    );
  });

  it("reproduces the national electorate figures", () => {
    const r = read(1);
    expect(sum(r, (s) => s.protocol.numRegisteredVoters ?? 0)).toBe(6_870_725);
    expect(sum(r, (s) => s.protocol.totalActualVoters ?? 0)).toBe(3_591_741);
  });

  // ⚠ …AND THAT ARITHMETIC DOES NOT HOLD EVERYWHERE, so nothing downstream may derive
  // one of these three from the other two. These are hand-filled forms: measured over
  // round 1, 19 of 11,784 sections have `found != invalid + valid`, and 149 have an
  // invalid count that is not the sum of its own five components (the read-me's stated
  // formula — „сумата от числата по т. 19, т. 20, т. 21, т. 22 и т. 23" — is itself a
  // typo for fields 21–25, which is what the rows that DO reconcile follow). Pinned as
  // measured counts rather than asserted away.
  it("does not always reconcile with itself", () => {
    const broken = read(1).sections.filter(
      (s) =>
        (s.protocol.numInvalidBallotsFound ?? 0) +
          (s.protocol.numValidVotes ?? 0) !==
        (s.protocol.numPaperBallotsFound ?? 0),
    );
    expect(broken).toHaveLength(19);
  });

  // ⚠ NAMED, NOT MERELY COUNTED (plan T2.6). The ticket votes and the protocol's own
  // valid column disagree on eleven sections, in BOTH directions, and the national
  // totals still match ЦИК because ЦИК publishes the same per-ticket sums. A bare
  // ceiling would let a NEW disagreement appear as long as an old one went away — the
  // exact regression this gate exists to catch. Measured 2026-09-05 against the
  // committed round-1 tree.
  const KNOWN_RESIDUE_R1: Record<string, number> = {
    "010300035": -2,
    "021800028": -1,
    "161200020": -24,
    "224601008": 11,
    "224605003": -1,
    "224610044": 27,
    "224614036": 10,
    "224615017": -3,
    "224615116": -3,
    "224618002": -10,
    "224618030": 2,
  };

  it("disagrees with the valid column on exactly the known sections", () => {
    const bySection = read(1).sections.map((s) => ({
      code: s.code,
      d:
        s.votes.reduce((a, v) => a + v.totalVotes, 0) -
        (s.protocol.numValidVotes ?? 0),
    }));
    const disagreeing = bySection.filter((x) => x.d !== 0);
    expect(Object.fromEntries(disagreeing.map((x) => [x.code, x.d]))).toEqual(
      KNOWN_RESIDUE_R1,
    );
    // Both directions occur — it is not a systematic under- or over-count.
    expect(disagreeing.some((x) => x.d > 0)).toBe(true);
    expect(disagreeing.some((x) => x.d < 0)).toBe(true);
    expect(bySection.reduce((a, x) => a + x.d, 0)).toBe(6);
  });
});

describe("era2011 — the windows-1251 files", () => {
  it("decodes the ticket names, which are in SEPARATE columns", () => {
    const tickets = readTickets(roundDir(1));
    expect(tickets).toHaveLength(18);
    const p = tickets.find((t) => t.number === 2)!;
    // ⚠ Real Cyrillic, not mojibake — the whole reason the era declares its encoding.
    expect(p.president).toBe("Росен Асенов Плевнелиев");
    expect(p.vicePresident).toBe("Маргарита Стефанова Попова");
    expect(p.nominatedBy.name).toBe("ПП ГЕРБ");

    // ⚠ The names are separate columns here, so `splitTicketNames` is not used — and
    // must not be: „Валентина Иванова Гоцева" would split on the „и" of Иванова only
    // if the halves happened to fall right, and „Даниела Проданова Симидчиева -
    // Димитрова" carries a spaced hyphen no name splitter should touch.
    const gotseva = tickets.find((t) => t.number === 3)!;
    expect(gotseva.vicePresident).toBe("Валентина Иванова Гоцева");
    const karakachanov = tickets.find((t) => t.number === 17)!;
    expect(karakachanov.vicePresident).toBe(
      "Даниела Проданова Симидчиева - Димитрова",
    );
  });

  it("classifies every nominator, and 2011 is the era with no unknowns", () => {
    const tickets = readTickets(roundDir(1));
    const byKind = new Map<string, number>();
    for (const t of tickets) {
      byKind.set(t.nominatedBy.kind, (byKind.get(t.nominatedBy.kind) ?? 0) + 1);
    }
    // ⚠ Measured: every 2011 label is self-declaring — 11 „ПП …", 6 „Инициативен
    // комитет", 1 „КП …". No other era manages that (2016 and 2021 carry 24 unmarked
    // labels between them), so this is the one place where a regression toward a
    // DEFAULT kind would not show up as a lost „unknown" — it shows up here as a
    // wrong count.
    expect(Object.fromEntries(byKind)).toEqual({
      party: 11,
      committee: 6,
      coalition: 1,
    });
    expect(tickets.find((t) => t.number === 1)!.nominatedBy.kind).toBe(
      "committee",
    );
    expect(tickets.find((t) => t.number === 2)!.nominatedBy.kind).toBe("party");
    expect(tickets.find((t) => t.number === 4)!.nominatedBy.kind).toBe(
      "coalition",
    );
  });

  it("decodes the place names and pads their ЕКАТТЕ", () => {
    const meta = readSections(roundDir(1));
    const s = meta.get("010300004")!;
    expect(s.placeName).toBe("гр.Благоевград");
    expect(s.oblastName).toBe("БЛАГОЕВГРАД");
    expect(s.obshtinaName).toBe("Благоевград");
    // The file says 4279; the settlement catalogue keys 04279.
    expect(s.ekatte).toBe("04279");
  });
});

// Every refusal in the reader gets a positive control. A guard with no test that makes
// it fire is decoration: it looks like a protection in review and is equally satisfied
// by an implementation that never rejects anything.
describe("era2011 — refusals", () => {
  const OK = {
    candidates: "2;PRESIDENT;VICE;PP X\n",
    sections: ";010300004;OBLAST;OBSHTINA;PLACE;4279\n",
    protocols: ";010300004;1;0;0;1;1;0;0;0;0;0;0;0;0;0;0;0;0;1;0;0;0;0;0;0;1\n",
    votes: ";010300004;2;1\n",
    result: `${cp1251("Б")};2;PRESIDENT;VICE;1\n`,
  };

  it("names the file it cannot find, and the folder's actual contents", () => {
    withFixture({ sections: OK.sections }, (dir) => {
      expect(() => readTickets(dir)).toThrow(
        /no "el2011_president_candidates\.txt".*found el2011_president_sections\.txt/s,
      );
    });
  });

  it("refuses a protocol flag it does not recognise", () => {
    // The flag selects which protocol FORM the row is, so an unknown one is a row whose
    // field map is unverified — treating it as ordinary publishes those numbers under
    // the wrong headings at no error.
    withFixture({ sections: `Z${OK.sections}` }, (dir) => {
      expect(() => readSections(dir)).toThrow(/unknown protocol flag "Z"/);
    });
  });

  it("refuses an outcome marker it does not recognise", () => {
    // ⚠ `Б` must be tested for, not inferred as „not И" — see `outcomeOf`. Without this
    // control, a total decode failure reads as „every candidate went to a runoff".
    withFixture({ result: "Z;2;PRESIDENT;VICE;1349380\n" }, (dir) => {
      expect(() => readResult(dir)).toThrow(/unknown outcome marker "Z"/);
    });
  });

  it("refuses the readme's Е flag, which no committed round exercises", () => {
    withFixture({ ...OK, sections: `${cp1251("Е")}${OK.sections}` }, (dir) => {
      expect(() => readEra2011Round(dir, source, 1)).toThrow(
        /експериментална преброителна комисия/,
      );
    });
  });

  it("refuses a ticket that is missing one of its two names", () => {
    withFixture({ candidates: "2;PRESIDENT;;PP X\n" }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/ticket 2 is missing a name/);
    });
  });

  it("refuses an empty ticket list and an empty sections file", () => {
    withFixture({ candidates: "\n" }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/no tickets in/);
    });
    withFixture({ sections: "\n" }, (dir) => {
      expect(() => readSections(dir)).toThrow(/no sections in/);
    });
  });

  it("refuses a votes row for a section the sections file does not carry", () => {
    // Dropping it silently would lose real votes from the national total while every
    // row count still reconciled.
    withFixture({ ...OK, votes: ";999999999;2;1\n" }, (dir) => {
      expect(() => readEra2011Round(dir, source, 1)).toThrow(
        /section 999999999 appears in votes but not in sections/,
      );
    });
  });

  it("refuses a vote for a ticket that is not on the ballot", () => {
    withFixture({ ...OK, votes: ";010300004;2;1;99;1\n" }, (dir) => {
      expect(() => readEra2011Round(dir, source, 1)).toThrow(
        /ticket 99, which is not on the ballot/,
      );
    });
  });
});
