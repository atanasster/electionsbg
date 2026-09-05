import fs from "fs";
import { parse } from "csv-parse";
import unzipper from "unzipper";

export type MachineVotes = {
  section: string;
  votes: { partyNum: number; votes: number }[];
};

// Column of the party number within a suemg CSV row. The machine export format
// changed after the 2021-07-11 cycle: the leading section id gained an extra
// column (row[1] became an election-type block code), shifting party/votes one
// to the right. Votes always live at pCol+1.
export const partyNumColumn = (date: string): number =>
  date <= "2021_07_11" ? 1 : 2;

// Election-type block codes. From the 2021-11 format onward, one machine's flash
// export interleaves every ballot held that day, discriminated by row[1]: 64 =
// national parliament, 256 = president, 128 = EU parliament. On multi-election days
// (pres+parl in 2021-11, EU+national in 2024-06) counting all blocks conflates two
// elections AND misreads the preference-detail layout, inflating the tally past the
// electorate — so a read keeps exactly ONE block. Validated against the protocol's
// numValidMachineVotes: block-64 totals track it within noise where flash coverage
// is complete, and stay under it where flash shards are missing.
export const PARLIAMENT_BLOCK = "64" as const;

// ⚠ THE SAME FILES CARRY THE PRESIDENTIAL BALLOT, and this is why the presidential
// ingest needs no machine records of its own for 14 Nov 2021: `raw_data/2021_11_14/
// suemg/` IS the joint export, and block 256 is the ПВР half of it. Reading it needs
// the same column shift (`partyNumColumn`), the same `99` exclusion — that is „не
// подкрепям никого", not a ticket — and the same first-occurrence rule, so the reader
// is this one with a different block rather than a copy that can drift from it.
// See docs/plans/presidential-elections-v1.md §1.1.
export const PRESIDENT_BLOCK = "256" as const;

// ⚠ `as const` on both is load-bearing: `typeof PARLIAMENT_BLOCK` narrows to the
// literal "64" only while the const carries no widening annotation. Written as
// `const PARLIAMENT_BLOCK: string = "64"` the union below silently collapses to
// `string`, every call site keeps compiling, and a typo like "265" — which returns an
// EMPTY tally rather than an error — stops being a compile error.
//
// 128 (EU parliament) has no constant because nothing reads it yet; adding one is all
// a 2024-06 EU reader would need, and it widens this union rather than working around
// it.
export type MachineBlock = typeof PARLIAMENT_BLOCK | typeof PRESIDENT_BLOCK;

// Parse the already-CSV-split rows of ONE section's machine file into its
// per-party vote tallies. Pure — no IO — so the column/validity contract is
// unit-testable. `section` is the raw file/section id (e.g. "010100001-1");
// the stored `section` drops the trailing "-N" machine suffix.
//
// A row counts only when it belongs to the parliamentary block (post-2021-07
// formats) and the party number (row[pCol]) AND the votes cell (row[pCol+1] —
// the value we actually store) both parse as numbers. Guarding the real votes
// column, not a neighbouring one, keeps a non-numeric votes cell from being
// stored as NaN (fixed: the guard used to test row[pCol+3]).
export const parseSectionRows = (
  rows: string[][],
  section: string,
  date: string,
  block: MachineBlock = PARLIAMENT_BLOCK,
): MachineVotes => {
  const sectionParts = section.split("-");
  const sectionVotes: MachineVotes = {
    section: sectionParts[0],
    votes: [],
  };
  const pCol = partyNumColumn(date);
  // Older single-ballot exports (pCol=1) have no block column — row[1] is the
  // party number itself — so block filtering only applies once row[1] is a code.
  const hasBlockColumn = pCol === 2;
  // ⚠ REFUSE rather than silently downgrade. While the block was a module constant,
  // `hasBlockColumn === false` correctly meant "this file holds one ballot and it is
  // the one we want". As a parameter it can be ASKED for something the file cannot
  // discriminate, and answering anyway would return the parliamentary rows under a
  // presidential label — the silent-wrong-answer shape. It is aimed at the
  // presidential reader specifically: four of the five `_pvr` cycles predate the
  // column, so a reader iterating them passes exactly the dates that trip this.
  if (!hasBlockColumn && block !== PARLIAMENT_BLOCK) {
    throw new Error(
      `machines_memory: the ${date} flash export carries no election-type block ` +
        `column, so block ${block} cannot be read from it (single-ballot format)`,
    );
  }
  for (const row of rows) {
    if (hasBlockColumn && row[1] !== block) {
      continue;
    }
    const partyNum = parseInt(row[pCol]);
    if (
      !isNaN(partyNum) &&
      !isNaN(parseInt(row[pCol + 1])) &&
      partyNum !== 99 &&
      sectionVotes.votes.find((v) => v.partyNum === partyNum) === undefined
    ) {
      const sectionNum = row[0];

      if (sectionNum !== section) {
        throw new Error(`Invalid section file: ${sectionNum} !== ${section}`);
      }
      const votes = parseInt(row[pCol + 1]);
      sectionVotes.votes.push({
        partyNum,
        votes,
      });
    }
  }
  return sectionVotes;
};

