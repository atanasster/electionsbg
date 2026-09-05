import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ABROAD_PREFIX_2001, readEra2001Round, readTickets } from "./era2001";
import { assertCommitted } from "../lib/assert_committed";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import type { PresidentialRound } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = PRESIDENTIAL_SOURCES["2001_11_11_pvr"];
const roundDir = (round: 1 | 2): string =>
  path.join(PROJECT_ROOT, "raw_data", source.cycle, roundFolderName(round));
/**
 * ⚠ MEMOISED, unlike the sibling suites'. This era is 33 files per round and
 * `readBundleFile` does a `readdirSync` per file, so an un-cached `read()` is ~35
 * directory scans and 33 MIK decodes over 12k sections — and the suite calls it about
 * thirty times. `withCopyOfRound` deliberately does NOT go through this: its whole
 * purpose is to read a MUTATED copy, which a cache would hide.
 */
const roundCache = new Map<1 | 2, PresidentialRound>();
const read = (round: 1 | 2): PresidentialRound => {
  const hit = roundCache.get(round);
  if (hit) return hit;
  const r = readEra2001Round(roundDir(round), source, round);
  roundCache.set(round, r);
  return r;
};

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

/** MIK bytes for Cyrillic, written through `latin1`: `decodeMik` maps 0x80–0xBF onto
 *  U+0410–U+044F, which is the whole А–я run. */
const mik = (text: string): string =>
  [...text]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x410 && cp <= 0x44f
        ? String.fromCharCode(cp - 0x410 + 0x80)
        : ch;
    })
    .join("");

/** A copy of a real round folder, so a mutation control runs against the real corpus
 *  rather than a hand-built bundle this era is far too structured to fake. */
const withCopyOfRound = (
  round: 1 | 2,
  mutate: (dir: string) => void,
  fn: (dir: string) => void,
): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "era2001-"));
  try {
    for (const f of fs.readdirSync(roundDir(round))) {
      fs.copyFileSync(path.join(roundDir(round), f), path.join(dir, f));
    }
    mutate(dir);
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("era2001 — the official totals", () => {
  it("round 1 reproduces every ticket total the bundle publishes", () => {
    const totals = ticketTotals(read(1));
    expect(totals.get(5), "Първанов/Марин").toBe(1_032_665);
    expect(totals.get(2), "Стоянов/Куцкова").toBe(991_680);
    expect(totals.get(3), "Бонев/Железчев").toBe(546_801);
    expect(totals.get(6), "Инджова/Илов").toBe(139_680);
    expect(totals.get(4), "Ганчев/Бончев").toBe(95_481);
    expect(totals.get(1), "Берон/Андреев").toBe(31_394);
    expect(read(1).sections).toHaveLength(12_191);
  });

  it("round 2 reproduces the runoff", () => {
    const r = read(2);
    const totals = ticketTotals(r);
    expect(totals.get(5), "Първанов").toBe(2_043_443);
    expect(totals.get(2), "Стоянов").toBe(1_731_676);
    expect(r.sections).toHaveLength(12_192);
    // ONE section MORE than round 1, not fewer. Every era re-numbers between rounds and
    // they do not agree on a direction — 2011 loses five, 2006 keeps the same count —
    // so nothing downstream may assume one.
    expect(r.sections.length - read(1).sections.length).toBe(1);
  });

  it("reproduces the national electorate figures", () => {
    const r = read(1);
    expect(sum(r, (s) => s.protocol.numRegisteredVoters ?? 0)).toBe(6_824_979);
    expect(sum(r, (s) => s.protocol.totalActualVoters)).toBe(2_850_650);
    expect(sum(r, (s) => s.protocol.numValidVotes ?? 0)).toBe(2_837_708);
  });
});

// ⚠⚠ THE TRAP THAT DEFINES THIS ERA. `[PROT]`'s vote group is POSITIONAL — one figure
// per `[PARTII]` ROW, in that order — while the tickets keep their round-1 NUMBERS into
// the runoff. So round 2's two figures belong to tickets 02 and 05, and reading the
// vector as „ticket 1, ticket 2" hands 2,043,443 votes to a candidate who was not on the
// ballot, with the national total still exact.
describe("era2001 — the positional vote vector", () => {
  it("keeps the round-1 numbers in the runoff, so R2 is tickets 2 and 5", () => {
    const t = read(2).tickets;
    expect(t.map((x) => x.number)).toEqual([2, 5]);
    // The positional reading and the correct one disagree here, which is the point.
    expect(t.map((x) => x.number)).not.toEqual([1, 2]);
    // …and the order is [PARTII]'s, so the SECOND figure is Първанов's, the winner.
    expect(t[1].president).toBe("Георги Седефчов Първанов");
    expect(ticketTotals(read(2)).get(t[1].number)).toBe(2_043_443);
    // Both are round-1 tickets.
    const r1 = new Set(read(1).tickets.map((x) => x.number));
    expect(t.every((x) => r1.has(x.number))).toBe(true);
  });

  it("refuses a vote vector whose length disagrees with [PARTII]", () => {
    // Positive control for the guard: a vector of the wrong length is exactly the shape
    // that silently shifts every ticket by one.
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "010000z0.201");
        const t = fs.readFileSync(f, "latin1");
        fs.writeFileSync(
          f,
          t.replace("2+148+58+12+124+2", "2+148+58+12+124"),
          "latin1",
        );
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /carries 5 vote figures against 6 tickets/,
        );
      },
    );
  });
});

