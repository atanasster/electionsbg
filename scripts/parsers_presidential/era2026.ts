// The 2026 reader — ЦИК's current export, published under `opendata/` rather than
// under `tur1/`.
//
// FILES (`raw_data/2026_10_25_pvr/ТУРn/Актуализирана база данни/`): `cik_parties`,
// `cik_candidates`, `sections`, `protocols`, `votes`. UTF-8, `;`-separated. The flash
// records sit BESIDE that folder, in `ТУРn/suemg/`, which is why the round folder keeps
// the archive's own layout instead of hoisting the text files to its root.
//
// ⚠ THREE THINGS CHANGED AGAINST 2021, and each one silently breaks the 2021 reader
// rather than failing it:
//
//   • `votes` is ONE row per section, not one per protocol, and carries no form column:
//     `code;adminId;` then, per ticket, `№;total;paper;machine;machine 1;machine 2`. The
//     paper/machine split is the source's own, so no form-to-medium mapping is needed —
//     and none must be applied, or every machine vote is counted twice.
//   • The form numbers were RE-ASSIGNED. 26 was „ХМ" (paper + machine) in 2021 and is
//     now „КР-Х" (paper + control receipts from failed machines); 27 and 31 are gone.
//   • The protocol fields MOVED. 2021's index 7 was the registered count; here it is the
//     unused ballots. Each form's fields are taken from the round's own readme below.
//
// The forms and what each one carries (measured over round 1, 12,719 sections):
//
//   24 Х      paper only               │ electorate + paper box          2,733
//   25 М      machine only             │ electorate; votes in its 32 rows 9,321
//   26 КР-Х   paper + control receipts │ electorate + box + 9.x/11.x         52
//   28 ХЧ     abroad, paper            │ electorate + paper box            371
//   29 МЧ     abroad, machine only     │ electorate; votes in its 41 rows   240
//   30 КРЧ-Х  abroad, as 26            │                                     2
//   32 / 41   one row per machine      │ fields 26-28
//
// Exactly one of {24, 25, 26, 28, 29, 30} per section — 12,719, the section count.
//
// ⚠ „НЕ ПОДКРЕПЯМ НИКОГО" IS NOT A TICKET, exactly as in 2021: it is protocol field
// 7.2 / 9.3 / 11.3 / 28, it belongs in the VALID total, and never in the ranking.

import fs from "node:fs";
import path from "node:path";
import { num, readBundleFile } from "./readerKit";
import type { PresidentialEncoding } from "./encoding";
import {
  addTicketVotes,
  emptyProtocol,
  normaliseEkatte,
  type PresidentialRound,
  type PresidentialSection,
} from "./types";
import { readTickets } from "./era2021";
import { roundSpec } from "./sources";
import type { PresidentialSource, RoundNumber } from "./sources";

/** The folder ЦИК wraps the text files in. */
export const DATA_FOLDER_2026 = "Актуализирана база данни";

/** Forms that carry the section's electorate. Exactly one per section. */
const ELECTORATE_FORMS = new Set(["24", "25", "26", "28", "29", "30"]);
/** Forms with a paper ballot box (fields 12–17). */
const PAPER_BOX_FORMS = new Set(["24", "26", "28", "30"]);
/** Forms whose machines failed and were counted from control receipts (9.x, 11.x). */
const CONTROL_RECEIPT_FORMS = new Set(["26", "30"]);
/** One row per machine (fields 26–28). */
const MACHINE_DATA_FORMS = new Set(["32", "41"]);

/** Field indices — the readme numbers from 1, so field N is index N-1. */
const F = {
  form: 0,
  section: 1,
  /** 6) А. ballots received */
  received: 5,
  /** 7) 1.а invalid + destroyed paper ballots (1. destroyed, on a machine form) */
  destroyed: 6,
  /** 8) 1.б unused ballots */
  unused: 7,
  /** 9) 2. registered voters */
  registered: 8,
  /** 10) 3. added on the day */
  additional: 9,
  /** 11) 4. signatures — the turnout numerator */
  signatures: 10,
  /** 12) 5. ballots found in the box */
  inBox: 11,
  /** 13) 6. invalid ballots in the box */
  invalid: 12,
  /** 16) 7.1 valid for the ticket lists */
  ticketVotes: 15,
  /** 17) 7.2 „не подкрепям никого" */
  noneOfTheAbove: 16,
  /** 18)–21) machine 1 control receipts: receipts, ticket votes, „никого", unreadable */
  receipts1: 17,
  /** 22)–25) machine 2 control receipts, same four */
  receipts2: 21,
  /** 26) machine row: confirmed votes */
  machineVoters: 25,
  /** 27) machine row: valid for the ticket lists */
  machineTicket: 26,
  /** 28) machine row: „никого" */
  machineNone: 27,
} as const;

/**
 * Where the round's text files are. The archive nests them one level down; a round
 * folder laid out flat (a hand-built fixture) is read in place.
 */
export const dataDir2026 = (dir: string): string => {
  const nested = path.join(dir, DATA_FOLDER_2026);
  return fs.existsSync(nested) ? nested : dir;
};

const readFile = (
  dir: string,
  prefix: string,
  encoding: PresidentialEncoding,
): string[][] =>
  readBundleFile(
    "era2026",
    dir,
    `${prefix}*.txt`,
    (f) => f.startsWith(prefix) && f.endsWith(".txt"),
    encoding,
  );

