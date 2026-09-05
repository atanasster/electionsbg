// The committed catalogue still equals what the corpus produces.
//
// ⚠ THIS IS WHAT MAKES „DERIVED" TRUE. `presidential_elections.json` is committed and
// ships in the entry bundle, so between regenerations it is an ordinary hand-editable
// file: nothing else would notice a row whose `decidedInRound` says 1, or whose winner is
// the runner-up, and every consumer would render it. `presidentialCatalogue.test.ts`
// checks the SHAPE without the corpus; this checks the CONTENT against it.
//
// Plan: docs/plans/presidential-elections-v1.md T4.1.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCommitted } from "../lib/assert_committed";
import { PRESIDENT_BLOCK, parseSectionFile } from "../machines_memory";
import {
  CATALOGUE_PATH,
  buildCatalogue,
  flashTreeHasRecords,
  roundCapabilities,
} from "./build_catalogue";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import { COMMITTED_ROUND_DIRS, corpusRound, corpusTally } from "./testCorpus";

assertCommitted(
  "src/data/json/presidential_elections.json",
  ...COMMITTED_ROUND_DIRS,
);

describe("presidential catalogue", () => {
  it("matches the corpus byte for byte", () => {
    const built = `${JSON.stringify(buildCatalogue(), null, 2)}\n`;
    expect(
      fs.readFileSync(CATALOGUE_PATH, "utf8"),
      "src/data/json/presidential_elections.json is stale — regenerate it with " +
        "`npx tsx scripts/parsers_presidential/build_catalogue.ts --write`",
    ).toBe(built);
  });

  it("declares a flash tree exactly where one was published", () => {
    // ⚠ BOTH DIRECTIONS, and the second is a SCAN rather than two pins. A declared path
    // that no longer exists publishes „flash records were released" against nothing; an
    // undeclared tree that does exist silently drops a capability a surface would have
    // offered. Neither shows up in a vote figure. The second arm is vacuous today —
    // exactly one flash tree sits under a `_pvr` cycle folder and it is declared — which
    // is why it is worth pinning while it is still green.
    for (const source of Object.values(PRESIDENTIAL_SOURCES)) {
      for (const round of [1, 2] as const) {
        const declared = source.rounds[round].flashRecords;
        if (declared) {
          expect(
            flashTreeHasRecords(declared),
            `${source.cycle} round ${round} declares ${declared}, which holds no archives`,
          ).toBe(true);
          continue;
        }
        const own = `raw_data/${source.cycle}/${roundFolderName(round)}/suemg`;
        expect(
          flashTreeHasRecords(own),
          `${source.cycle} round ${round} has ${own} on disk but declares no flashRecords`,
        ).toBe(false);
      }
    }
    // The one cycle that has them, and the one that has machines without them.
    expect(PRESIDENTIAL_SOURCES["2021_11_14_pvr"].rounds[1].flashRecords).toBe(
      "raw_data/2021_11_14/suemg",
    );
    expect(
      PRESIDENTIAL_SOURCES["2016_11_06_pvr"].rounds[1].flashRecords,
    ).toBeUndefined();
  });

  it("reads an absent, empty or archive-less tree as no records", () => {
    // The negative controls for the walk. ⚠ In a TEMP dir, not under `scripts/`: the
    // probe path is absolute, so it resolves the same way for `mkdir` (which uses
    // `process.cwd()`) and for `flashTreeHasRecords` (which uses the module's own repo
    // root). A relative probe coincides only while Vitest runs from the project root, and
    // if the two ever diverge the directory is created where the function never looks —
    // so this control would pass as a second spelling of „that path does not exist".
    expect(flashTreeHasRecords("raw_data/definitely-not-here")).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-flash-"));
    try {
      fs.mkdirSync(path.join(dir, "01"), { recursive: true });
      expect(flashTreeHasRecords(dir)).toBe(false);
      // ⚠ The case that actually occurs: `raw_data/2021_11_14/suemg/.DS_Store` exists on
      // macOS, and so does one a directory down. „At least one file" would call a tree
      // that has lost all 11,859 archives „published".
      fs.writeFileSync(path.join(dir, "01", ".DS_Store"), "");
      expect(flashTreeHasRecords(dir)).toBe(false);
      // …and the positive control, so the two above are not satisfied by a predicate that
      // has stopped finding anything at all.
      fs.writeFileSync(path.join(dir, "01", "010100001.zip"), "");
      expect(flashTreeHasRecords(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the presidential block inside a declared archive", async () => {
    // ⚠ THIS IS WHAT MAKES ROUND 1 OF 2021 DEFENSIBLE. It declares the PARLIAMENTARY
    // flash tree, on the argument that one export carries both ballots discriminated by
    // the block column — and a directory walk returns `true` just as happily for a tree of
    // parliament-only archives. So open one and read block 256 out of it.
    const cycle = "2021_11_14_pvr";
    const tree = PRESIDENTIAL_SOURCES[cycle].rounds[1].flashRecords;
    expect(tree, `${cycle} round 1 declares no flash tree`).toBeDefined();
    const dir = path.join(tree!, "01");
    const zip = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".zip"))
      .sort()[0];
    const votes = await parseSectionFile(
      path.join(dir, zip),
      zip.replace(/\.zip$/i, ""),
      // The column layout is keyed on the PARLIAMENTARY folder date, which is what this
      // tree is; `partyNumColumn` puts anything after 2021_07_11 on the block layout.
      "2021_11_14",
      PRESIDENT_BLOCK,
    );
    // ⚠ Not „some rows came back" — the parliamentary block satisfies that too. Round 1
    // had 23 tickets, so the presidential block yields exactly 23 rows and the
    // parliamentary one (27 parties) cannot.
    expect(
      votes.votes.length,
      `${zip}: block ${PRESIDENT_BLOCK} does not carry the round's ticket rows — either ` +
        `this is not the joint export, or the block code has moved`,
    ).toBe(corpusRound(cycle, 1).tickets.length);
  });

  it("derives machineVoting from votes, and the flags still discriminate", () => {
    // ⚠ The mutation check. „Every round agrees with the catalogue" is satisfied by a
    // `roundCapabilities` that returns all-false, so this asserts the function separates
    // the eras it is asked to separate — and that the flash flag is the DECLARED tree
    // rather than anything read out of the votes, by asking for one that is not there.
    const r2016 = roundCapabilities(
      corpusRound("2016_11_06_pvr", 1),
      corpusTally("2016_11_06_pvr", 1),
      undefined,
    );
    const r2011 = roundCapabilities(
      corpusRound("2011_10_23_pvr", 1),
      corpusTally("2011_10_23_pvr", 1),
      undefined,
    );
    expect(r2016.machineVoting).toBe(true);
    expect(r2016.noneOfTheAbove).toBe(true);
    expect(r2011.machineVoting).toBe(false);
    expect(r2011.noneOfTheAbove).toBe(false);
    const withTree = roundCapabilities(
      corpusRound("2021_11_14_pvr", 2),
      corpusTally("2021_11_14_pvr", 2),
      "raw_data/2021_11_14_pvr/ТУР2/suemg",
    );
    const withoutTree = roundCapabilities(
      corpusRound("2021_11_14_pvr", 2),
      corpusTally("2021_11_14_pvr", 2),
      undefined,
    );
    expect(withTree.flashRecords).toBe(true);
    expect(withoutTree.flashRecords).toBe(false);
  });

  it("names the winner of the round that decided the cycle", () => {
    // ⚠ Against the RANKING rather than against the catalogue's own field, which would
    // compare the file with itself. Every cycle here went to a runoff, so the deciding
    // round is round 2 in all five — and the round-1 leader is the same person in all
    // five too, which is exactly why reading the wrong round would look correct.
    for (const entry of buildCatalogue()) {
      const deciding = corpusRound(entry.name, entry.decidedInRound);
      const names = new Set(deciding.tickets.map((t) => t.president));
      expect(
        names.has(entry.winnerTicket.president),
        `${entry.name}: ${entry.winnerTicket.president} did not stand in round ` +
          `${entry.decidedInRound}`,
      ).toBe(true);
      const ticket = deciding.tickets.find(
        (t) => t.number === entry.winnerTicket.number,
      );
      expect(ticket?.president).toBe(entry.winnerTicket.president);
      expect(ticket?.vicePresident).toBe(entry.winnerTicket.vicePresident);
    }
  });
});