describe("era2001 — the MIK-encoded ballot", () => {
  it("decodes real Cyrillic and splits the pair on „и“", () => {
    const t = readTickets(roundDir(1), 1);
    expect(t).toHaveLength(6);
    const parvanov = t.find((x) => x.number === 5)!;
    // ⚠ Real Cyrillic, not mojibake — the whole reason the era declares its encoding.
    expect(parvanov.president).toBe("Георги Седефчов Първанов");
    expect(parvanov.vicePresident).toBe("Ангел Иванов Марин");
    const beron = t.find((x) => x.number === 1)!;
    expect(beron.president).toBe("Петър Кирилов Берон");
    expect(beron.vicePresident).toBe("Стоян Вълчев Андреев");
  });

  it("checks the split against the row's own initials", () => {
    // ⚠ „и" is an ordinary Bulgarian word, so a name containing it would cut in the
    // wrong place and yield two plausible-looking people. `[PARTII]`'s third column is
    // the pair's initials, derived by the source from the same names by another route —
    // an independent check rather than a restatement. Positive control: corrupting one
    // name must break it.
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "COMMON.201");
        const t = fs.readFileSync(f, "latin1");
        fs.writeFileSync(
          f,
          t.replace(
            mik("Георги Седефчов Първанов и Ангел"),
            mik("Георги Седефчов и Ангел"),
          ),
          "latin1",
        );
      },
      (dir) => {
        expect(() => readTickets(dir, 1)).toThrow(/initials disagree/);
      },
    );
  });

  it("records that the bundle names no nominator", () => {
    // 2001's ballot was by candidate PAIR, and the files name no party or committee for
    // any of them. `unknown` is the source's silence recorded, as in 2006.
    for (const round of [1, 2] as const) {
      for (const t of readTickets(roundDir(round), round)) {
        expect(t.nominatedBy.kind).toBe("unknown");
        expect(t.nominatedBy.name).toBe("");
      }
    }
  });
});

