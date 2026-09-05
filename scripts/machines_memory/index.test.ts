import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCommitted } from "../lib/assert_committed";
import {
  parseSectionRows,
  parseSectionFile,
  mergeSectionVotes,
  partyNumColumn,
  PARLIAMENT_BLOCK,
  PRESIDENT_BLOCK,
  type MachineVotes,
} from "./index";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

// ─── the presidential half of the same files ────────────────────────────────
//
// 14 Nov 2021 held two national ballots in the same sections, and ONE machine export
// covers both: `raw_data/2021_11_14/suemg/` is the joint tree, block 64 the National
// Assembly and block 256 the president. The presidential ingest therefore reads these
// very files rather than shipping a copy of them — so the block parameter, not a
// second parser, is what keeps the two tallies from drifting apart.
describe("parseSectionRows — the presidential block (256)", () => {
  const SECTION = "010100001";
  // A six-row SUBSET, verbatim, of raw_data/2021_11_14/suemg/01/010100001.zip →
  // 010100001.csv, whose block-256 section is 23 tickets plus the `99` row
  // („не подкрепям никого", not a ticket — hence 5 tickets in this subset, not 6).
  //
  // ⚠ Cross-checked against the SECOND (machine) row for this section in
  // raw_data/2021_11_14_pvr/ТУР1/votes_14.11.2021.txt, which reads
  // `…;6;99;…;15;42;…` — ticket 6 (Радев) 99 votes, ticket 15 (Герджиков) 42.
  // NOT against raw_data/2021_11_14/votes.txt: that is the PARLIAMENTARY file from
  // the same day and carries neither ticket, so following it would make this fixture
  // look fabricated.
  //
  // Ticket 2 is omitted DELIBERATELY: the real file carries it in both blocks, and
  // leaving it out of the 256 rows is what lets the "excludes the parliamentary rows"
  // test below mean something.
  const REAL_256 = [
    ["010100001", "256", "1", "1", "0"],
    ["010100001", "256", "5", "7", "0"],
    ["010100001", "256", "6", "99", "0"],
    ["010100001", "256", "15", "42", "0"],
    ["010100001", "256", "23", "2", "0"],
    ["010100001", "256", "99", "6", "0"],
  ];
  // The same file's parliamentary rows carry a SIXTH column (preference detail),
  // which is the layout the block filter exists to keep out of the tally.
  const REAL_64 = [
    ["010100001", "64", "2", "2", "101", "0"],
    ["010100001", "64", "2", "2", "102", "1"],
  ];

  it("reads the ticket votes when asked for block 256", () => {
    const res = parseSectionRows(
      [...REAL_256, ...REAL_64],
      SECTION,
      "2021_11_14",
      PRESIDENT_BLOCK,
    );
    expect(res.votes.find((v) => v.partyNum === 6)?.votes).toBe(99);
    expect(res.votes.find((v) => v.partyNum === 15)?.votes).toBe(42);
    expect(res.votes.find((v) => v.partyNum === 5)?.votes).toBe(7);
  });

  it('excludes 99 — that is „не подкрепям никого", not a ticket', () => {
    const res = parseSectionRows(
      REAL_256,
      SECTION,
      "2021_11_14",
      PRESIDENT_BLOCK,
    );
    expect(res.votes.find((v) => v.partyNum === 99)).toBeUndefined();
    expect(res.votes).toHaveLength(5);
  });

  it("excludes the parliamentary rows sharing the file", () => {
    const res = parseSectionRows(
      [...REAL_256, ...REAL_64],
      SECTION,
      "2021_11_14",
      PRESIDENT_BLOCK,
    );
    // Ticket 2 appears ONLY in the block-64 rows here; reading it would mean the
    // block filter had stopped discriminating.
    expect(res.votes.find((v) => v.partyNum === 2)).toBeUndefined();
  });

  // The mirror of the above, and the reason the parameter defaults rather than being
  // required: every existing caller must keep counting the parliament and nothing else.
  it("defaults to the parliamentary block, so no existing caller changes", () => {
    const rows = [...REAL_256, ...REAL_64];
    const def = parseSectionRows(rows, SECTION, "2021_11_14");
    const explicit = parseSectionRows(
      rows,
      SECTION,
      "2021_11_14",
      PARLIAMENT_BLOCK,
    );
    expect(def).toEqual(explicit);
    // …and that is the PARLIAMENTARY answer — ticket 2 from the block-64 rows, first
    // occurrence kept. Asserting the CONTENT rather than the absence of ticket 6
    // matters: `expect(undefined).not.toBe(99)` would also pass against an
    // implementation that returned nothing at all.
    expect(def.votes).toEqual([{ partyNum: 2, votes: 2 }]);
  });
});

describe("parseSectionRows — a block the file cannot discriminate", () => {
  // Before 2021-11 a flash export carried ONE ballot and no block column, so there is
  // nothing to filter on. Answering such a request with the file's rows would publish
  // the parliamentary tally under a presidential label — and four of the five _pvr
  // cycles are pre-shift dates, so this is the branch a cycle-iterating reader hits.
  const preShift = [
    ["s", "5", "111", "0"],
    ["s", "7", "222", "0"],
  ];

  it("refuses a non-default block on a single-ballot export", () => {
    expect(() =>
      parseSectionRows(preShift, "s", "2021_07_11", PRESIDENT_BLOCK),
    ).toThrow(/no election-type block column/i);
  });

  it("still reads the parliamentary tally from the same file", () => {
    const res = parseSectionRows(preShift, "s", "2021_07_11", PARLIAMENT_BLOCK);
    expect(res.votes).toEqual([
      { partyNum: 5, votes: 111 },
      { partyNum: 7, votes: 222 },
    ]);
  });
});

// The one line the presidential reader depends on is `parseSectionRows(result,
// section, date, block)` inside parseSectionFile — and deleting `block` from it
// silently reverts every presidential read to the parliamentary tally while every
// pure-function test above still passes. This reads the committed joint export, so
// it needs no network and no database.
// ⚠ ASSERTED, NOT SKIPPED. The joint export is COMMITTED and CI does a full checkout, so
// an absent zip is a broken working copy rather than a supported state.
assertCommitted("raw_data/2021_11_14/suemg/01/010100001.zip");

describe("parseSectionFile — threads the block through to the parser", () => {
  const ZIP = path.join(
    PROJECT_ROOT,
    "raw_data/2021_11_14/suemg/01/010100001.zip",
  );
  const SECTION = "010100001";

  it("reads the presidential tally from the joint export", async () => {
    const res = await parseSectionFile(
      ZIP,
      SECTION,
      "2021_11_14",
      PRESIDENT_BLOCK,
    );
    expect(res.votes.find((v) => v.partyNum === 6)?.votes).toBe(99);
    expect(res.votes.find((v) => v.partyNum === 15)?.votes).toBe(42);
    expect(res.votes).toHaveLength(23);
    expect(res.votes.find((v) => v.partyNum === 99)).toBeUndefined();
  });

  it("defaults to the parliamentary tally, a DIFFERENT answer", async () => {
    const parl = await parseSectionFile(ZIP, SECTION, "2021_11_14");
    expect(parl.votes.find((v) => v.partyNum === 2)?.votes).toBe(2);
    // Ticket 6 is presidential-only; its 99 appearing here would mean the block
    // never reached the parser.
    expect(parl.votes.find((v) => v.partyNum === 6)?.votes).not.toBe(99);
    expect(parl.votes).not.toHaveLength(23);
  });
});
