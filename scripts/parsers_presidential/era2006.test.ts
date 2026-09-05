import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABROAD_PREFIX_2006,
  readEra2006Round,
  readSections,
  readTickets,
} from "./era2006";
import { assertCommitted } from "../lib/assert_committed";
import { decodeBundleText, parseSemicolonRows } from "./encoding";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = PRESIDENTIAL_SOURCES["2006_10_22_pvr"];
const roundDir = (round: 1 | 2): string =>
  path.join(PROJECT_ROOT, "raw_data", source.cycle, roundFolderName(round));
const read = (round: 1 | 2): PresidentialRound =>
  readEra2006Round(roundDir(round), source, round);

// ⚠ ASSERTED, NOT SKIPPED. Both rounds are COMMITTED under `raw_data/`, and CI does a
// full checkout — so their absence is a broken working copy, not a supported state.
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

/** A throwaway round folder, under this era's real filenames. ASCII-only bodies: they
 *  are decoded as windows-1251, so UTF-8 Cyrillic would come back as mojibake. */
const withFixture = (
  files: Record<string, string>,
  fn: (dir: string) => void,
): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "era2006-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), body, "latin1");
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
/** windows-1251 bytes for Cyrillic, written through `latin1` (А–я are 0xC0–0xFF). */
const cp1251 = (text: string): string =>
  [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x410 && cp <= 0x44f
        ? String.fromCharCode(cp - 0x410 + 0xc0)
        : ch;
    })
    .join("");

describe("era2006 — the official totals", () => {
  it("round 1 reproduces every published ticket total", () => {
    const totals = ticketTotals(read(1));
    expect(totals.get(3), "Първанов/Марин").toBe(1_780_119);
    expect(totals.get(6), "Сидеров/Шопов").toBe(597_175);
    expect(totals.get(1), "Беронов/Николова").toBe(271_078);
    expect(totals.get(7), "Марков").toBe(75_478);
    expect(totals.get(5), "Берон").toBe(21_812);
    expect(totals.get(4), "Велев").toBe(19_857);
    expect(totals.get(2), "Петров").toBe(13_854);
    expect(read(1).sections).toHaveLength(11_809);
  });

  it("round 2 reproduces the runoff", () => {
    const r = read(2);
    const totals = ticketTotals(r);
    expect(totals.get(3)).toBe(2_050_488);
    expect(totals.get(6)).toBe(649_387);
    expect(r.sections).toHaveLength(11_809);

    // Plan T2.6: a runoff carries exactly two tickets, and both are round 1's.
    expect(r.tickets).toHaveLength(2);
    const r1 = new Set(read(1).tickets.map((t) => t.number));
    expect(r.tickets.every((t) => r1.has(t.number))).toBe(true);
  });

  it("reproduces the national electorate figures", () => {
    const r = read(1);
    expect(
      sum(r, (s) => s.protocol.totalActualVoters),
      "signatures",
    ).toBe(2_809_725);
    expect(
      sum(r, (s) => s.protocol.numValidVotes ?? 0),
      "valid",
    ).toBe(2_779_381);
    // ⚠ Only the SUM is comparable with 2011's. This era's „registered" already
    // includes the day's additions (its readme says so) while 2011 publishes those
    // separately, so neither column means the same thing on its own.
    expect(
      sum(
        r,
        (s) =>
          (s.protocol.numRegisteredVoters ?? 0) +
          (s.protocol.numAdditionalVoters ?? 0),
      ),
      "registered + additional",
    ).toBe(6_430_117);
  });
});