// ⚠ ENFORCED, NOT REPORTED — the thing this era has that no other does. Every oblast
// file publishes its own `[MAJ]` (per ticket) and `[AGGR]` (protocol totals), and
// `000000z0` publishes them nationally. Both reconcile with the sections EXACTLY.
describe("era2001 — the source's own aggregates", () => {
  it("has a national file with aggregates and no sections", () => {
    // What this asserts is the bundle's SHAPE: 32 oblast files plus one national
    // aggregate. `000000z0` exists to be checked against rather than read from — it has
    // 0 [PROT] rows, and the reader drives off that emptiness rather than off the
    // filename. The reconciliation itself is the mutation control below.
    for (const round of [1, 2] as const) {
      const files = fs
        .readdirSync(roundDir(round))
        .filter((f) => !f.toUpperCase().startsWith("COMMON."));
      expect(files, "32 oblasts + the national file").toHaveLength(33);
      expect(files).toContain(round === 1 ? "000000z0.201" : "000000z0.301");
    }
  });

  // ⚠⚠ THE CONTROL THAT MATTERS MOST HERE, because this check was DEAD and looked alive.
  // `000000z0` sorts first by filename, so reconciling it inside a single pass compared
  // it against an empty section map and returned before asserting anything: corrupting
  // its registered / signatures / valid figures read perfectly clean. The reader now
  // defers aggregate-only files to the end. Without this test, „the reader reconciles
  // with the national totals" is a claim about code nothing exercises.
  it("refuses a NATIONAL aggregate that disagrees with the corpus", () => {
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "000000z0.201");
        const t = fs.readFileSync(f, "latin1");
        fs.writeFileSync(
          f,
          t.replace("+6824979+22443+2850650", "+7777777+8888888+9999999"),
          "latin1",
        );
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /000000z0\.201's \[AGGR\] says registered = 7777777, the sections say 6824979/,
        );
      },
    );
  });

  // ⚠ FAILS CLOSED. A missing block used to return quietly, which removed the
  // cross-check exactly when the file was damaged — measured, stripping oblast 01's two
  // blocks and duplicating a [PROT] row published a wrong national total at no error.
  it("refuses a file that has lost its [AGGR] or [MAJ] block", () => {
    for (const block of ["AGGR", "MAJ"] as const) {
      withCopyOfRound(
        1,
        (dir) => {
          const f = path.join(dir, "010000z0.201");
          const t = fs.readFileSync(f, "latin1");
          const start = t.indexOf(`[${block}]`);
          const end = t.indexOf("[END]", start) + 5;
          fs.writeFileSync(f, t.slice(0, start) + t.slice(end), "latin1");
        },
        (dir) => {
          expect(() => readEra2001Round(dir, source, 1)).toThrow(
            new RegExp(`carries no \\[${block}\\] block`),
          );
        },
      );
    }
  });

  it("refuses an oblast whose [AGGR] disagrees with its sections", () => {
    // The mutation control. Changing one published figure must be caught — without it,
    // „the reader reconciles with the source" is a claim about code nobody exercised.
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "010000z0.201");
        const t = fs.readFileSync(f, "latin1");
        // Blagoevgrad's [AGGR] valid total, 101850 → 101851.
        fs.writeFileSync(f, t.replace("+101850;", "+101851;"), "latin1");
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /\[AGGR\] says valid = 101851, the sections say 101850/,
        );
      },
    );
  });

  it("refuses an oblast whose [MAJ] disagrees with its sections", () => {
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "010000z0.201");
        const t = fs.readFileSync(f, "latin1");
        // Blagoevgrad's [MAJ] figure for ticket 01, 1174 → 1175.
        fs.writeFileSync(f, t.replace(";1174;0;1", ";1175;0;1"), "latin1");
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /\[MAJ\] says ticket 1 = 1175, the sections say 1174/,
        );
      },
    );
  });
});

describe("era2001 — places", () => {
  it("uses oblast 32 for abroad, naming a city and no country", () => {
    expect(ABROAD_PREFIX_2001).toBe("32");
    const r = read(1);
    const abroad = r.sections.filter((s) => s.abroad);
    expect(abroad).toHaveLength(134);
    expect(read(2).sections.filter((s) => s.abroad)).toHaveLength(132);
    expect(abroad.every((s) => s.abroad?.country === null)).toBe(true);
    expect(abroad.some((s) => s.abroad?.city === "гр. Сидней")).toBe(true);
  });

  // ⚠ A SECTION CAN SERVE SEVERAL SETTLEMENTS — the `[SEC]` settlement field is then
  // `+`-joined. Its ЕКАТТЕ is genuinely ambiguous, so it is left ABSENT rather than
  // resolved to whichever came first: ЕКАТТЕ is the aggregator's join key, and picking
  // one would file a whole section's votes in a village that supplied part of it.
  it("leaves a multi-settlement section without an ЕКАТТЕ", () => {
    for (const round of [1, 2] as const) {
      const multi = read(round).sections.filter((s) =>
        s.placeName.includes(" / "),
      );
      expect(multi, `round ${round}`).toHaveLength(62);
      expect(multi.every((s) => s.ekatte === undefined)).toBe(true);
      expect(
        multi.some((s) => s.placeName === "с. Марулево / с. Делвино"),
      ).toBe(true);
    }
  });

  it("accounts for every section without an ЕКАТТЕ", () => {
    // Measured, and split three ways so „261 sections have no ЕКАТТЕ" cannot be read as
    // one problem: 134 are abroad (the source publishes none), 62 serve several
    // settlements (ambiguous by construction), and 65 are domestic settlements whose own
    // [NM] row leaves the code blank — „Слънчев бряг" among them.
    const r = read(1);
    const none = r.sections.filter((s) => !s.ekatte);
    expect(none).toHaveLength(261);
    expect(none.filter((s) => s.abroad)).toHaveLength(134);
    expect(none.filter((s) => s.placeName.includes(" / "))).toHaveLength(62);
    expect(
      none.filter((s) => !s.abroad && !s.placeName.includes(" / ")),
    ).toHaveLength(65);
  });

  it("resolves a single-settlement section to its ЕКАТТЕ", () => {
    const s = read(1).sections.find((x) => x.code === "010300003")!;
    expect(s.placeName).toBe("гр. Благоевград");
    expect(s.ekatte).toBe("04279");
  });
});