type SectionMeta = {
  ekatte?: string;
  placeName: string;
  isMobile: boolean;
  isShip: boolean;
  machines: number;
};

/** `code;adminId;adminName;ekatte;place;address;lon;lat;mobile;ship;machines` — two
 *  more columns than 2021 (address and coordinates), so the flags moved too. */
export const readSections2026 = (
  dir: string,
  encoding: PresidentialEncoding,
): Map<string, SectionMeta> => {
  const out = new Map<string, SectionMeta>();
  for (const row of readFile(dir, "sections", encoding)) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    out.set(code, {
      ekatte: normaliseEkatte(row[3] ?? ""),
      placeName: (row[4] ?? "").trim(),
      isMobile: num(row[8]) === 1,
      isShip: num(row[9]) === 1,
      machines: num(row[10]),
    });
  }
  if (!out.size) throw new Error(`era2026: no sections in ${dir}`);
  return out;
};

/**
 * Read one round of a 2026-format cycle.
 *
 * @param roundDir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 */
export const readEra2026Round = (
  roundDir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const encoding = source.encoding;
  const dir = dataDir2026(roundDir);
  // `cik_candidates` kept 2021's shape (number; nominator; position; „<pres> и <vice>").
  const tickets = readTickets(dir, encoding);
  const known = new Set(tickets.map((t) => t.number));
  const meta = readSections2026(dir, encoding);

  const sections = new Map<string, PresidentialSection>();
  const sectionOf = (code: string): PresidentialSection => {
    const existing = sections.get(code);
    if (existing) return existing;
    const m = meta.get(code);
    if (!m) {
      throw new Error(
        `era2026: section ${code} appears in a protocol or votes row but not in sections`,
      );
    }
    const created: PresidentialSection = {
      code,
      round,
      ekatte: m.ekatte,
      placeName: m.placeName,
      isMobile: m.isMobile,
      isShip: m.isShip,
      machines: m.machines,
      protocol: emptyProtocol(),
      votes: [],
    };
    sections.set(code, created);
    return created;
  };
  for (const code of meta.keys()) sectionOf(code);

  const addMachine = (
    p: PresidentialSection["protocol"],
    voters: number,
    ticket: number,
    none: number,
  ): void => {
    p.numMachineBallots = (p.numMachineBallots ?? 0) + voters;
    p.numValidMachineVotes = (p.numValidMachineVotes ?? 0) + ticket;
    p.numValidNoOneMachineVotes = (p.numValidNoOneMachineVotes ?? 0) + none;
  };

  for (const row of readFile(dir, "protocols", encoding)) {
    const form = (row[F.form] ?? "").trim();
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const p = sectionOf(code).protocol;
    if (ELECTORATE_FORMS.has(form)) {
      p.ballotsReceived = num(row[F.received]);
      p.numRegisteredVoters = num(row[F.registered]);
      p.numAdditionalVoters = num(row[F.additional]);
      p.totalActualVoters = num(row[F.signatures]);
      p.numUnusedPaperBallots = num(row[F.unused]);
      p.numInvalidAndDestroyedPaperBallots = num(row[F.destroyed]);
      if (PAPER_BOX_FORMS.has(form)) {
        p.numPaperBallotsFound = num(row[F.inBox]);
        p.numInvalidBallotsFound = num(row[F.invalid]);
        p.numValidVotes = num(row[F.ticketVotes]);
        p.numValidNoOnePaperVotes = num(row[F.noneOfTheAbove]);
      }
      if (CONTROL_RECEIPT_FORMS.has(form)) {
        // A failed machine's votes, counted by hand from its receipts. The fourth field
        // (unreadable receipts) is counted in neither valid total, as ЦИК's own line 7.
        for (const at of [F.receipts1, F.receipts2]) {
          addMachine(p, num(row[at]), num(row[at + 1]), num(row[at + 2]));
        }
      }
      // ⚠ Field 14 („6. потвърдени гласове", the machine form's own statement of its
      // total) is NOT stored, for 2021's reason: the machine rows are summed instead.
    } else if (MACHINE_DATA_FORMS.has(form)) {
      addMachine(
        p,
        num(row[F.machineVoters]),
        num(row[F.machineTicket]),
        num(row[F.machineNone]),
      );
    } else {
      throw new Error(
        `era2026: section ${code} has protocol form ${form}, which this reader does ` +
          `not know — check the round's readme`,
      );
    }
  }

  for (const row of readFile(dir, "votes", encoding)) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    const section = sectionOf(code);
    // `code;adminId;` then (№, total, paper, machine, machine 1, machine 2) per ticket.
    for (let i = 2; i + 3 < row.length; i += 6) {
      const ticket = Number(row[i]);
      if (!Number.isFinite(ticket) || row[i] === "") continue;
      if (!known.has(ticket)) {
        throw new Error(
          `era2026: section ${code} votes for ticket ${ticket}, which is not on the ballot`,
        );
      }
      const total = num(row[i + 1]);
      const paper = num(row[i + 2]);
      const machine = num(row[i + 3]);
      if (paper + machine !== total) {
        throw new Error(
          `era2026: section ${code} ticket ${ticket}: paper ${paper} + machine ` +
            `${machine} ≠ total ${total}`,
        );
      }
      addTicketVotes(section.votes, ticket, { paper, machine });
    }
  }

  return {
    cycle: source.cycle,
    round,
    date: roundSpec(source, round).date,
    tickets,
    sections: [...sections.values()],
    sourceEra: "2026",
  };
};