// ⚠⚠ THE TRAP THAT DEFINES THIS ERA. There is no candidates file: the ballot exists only
// as prose in `Readme.txt`, and in the RUNOFF the two survivors keep their round-1
// numbers while occupying the first two vote columns. A reader that took „first vote
// column = ticket 1" would publish Първанов's 2,050,488 against a candidate who was not
// in the runoff — with the national total still exact and nothing failing.
describe("era2006 — the readme IS the ballot", () => {
  it("maps round 1's columns to tickets 1..7 in order", () => {
    const cols = readTickets(roundDir(1));
    expect(cols).toHaveLength(7);
    expect(cols.map((c) => [c.column, c.ticket.number])).toEqual([
      [16, 1],
      [17, 2],
      [18, 3],
      [19, 4],
      [20, 5],
      [21, 6],
      [22, 7],
    ]);
  });

  it("maps round 2's two columns to tickets 3 and 6, NOT 1 and 2", () => {
    const cols = readTickets(roundDir(2));
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => [c.column, c.ticket.number])).toEqual([
      [16, 3],
      [17, 6],
    ]);
    // The positional reading and the correct one disagree here, which is the whole
    // point: ticket 1 is not on this ballot at all.
    expect(cols.map((c) => c.ticket.number)).not.toEqual([1, 2]);
  });

  it("splits the two names on a COMMA and keeps a hyphenated surname whole", () => {
    const cols = readTickets(roundDir(1));
    const parvanov = cols.find((c) => c.ticket.number === 3)!.ticket;
    // ⚠ Real Cyrillic, not mojibake — the whole reason the era declares its encoding.
    expect(parvanov.president).toBe("Георги Първанов");
    expect(parvanov.vicePresident).toBe("Ангел Марин");
    // „и" is not a separator here, and a name splitter that used it would cut
    // „Ангелова-Банкова" or „Цонева-Иванова" in the wrong place.
    const beron = cols.find((c) => c.ticket.number === 5)!.ticket;
    expect(beron.vicePresident).toBe("Стела Ангелова-Банкова");
    const markov = cols.find((c) => c.ticket.number === 7)!.ticket;
    expect(markov.vicePresident).toBe("Мария Цонева-Иванова");
  });

  it("records that the bundle names NO nominator, rather than inventing one", () => {
    // ⚠ Unlike every other era, 2006 publishes no party, coalition or committee for any
    // ticket. `unknown` with an empty name is the source's silence recorded; a default
    // of „party" here would be an assertion about seven real candidates that nothing
    // supports — the defect `nominatorKind` was written to refuse.
    for (const round of [1, 2] as const) {
      for (const { ticket } of readTickets(roundDir(round))) {
        expect(ticket.nominatedBy.kind, `${round}/${ticket.number}`).toBe(
          "unknown",
        );
        expect(ticket.nominatedBy.name).toBe("");
      }
    }
  });
});

describe("era2006 — abroad", () => {
  it("uses prefix 32, the МИР grid, and names a city with no country", () => {
    const r = read(1);
    expect(ABROAD_PREFIX_2006).toBe("32");
    const abroad = r.sections.filter((s) => s.abroad);
    expect(abroad).toHaveLength(144);
    expect(abroad.every((s) => s.abroad?.country === null)).toBe(true);
    expect(abroad.some((s) => s.abroad?.city === "Стокхолм")).toBe(true);
    // Abroad rows carry no ЕКАТТЕ at all, so it stays undefined rather than being
    // padded from an empty string into a code.
    expect(abroad.every((s) => s.ekatte === undefined)).toBe(true);
  });

  // ⚠⚠ THE ZERO THAT IS NOT A COUNT. Every abroad protocol leaves точка 3 blank while
  // holding real ballots, and no domestic one does. Read as turnout that is 0% abroad
  // against 46,113 valid votes — and it hides inside a national sum that still
  // reconciles, which is why the flag exists rather than a downstream heuristic.
  it("marks abroad signature counts as unreported, and only those", () => {
    for (const round of [1, 2] as const) {
      const r = read(round);
      const abroad = r.sections.filter((s) => s.abroad);
      expect(abroad.filter((s) => s.signaturesUnreported)).toHaveLength(144);
      expect(
        r.sections.filter((s) => !s.abroad && s.signaturesUnreported),
      ).toHaveLength(0);
      // The published value is kept as-is; the flag carries the meaning.
      expect(abroad.every((s) => s.protocol.totalActualVoters === 0)).toBe(
        true,
      );
    }
  });

  it("has the ballots-found fallback a turnout surface needs", () => {
    // Plan §2.5-3: turnout abroad uses точка 6. Pinned so the fallback has something to
    // read — a flag with no usable denominator beside it would be a dead end.
    const r = read(1);
    const abroad = r.sections.filter((s) => s.abroad);
    const found = abroad.reduce(
      (a, s) => a + (s.protocol.numPaperBallotsFound ?? 0),
      0,
    );
    const valid = abroad.reduce(
      (a, s) => a + (s.protocol.numValidVotes ?? 0),
      0,
    );
    expect(valid).toBe(46_113);
    expect(found).toBe(47_009);
    expect(found).toBeGreaterThan(valid);
  });

  // ⚠ Pinned for the aggregator (T3.1), which resolves these cities to countries: two of
  // them are spelled with a LATIN homoglyph, so a Cyrillic-only match silently drops
  // Melbourne and Villalba. BOTH rounds, because T3.1 resolves both — pinning round 1
  // alone would let it drop the same two cities from the runoff unnoticed.
  it("has two city names containing Latin homoglyphs, in both rounds", () => {
    for (const round of [1, 2] as const) {
      const odd = read(round)
        .sections.filter((s) => s.abroad)
        .map((s) => s.abroad!.city)
        .filter((c) => /[A-Za-z]/.test(c));
      expect(odd.sort(), `round ${round}`).toEqual(["Mелбърн", "Вилялбa"]);
    }
  });
});