describe("era2001 — the protocol", () => {
  it("maps the nine positions of a row printed here in full", () => {
    // 6;01;0100;001;813+1+347+347+0+1+1+0+346;2+148+58+12+124+2
    const s = read(1).sections.find((x) => x.code === "010100001")!;
    const p = s.protocol;
    expect(s.placeName).toBe("гр. Банско");
    expect(p.numRegisteredVoters, "1. main roll").toBe(813);
    expect(p.numAdditionalVoters, "2. supplementary roll").toBe(1);
    expect(p.totalActualVoters, "3. signatures").toBe(347);
    expect(p.numPaperBallotsFound, "4. ENVELOPES found").toBe(347);
    expect(p.numInvalidBallotsFound, "7. invalid").toBe(1);
    expect(p.numValidVotes, "9. valid").toBe(346);
    // The vote vector is positional over [PARTII]: 2, 148, 58, 12, 124, 2.
    expect(
      s.votes.sort((a, b) => a.partyNum - b.partyNum).map((v) => v.totalVotes),
    ).toEqual([2, 148, 58, 12, 124, 2]);
    expect(s.votes.reduce((a, v) => a + v.totalVotes, 0)).toBe(346);
  });

  // ⚠ т. 8 — envelopes holding several ballots for the SAME list — IS VALID, not
  // invalid. `[TOCHKI]` states the arithmetic itself („т. 7 = т. 5 + т. 6"), and folding
  // т. 8 in would move 73,546 valid votes nationally into the invalid column. This row
  // is the one that can tell the two readings apart, because its т. 8 is not zero.
  it("does not count same-list duplicate envelopes as invalid", () => {
    // 6;01;0100;005;693+1+226+226+0+0+0+19+226;2+107+44+3+67+3
    const p = read(1).sections.find((x) => x.code === "010100005")!.protocol;
    expect(p.numPaperBallotsFound, "4. envelopes").toBe(226);
    expect(p.numInvalidBallotsFound, "7. invalid — NOT 19").toBe(0);
    expect(p.numValidVotes, "9. valid").toBe(226);
    // Read the т. 8 position as invalid and this identity breaks.
    expect(p.numPaperBallotsFound! - p.numInvalidBallotsFound!).toBe(
      p.numValidVotes,
    );
  });

  // ⚠ The ticket sum and the protocol's own valid column disagree on seven sections in
  // round 1 and none in round 2 — ЦИК's own inconsistency, which the national aggregate
  // reproduces. Named rather than bounded. Plan §2.5-10.
  // ⚠ NAMED, not merely counted (plan T2.6, and both siblings do the same). A bare count
  // lets a NEW disagreement appear as long as an old one goes away — the exact
  // regression this gate exists to catch. Measured 2026-09-05 against the committed
  // round-1 tree.
  const KNOWN_RESIDUE_R1: Record<string, number> = {
    "030601078": 3,
    "091600024": 1,
    "111900019": -1,
    "122900091": -20,
    "234609006": -1,
    "244606097": 1,
    "293400081": 10,
  };

  it("disagrees with the valid column on exactly the known sections", () => {
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
    expect(residue(1)).toEqual(KNOWN_RESIDUE_R1);
    expect(Object.values(KNOWN_RESIDUE_R1).reduce((a, b) => a + b, 0)).toBe(-7);
    expect(residue(2)).toEqual({});
  });
});

