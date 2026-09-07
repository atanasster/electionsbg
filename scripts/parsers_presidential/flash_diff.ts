// „Разлика с флаш паметта" for a presidential round — the machines' own СУЕМГ records against
// the protocol's recorded machine votes, per ticket.
//
// ⚠ THE TWO NUMBERS COME FROM DIFFERENT DOCUMENTS AND THAT IS THE ENTIRE POINT. The protocol
// is what the section commission WROTE DOWN; the flash export is what the machine ITSELF
// recorded. They should agree, and where they do not the gap is the finding. Neither side is
// derived from the other, so this is a cross-check rather than a restatement.
//
// ⚠⚠ ONLY 2021 CAN HAVE THIS, AND „MACHINE VOTING" DOES NOT IMPLY IT. `sources.ts` declares
// `flashRecords` per round and only the two 2021 rounds carry one. 2016 is the case that makes
// the distinction: machines counted votes in 500 of 12,340 round-1 sections and ЦИК never
// published their records, so a reader who inferred availability from `machineVoting` would
// build a comparison against nothing.
//
// ⚠ ROUND 1 READS THE PARLIAMENTARY TREE, and that is correct rather than a slip. The two
// ballots were held the same day on the same machines, so ONE export carries both,
// discriminated by the block column — 64 parliament, 256 president. Verified against a real
// archive: block 256 yields exactly the round's 23 ticket rows (164 votes in the probed
// section) where block 64 yields 27 party rows (167).
//
// ⚠⚠ THE COMPARISON IS RESTRICTED TO SECTIONS PRESENT IN BOTH, and skipping that turns a
// data-coverage hole into a fabricated discrepancy. Flash shards are missing for some sections
// — `machines_memory`'s own header records that block totals „stay under" the protocol where
// they are — so counting a flash-less section as flash 0 charges its entire machine count to
// the difference and publishes it as a gap between two documents. The coverage is reported
// beside the figures so a reader can see what the comparison is over.

import fs from "fs";
import path from "path";
import {
  PRESIDENT_BLOCK,
  parseSectionFile,
  type MachineVotes,
} from "../machines_memory";
import { PRESIDENTIAL_SOURCES } from "./sources";

/** ⚠ THE FLASH ID CARRIES A MACHINE SUFFIX — `010100001-1` — and the protocol's does not.
 *  Joining on the raw id matches nothing; joining on the stripped id must also SUM, because a
 *  section with two machines has two archives and the protocol has one row. */
const sectionCodeOf = (flashId: string): string => flashId.split("-")[0];

export type FlashTicketRow = {
  number: number;
  /** From the section protocols — what the commission wrote down. */
  machineVotes: number;
  /** From the machines' own flash export. */
  flashVotes: number;
};

export type PresidentialFlashDiff = {
  cycle: string;
  round: 1 | 2;
  /** ⚠ RENDERED BESIDE THE FIGURES, never omitted — see the header. */
  coverage: {
    /** Sections the protocol records machine votes for. */
    protocolSections: number;
    /** Of those, the ones the flash export also covers — the comparison's own basis. */
    comparedSections: number;
    /** Machine votes in protocol sections the flash export does not reach. */
    uncomparedMachineVotes: number;
  };
  tickets: FlashTicketRow[];
};

/** Per-section per-ticket machine votes, out of the round's published section shards. */
const protocolMachineVotes = (
  cycleDir: string,
  round: 1 | 2,
): Map<string, Map<number, number>> => {
  const dir = path.join(cycleDir, `tur${round}`, "sections");
  const out = new Map<string, Map<number, number>>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as {
      code: string;
      votes: { partyNum: number; machineVotes?: number }[];
    }[];
    for (const r of rows) {
      const per = new Map<number, number>();
      for (const v of r.votes) per.set(v.partyNum, v.machineVotes ?? 0);
      out.set(String(r.code), per);
    }
  }
  return out;
};

/** Walk a round's СУЕМГ tree, keeping only the PRESIDENTIAL block. */
const flashVotes = async (
  treeDir: string,
): Promise<Map<string, Map<number, number>>> => {
  const out = new Map<string, Map<number, number>>();
  for (const region of fs.readdirSync(treeDir, { withFileTypes: true })) {
    if (!region.isDirectory()) continue;
    const rd = path.join(treeDir, region.name);
    for (const entry of fs.readdirSync(rd, { withFileTypes: true })) {
      if (entry.isDirectory() || !entry.name.endsWith(".zip")) continue;
      const id = entry.name.replace(/\.zip$/, "");
      let parsed: MachineVotes;
      try {
        parsed = await parseSectionFile(
          path.join(rd, entry.name),
          id,
          "2021_11_14",
          PRESIDENT_BLOCK,
        );
      } catch {
        // ⚠ A SINGLE UNREADABLE ARCHIVE IS NOT A FAILED ROUND. It is one section absent from
        // the comparison, which `coverage` already reports; aborting would discard 12,000
        // readable ones over it.
        continue;
      }
      const code = sectionCodeOf(id);
      const per = out.get(code) ?? new Map<number, number>();
      for (const v of parsed.votes)
        per.set(v.partyNum, (per.get(v.partyNum) ?? 0) + v.votes);
      out.set(code, per);
    }
  }
  return out;
};

export const buildPresidentialFlashDiff = async (opts: {
  publicFolder: string;
  cycle: string;
  round: 1 | 2;
  stringify: (o: object) => string;
}): Promise<PresidentialFlashDiff | null> => {
  const { publicFolder, cycle, round, stringify } = opts;
  const src = PRESIDENTIAL_SOURCES[cycle];
  const tree = src?.rounds[round]?.flashRecords;
  // Absent means the era published none — never „we did not look". See the header.
  if (!tree || !fs.existsSync(tree)) return null;

  const cycleDir = path.join(publicFolder, cycle);
  const protocol = protocolMachineVotes(cycleDir, round);
  if (protocol.size === 0) return null;
  const flash = await flashVotes(tree);

  const tickets = new Map<number, FlashTicketRow>();
  let comparedSections = 0;
  let uncomparedMachineVotes = 0;
  for (const [code, per] of protocol) {
    const f = flash.get(code);
    if (!f) {
      for (const n of per.values()) uncomparedMachineVotes += n;
      continue;
    }
    comparedSections += 1;
    for (const [num, m] of per) {
      const row = tickets.get(num) ?? {
        number: num,
        machineVotes: 0,
        flashVotes: 0,
      };
      row.machineVotes += m;
      row.flashVotes += f.get(num) ?? 0;
      tickets.set(num, row);
    }
    // A ticket the flash export names and the protocol does not is still a real reading.
    for (const [num, v] of f)
      if (!per.has(num)) {
        const row = tickets.get(num) ?? {
          number: num,
          machineVotes: 0,
          flashVotes: 0,
        };
        row.flashVotes += v;
        tickets.set(num, row);
      }
  }

  const out: PresidentialFlashDiff = {
    cycle,
    round,
    coverage: {
      protocolSections: protocol.size,
      comparedSections,
      uncomparedMachineVotes,
    },
    tickets: [...tickets.values()].sort(
      (a, b) => b.machineVotes - a.machineVotes,
    ),
  };
  const dest = path.join(cycleDir, `tur${round}`, "flash.json");
  fs.writeFileSync(dest, stringify(out), "utf-8");
  return out;
};