describe("era2006 — the protocol", () => {
  it("maps the fields of a row printed here in full", () => {
    // 010100001;890;604;0;797;0;286;0;0;286;8;0;0;0;8;278;33;0;193;0;1;43;8;
    const s = read(1).sections.find((x) => x.code === "010100001")!;
    expect(s.placeName).toBe("гр.Банско");
    expect(s.ekatte, "02676 padded from 2676").toBe("02676");
    const p = s.protocol;
    expect(p.numRegisteredVoters, "5. точка 1 main list").toBe(797);
    expect(p.numAdditionalVoters, "6. точка 2 supplementary").toBe(0);
    expect(p.totalActualVoters, "7. точка 3 signatures").toBe(286);
    expect(p.numInvalidAndDestroyedPaperBallots, "4. точка В сгрешени").toBe(0);
    expect(p.numPaperBallotsFound, "10. точка 6 found").toBe(286);
    expect(p.numInvalidBallotsFound, "15. точка 11 invalid").toBe(8);
    expect(p.numValidVotes, "16. точка 12 valid").toBe(278);
    expect(p.numInvalidBallotsFound! + p.numValidVotes!).toBe(
      p.numPaperBallotsFound,
    );
    // Ticket 3 took 193 of this section's 278.
    expect(s.votes.find((v) => v.partyNum === 3)?.totalVotes).toBe(193);
    expect(s.votes.reduce((a, v) => a + v.totalVotes, 0)).toBe(278);
  });

  // ⚠ The ticket sum and the protocol's own valid column disagree — here on exactly ONE
  // section in round 1 and none in round 2. Named rather than bounded, so a NEW
  // disagreement fails while the known one does not. Plan §2.5-10.
  it("disagrees with the valid column on exactly one known section", () => {
    const residue = (round: 1 | 2): Record<string, number> =>
      Object.fromEntries(
        read(round)
          .sections.map((s) => [
            s.code,
            s.votes.reduce((a, v) => a + v.totalVotes, 0) -
              (s.protocol.numValidVotes ?? 0),
          ])
          .filter(([, d]) => d !== 0),
      );
    expect(residue(1)).toEqual({ "234615094": -8 });
    expect(residue(2)).toEqual({});
  });
});