// Fold one section's votes into the running list. When the section already
// exists (the same section id can appear across region folders / machine
// shards) its votes are SUMMED into the existing entry; only a genuinely new
// section is appended. Appending unconditionally would duplicate the section
// and double-count its votes (fixed).
export const mergeSectionVotes = (
  allSections: MachineVotes[],
  sectionVotes: MachineVotes,
): void => {
  const existing = allSections.find((s) => s.section === sectionVotes.section);
  if (existing) {
    sectionVotes.votes.forEach((vote) => {
      const v = existing.votes.find((e) => e.partyNum === vote.partyNum);
      if (v) {
        v.votes += vote.votes;
      } else {
        existing.votes.push(vote);
      }
    });
  } else {
    allSections.push(sectionVotes);
  }
};

export const parseSectionFile = async (
  zipFileName: string,
  section: string,
  date: string,
  block: MachineBlock = PARLIAMENT_BLOCK,
): Promise<MachineVotes> => {
  const result: string[][] = [];

  const zipContent = await unzipper.Open.file(zipFileName);
  const csvFile = zipContent.files.find((f) => f.path === `${section}.csv`);
  if (!csvFile) {
    throw new Error("Error reading zip file: " + zipFileName);
  }
  return new Promise((resolve) => {
    csvFile
      .stream()
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data: string[]) => {
        result.push(data);
      })
      .on("end", () => {
        resolve(parseSectionRows(result, section, date, block));
      });
  });
};

/**
 * Walk one election's `suemg/` tree and write its `suemg.json`.
 *
 * @param inFolder - The `raw_data` root, NOT one election's folder.
 * @param date - The election folder name (`"2021_11_14"`); also selects the column
 *   layout via `partyNumColumn`.
 * @param stringify - The pipeline's shared serialiser (pretty in dev, compact under
 *   `--prod`).
 * @returns `false` when the election has no `suemg/` tree — an ordinary state, not a
 *   failure, since most cycles predate machine voting — and `true` once the file is
 *   written. The sole caller discards it.
 *
 * ⚠ PARLIAMENTARY BY CONSTRUCTION, and deliberately NOT parameterised by block: it
 * writes to the fixed `suemg.json` that `parseVotes` reads, so a presidential caller
 * pointed at it would overwrite the parliamentary machine tally with ticket votes
 * under the same filename. The presidential reader composes `parseSectionFile(...,
 * PRESIDENT_BLOCK)` itself and owns its own output path.
 */
export const parseMachinesFlashMemory = async (
  inFolder: string,
  date: string,
  stringify: (o: object) => string,
) => {
  const year = date;
  const sueFolder = `${inFolder}/${year}/suemg`;
  if (!fs.existsSync(sueFolder)) {
    return false;
  }
  const allSections: MachineVotes[] = [];
  const sueRegionFolders = fs.readdirSync(sueFolder, { withFileTypes: true });
  for (const region of sueRegionFolders) {
    if (region.isDirectory()) {
      const regionFolderName = `${sueFolder}/${region.name}`;
      const sectionZipFiles = fs.readdirSync(regionFolderName, {
        withFileTypes: true,
      });
      for (const zipFile of sectionZipFiles) {
        if (!zipFile.isDirectory()) {
          const fNameParts = zipFile.name.split(".");
          if (fNameParts.length === 2 && fNameParts[1] === "zip") {
            const section = fNameParts[0];
            const zipFileName = `${regionFolderName}/${zipFile.name}`;

            const sectionVotes = await parseSectionFile(
              zipFileName,
              section,
              date,
            );
            mergeSectionVotes(allSections, sectionVotes);
          }
        }
      }
    }
  }
  const json = stringify(allSections);
  const sueFileName = `${inFolder}/${year}/suemg.json`;
  fs.writeFileSync(sueFileName, json, "utf8");
  console.log("Successfully added file ", sueFileName);
  return true;
};
