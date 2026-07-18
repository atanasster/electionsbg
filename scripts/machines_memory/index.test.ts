import { describe, it, expect } from "vitest";
import {
  parseSectionRows,
  mergeSectionVotes,
  partyNumColumn,
  PARLIAMENT_BLOCK,
  type MachineVotes,
} from "./index";

// A post-2021 parliamentary suemg row: `section;64;partyNum;votes;<pref>`.
// row[1] = election-type block (64 = parliament); pCol = 2, so party is row[2]
// and votes live at row[3] (pCol+1).
const row = (section: string, partyNum: number, votes: string | number) => [
  section,
  PARLIAMENT_BLOCK,
  String(partyNum),
  String(votes),
  "0",
];

// A row from a DIFFERENT ballot held the same day (president=256 / EU=128),
// which must be excluded from the parliamentary tally.
const otherBlockRow = (
  section: string,
  block: string,
  partyNum: number,
  votes: string | number,
) => [section, block, String(partyNum), String(votes), "0"];

describe("partyNumColumn", () => {
  it("uses column 1 up to and including the 2021-07-11 cycle", () => {
    expect(partyNumColumn("2021_07_11")).toBe(1);
    expect(partyNumColumn("2009_07_05")).toBe(1);
  });
  it("shifts to column 2 for later cycles", () => {
    expect(partyNumColumn("2021_11_14")).toBe(2);
    expect(partyNumColumn("2026_04_19")).toBe(2);
  });
});

describe("parseSectionRows — column & validity (FINDING-003)", () => {
  const SECTION = "010100001-1";

  it("reads votes from row[pCol+1], not a neighbouring column", () => {
    const res = parseSectionRows(
      [row(SECTION, 5, 111), row(SECTION, 6, 42)],
      SECTION,
      "2021_11_14",
    );
    expect(res.votes).toEqual([
      { partyNum: 5, votes: 111 },
      { partyNum: 6, votes: 42 },
    ]);
  });

  it("drops the trailing machine suffix from the stored section id", () => {
    const res = parseSectionRows([row(SECTION, 1, 3)], SECTION, "2021_11_14");
    expect(res.section).toBe("010100001");
  });

  it("skips a row whose votes cell (row[pCol+1]) is non-numeric — never stores NaN", () => {
    const res = parseSectionRows(
      [row(SECTION, 5, "n/a"), row(SECTION, 6, 7)],
      SECTION,
      "2021_11_14",
    );
    // The bad row is dropped; only the valid party survives, with a real number.
    expect(res.votes).toEqual([{ partyNum: 6, votes: 7 }]);
    expect(res.votes.every((v) => Number.isFinite(v.votes))).toBe(true);
  });

  it("skips the aggregate party 99 and non-numeric party numbers", () => {
    const res = parseSectionRows(
      [
        row(SECTION, 99, 500),
        [SECTION, PARLIAMENT_BLOCK, "x", "9", "0"],
        row(SECTION, 3, 8),
      ],
      SECTION,
      "2021_11_14",
    );
    expect(res.votes).toEqual([{ partyNum: 3, votes: 8 }]);
  });

  it("counts ONLY the parliamentary block (64), excluding president/EU rows", () => {
    const res = parseSectionRows(
      [
        row(SECTION, 1, 10), // parliament
        otherBlockRow(SECTION, "256", 2, 999), // president — must be ignored
        otherBlockRow(SECTION, "128", 3, 888), // EU parliament — must be ignored
        row(SECTION, 4, 20), // parliament
      ],
      SECTION,
      "2021_11_14",
    );
    expect(res.votes).toEqual([
      { partyNum: 1, votes: 10 },
      { partyNum: 4, votes: 20 },
    ]);
  });

  it("does not let a same-partyNum president row shadow the parliament vote", () => {
    // President block appears FIRST for partyNum 5 — it must not be the value
    // stored, nor block the later parliament row from counting.
    const res = parseSectionRows(
      [otherBlockRow(SECTION, "256", 5, 999), row(SECTION, 5, 12)],
      SECTION,
      "2021_11_14",
    );
    expect(res.votes).toEqual([{ partyNum: 5, votes: 12 }]);
  });

  it("keeps the first occurrence of a duplicated party within one section", () => {
    const res = parseSectionRows(
      [row(SECTION, 4, 10), row(SECTION, 4, 999)],
      SECTION,
      "2021_11_14",
    );
    expect(res.votes).toEqual([{ partyNum: 4, votes: 10 }]);
  });

  it("honours the pre-2021 column layout (pCol=1)", () => {
    // Legacy row: `section;partyNum;votes;...`
    const legacy = ["s", "5", "111", "0"];
    const res = parseSectionRows([legacy], "s", "2021_07_11");
    expect(res.votes).toEqual([{ partyNum: 5, votes: 111 }]);
  });

  it("throws when a row's section id does not match the file", () => {
    expect(() =>
      parseSectionRows([row("999999999-1", 1, 5)], SECTION, "2021_11_14"),
    ).toThrow(/Invalid section file/);
  });
});

describe("mergeSectionVotes — cross-shard dedup (FINDING-002)", () => {
  it("appends a genuinely new section", () => {
    const all: MachineVotes[] = [];
    mergeSectionVotes(all, {
      section: "S1",
      votes: [{ partyNum: 1, votes: 10 }],
    });
    mergeSectionVotes(all, {
      section: "S2",
      votes: [{ partyNum: 1, votes: 4 }],
    });
    expect(all.map((s) => s.section)).toEqual(["S1", "S2"]);
  });

  it("SUMS a repeated section instead of duplicating it (the double-count bug)", () => {
    const all: MachineVotes[] = [
      {
        section: "S1",
        votes: [
          { partyNum: 1, votes: 10 },
          { partyNum: 2, votes: 3 },
        ],
      },
    ];
    // Same section from another machine shard / region folder.
    mergeSectionVotes(all, {
      section: "S1",
      votes: [
        { partyNum: 1, votes: 5 },
        { partyNum: 3, votes: 8 },
      ],
    });
    // Still ONE S1 entry — not two.
    expect(all).toHaveLength(1);
    expect(all[0].votes).toEqual([
      { partyNum: 1, votes: 15 }, // 10 + 5 summed, not double-counted
      { partyNum: 2, votes: 3 },
      { partyNum: 3, votes: 8 }, // new party folded in
    ]);
  });

  it("does not inflate the total when the same shard is merged twice", () => {
    const all: MachineVotes[] = [];
    const shard = (): MachineVotes => ({
      section: "S1",
      votes: [{ partyNum: 1, votes: 100 }],
    });
    mergeSectionVotes(all, shard());
    const beforeLen = all.length;
    // A duplicate section id must extend the existing entry, keeping length 1.
    mergeSectionVotes(all, shard());
    expect(all).toHaveLength(beforeLen);
    expect(all[0].votes).toEqual([{ partyNum: 1, votes: 200 }]);
  });
});