describe.each([1, 2] as const)("era2006 round %i — both rounds", (round) => {
  it("leaves „никого“ absent, has no machine votes, and 9-digit codes", () => {
    const r = read(round);
    // ⚠ „не подкрепям никого" did not exist before 2016, so the valid total IS the
    // ticket total here. A stored 0 would claim nobody chose it, which is a different
    // fact from the form not asking.
    expect(
      r.sections.every((s) => s.protocol.numValidNoOnePaperVotes === undefined),
    ).toBe(true);
    expect(r.sections.every((s) => s.machines === 0)).toBe(true);
    expect(r.sections.every((s) => s.isMobile === false)).toBe(true);
    expect(r.sections.every((s) => /^\d{9}$/.test(s.code))).toBe(true);
    // Every vote is paper, so the two must agree exactly.
    const paper = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0),
    );
    expect(paper).toBe(
      sum(r, (s) => s.votes.reduce((a, v) => a + v.totalVotes, 0)),
    );
  });

  it("has exactly one protocol row and one sections row per section", () => {
    // ⚠ NOT ASSERTABLE THROUGH THE READER'S OUTPUT, which is why this reads the raw
    // rows. `sections` is a Map keyed by code and `addTicketVotes` folds by partyNum, so
    // „every code is unique" and „every ticket appears once" are true BY CONSTRUCTION
    // whatever the file holds — measured on a fixture, a duplicated protocol row takes a
    // ticket from 50 to 100 and BOTH of those assertions still pass. Only the rows can
    // answer this. The reader now refuses both duplications; the controls are in the
    // refusals block below.
    for (const kind of ["protocols", "sections"] as const) {
      const file = fs
        .readdirSync(roundDir(round))
        .find(
          (f) =>
            f.toLowerCase().startsWith("izbori2006_") &&
            f.toLowerCase().endsWith(`_${kind}.txt`),
        )!;
      const rows = parseSemicolonRows(
        decodeBundleText(
          fs.readFileSync(path.join(roundDir(round), file)),
          source.encoding,
        ),
      );
      const codes = rows.map((r) => (r[0] ?? "").trim()).filter(Boolean);
      expect(codes, `${kind} row count`).toHaveLength(11_809);
      expect(new Set(codes).size, `${kind} distinct codes`).toBe(codes.length);
    }
  });

  it("has a uniform row width that matches the readme's ballot", () => {
    // The independent half of the readme-vs-file check the reader now enforces: the
    // protocol's own fields end at точка 12, so the ballot columns are a known run and a
    // readme that named fewer or more would disagree with the row width.
    const cols = readTickets(roundDir(round));
    const file = fs
      .readdirSync(roundDir(round))
      .find((f) => f.toLowerCase().endsWith("_protocols.txt"))!;
    const rows = parseSemicolonRows(
      decodeBundleText(
        fs.readFileSync(path.join(roundDir(round), file)),
        source.encoding,
      ),
    );
    const widths = new Set(rows.map((r) => r.length));
    expect(widths.size, "one row shape per round").toBe(1);
    // 16 protocol fields + one column per ticket + the trailing empty cell.
    expect([...widths][0]).toBe(16 + cols.length + 1);
  });
});