describe.each([1, 2] as const)("era2001 round %i — both rounds", (round) => {
  it("leaves „никого“ absent, has no machine votes, and 9-digit codes", () => {
    const r = read(round);
    // „не подкрепям никого" did not exist before 2016, so the valid total IS the ticket
    // total here. A stored 0 would claim nobody chose it.
    expect(
      r.sections.every((s) => s.protocol.numValidNoOnePaperVotes === undefined),
    ).toBe(true);
    expect(r.sections.every((s) => s.machines === 0)).toBe(true);
    // ⚠ `isMobile` / `isShip` are FALSE because this bundle publishes no such flag at
    // all — not because it publishes one that says no. 2011 has a `П` column and 2016 a
    // form code; 2001 has neither, so „no mobile sections in 2001" is a statement this
    // corpus cannot support and nothing downstream should read it as one.
    expect(r.sections.every((s) => s.isMobile === false)).toBe(true);
    expect(r.sections.every((s) => s.isShip === false)).toBe(true);
    expect(r.sections.every((s) => /^\d{9}$/.test(s.code))).toBe(true);
    const paper = sum(r, (s) =>
      s.votes.reduce((a, v) => a + (v.paperVotes ?? 0), 0),
    );
    expect(paper).toBe(
      sum(r, (s) => s.votes.reduce((a, v) => a + v.totalVotes, 0)),
    );
  });

  it("gives every section a protocol and every ticket one entry", () => {
    const r = read(round);
    expect(new Set(r.sections.map((s) => s.code)).size).toBe(r.sections.length);
    for (const s of r.sections) {
      expect(s.votes, s.code).toHaveLength(r.tickets.length);
      expect(new Set(s.votes.map((v) => v.partyNum)).size, s.code).toBe(
        s.votes.length,
      );
    }
  });
});

describe("era2001 — refusals", () => {
  it("names COMMON when the folder has none, and says why it matters", () => {
    withCopyOfRound(
      1,
      (dir) => fs.rmSync(path.join(dir, "COMMON.201")),
      (dir) => {
        expect(() => readTickets(dir, 1)).toThrow(/no "COMMON\.\*"/);
      },
    );
  });

  it("refuses a folder published under the other round's extension", () => {
    // ⚠ Measured before the extension was mapped: handing ТУР2 to `round: 1` published
    // all 12,192 RUNOFF sections stamped round 1 and dated 2001-11-11, with every
    // internal cross-check green — each file agreed with the others, so nothing inside
    // the folder could notice.
    expect(() => readEra2001Round(roundDir(2), source, 1)).toThrow(
      /not a "COMMON\.201" — round 1 is published as "\.201"/,
    );
    expect(() => readEra2001Round(roundDir(1), source, 2)).toThrow(
      /not a "COMMON\.301"/,
    );
  });

  it("refuses a section whose settlement [NM] does not carry", () => {
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "010000z0.201");
        const t = fs.readFileSync(f, "latin1");
        fs.writeFileSync(
          f,
          t.replace("01;0100;001;6;001", "01;0100;001;6;999"),
          "latin1",
        );
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /names settlement\(s\) 999, which \[NM\].*does not carry/,
        );
      },
    );
  });

  it("refuses a [PROT] row for a section [SEC] does not carry", () => {
    withCopyOfRound(
      1,
      (dir) => {
        const f = path.join(dir, "010000z0.201");
        const t = fs.readFileSync(f, "latin1");
        fs.writeFileSync(
          f,
          t.replace("6;01;0100;001;813", "6;01;9900;001;813"),
          "latin1",
        );
      },
      (dir) => {
        expect(() => readEra2001Round(dir, source, 1)).toThrow(
          /section 019900001 appears in \[PROT\].*but not in sections/,
        );
      },
    );
  });
});