// Every refusal gets a positive control: a guard with no test that makes it fire is
// decoration, satisfied equally by an implementation that never rejects anything.
describe("era2006 — refusals", () => {
  const README =
    "  17) " + cp1251("Гласове за 3. Георги Първанов, Ангел Марин") + "\n";
  const OK = {
    "Readme.txt": README,
    "izbori2006_t1_sections.txt": "010100001;PLACE;2676;\n",
    "izbori2006_T1_protocols.txt":
      "010100001;1;0;0;1;0;1;0;0;1;0;0;0;0;0;1;1;\n",
  };

  it("names the file it cannot find", () => {
    withFixture({ "Readme.txt": README }, (dir) => {
      expect(() => readSections(dir)).toThrow(/no "izbori2006_t<n>_sections/);
    });
  });

  it("matches the two data files case-insensitively", () => {
    // The bundle really does ship `izbori2006_T1_protocols.txt` beside
    // `izbori2006_t1_sections.txt`, so an exact-name match would find one and not the
    // other.
    withFixture(OK, (dir) => {
      expect(() => readEra2006Round(dir, source, 1)).not.toThrow();
    });
  });

  it("refuses a readme with no ballot lines, naming why it matters", () => {
    withFixture({ ...OK, "Readme.txt": "nothing here\n" }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/no candidates file/);
    });
  });

  it("refuses a ballot line that does not name exactly two candidates", () => {
    withFixture(
      { "Readme.txt": "  17) " + cp1251("Гласове за 3. Само Един") + "\n" },
      (dir) => {
        expect(() => readTickets(dir)).toThrow(
          /does not name exactly two candidates/,
        );
      },
    );
  });

  it("refuses a readme that gives one column two tickets", () => {
    // Two lines claiming column 17 would make the later silently win, publishing one
    // candidate's votes against another.
    const second =
      "  17) " + cp1251("Гласове за 6. Волен Сидеров, Павел Шопов") + "\n";
    withFixture({ "Readme.txt": README + second }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/repeats column 17$/m);
    });
  });

  it("refuses a readme that gives one ticket two columns", () => {
    // The other corruption, and a DIFFERENT message: a single combined error would send
    // a maintainer back to the file to work out which of the two happened.
    const again =
      "  18) " + cp1251("Гласове за 3. Георги Първанов, Ангел Марин") + "\n";
    withFixture({ "Readme.txt": README + again }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/repeats ticket 3$/m);
    });
  });

  it("refuses an empty sections file", () => {
    withFixture({ ...OK, "izbori2006_t1_sections.txt": "\n" }, (dir) => {
      expect(() => readSections(dir)).toThrow(/no sections in/);
    });
  });

  it("names the readme when the bundle has none", () => {
    // The readme is the more load-bearing of the two files here: it is the sole
    // statement of the ballot, so a missing one must not read as an empty ballot.
    withFixture(
      { "izbori2006_t1_sections.txt": "010100001;PLACE;2676;\n" },
      (dir) => {
        expect(() => readTickets(dir)).toThrow(/no "Readme\.txt"/);
      },
    );
  });

  it("refuses a ballot with a GAP, rather than dropping the missing ticket", () => {
    // ⚠ THE CRITICAL ONE. A readme line that fails to match is skipped, and „no lines at
    // all" is a weak completeness test — any proper subset parses happily and a whole
    // ticket's votes vanish with the national total simply smaller. Here column 17
    // parses and column 18 does not, so the run starts at 18 instead of 17.
    const onlySecond =
      "  18) " + cp1251("Гласове за 6. Волен Сидеров, Павел Шопов") + "\n";
    withFixture({ ...OK, "Readme.txt": onlySecond }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/not a contiguous run from 17/);
    });
  });

  it("refuses a readme column the protocol row does not have", () => {
    // The other direction: `num()` maps an out-of-range cell to 0, so without this the
    // reader publishes a named person as having stood in the election, at 0 votes, on
    // the strength of a line nothing corroborates.
    const phantom =
      README +
      "  19) " +
      cp1251("Гласове за 9. Никой Никой, Никой Никой") +
      "\n";
    withFixture({ ...OK, "Readme.txt": phantom }, (dir) => {
      expect(() => readTickets(dir)).toThrow(/not a contiguous run from 17/);
    });
  });

  it("refuses a protocol row carrying votes past the last ballot column", () => {
    // The file holds a ticket the readme does not name — those votes would be dropped.
    withFixture(
      {
        ...OK,
        "izbori2006_T1_protocols.txt":
          "010100001;1;0;0;1;0;1;0;0;1;0;0;0;0;0;1;1;7;\n",
      },
      (dir) => {
        expect(() => readEra2006Round(dir, source, 1)).toThrow(
          /carries a value past ballot column 17/,
        );
      },
    );
  });

  it("refuses a duplicated protocol row, which would DOUBLE the section", () => {
    withFixture(
      {
        ...OK,
        "izbori2006_T1_protocols.txt":
          OK["izbori2006_T1_protocols.txt"].repeat(2),
      },
      (dir) => {
        expect(() => readEra2006Round(dir, source, 1)).toThrow(
          /appears twice in protocols/,
        );
      },
    );
  });

  it("refuses a duplicated sections row, which would move its ЕКАТТЕ", () => {
    withFixture(
      {
        ...OK,
        "izbori2006_t1_sections.txt":
          "010100001;PLACE-A;2676;\n010100001;PLACE-B;9999;\n",
      },
      (dir) => {
        expect(() => readSections(dir)).toThrow(
          /appears twice in the sections file/,
        );
      },
    );
  });

  it("refuses a protocol row for a section the sections file does not carry", () => {
    withFixture(
      {
        ...OK,
        "izbori2006_T1_protocols.txt":
          "999999999;1;0;0;1;0;1;0;0;1;0;0;0;0;0;1;1;\n",
      },
      (dir) => {
        expect(() => readEra2006Round(dir, source, 1)).toThrow(
          /section 999999999 appears in protocols but not in sections/,
        );
      },
    );
  });
});
