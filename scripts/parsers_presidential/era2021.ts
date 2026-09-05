// The 2021 reader — ЦИК's modern format, and the only era with machine voting.
//
// FILES (`raw_data/2021_11_14_pvr/ТУРn/`): `cik_parties`, `cik_candidates`,
// `sections`, `protocols`, `votes`. UTF-8, `;`-separated, one row per record.
//
// ⚠ THE THING THAT MAKES THIS ERA DIFFERENT: A SECTION IS SEVERAL ROWS. Its paper
// protocol and EACH of its voting machines are separate rows in both `protocols` and
// `votes`, all carrying the same section code. A reader that takes the first row per
// section — what a `find()` naturally does — keeps the paper tally and silently drops
// every machine vote, which in 2021 is 84% of the corpus. Measured over round 1:
// 11,419 machine rows against 3,089 paper ones.
//
// The forms, and which of them carry what (measured, not inferred — see the tables in
// the plan's §2.5-1):
//
//   24 Х    paper only            │ carries ticket votes, PAPER
//   26 ХМ   paper + machine       │ carries ticket votes, PAPER (its 7.x fields are
//                                 │ the BOX; the machine half is a separate 27/32 row)
//   28 ЧХ   abroad, paper         │ carries ticket votes, PAPER
//   25 М    machine only          │ NO ticket votes — they are in its 32 rows
//   29 ЧМ   abroad, machine only  │ NO ticket votes — они are in its 41 rows
//   27 КР   control receipts      │ carries ticket votes, MACHINE
//   31 ЧКР  control receipts      │ carries ticket votes, MACHINE
//   32      machine data          │ carries ticket votes, MACHINE (one row per machine)
//   41      machine data, abroad  │ carries ticket votes, MACHINE
//
// Exactly one of {24, 25, 26, 28, 29} exists per section — 3,089 + 9,350 + 49 + 542 +
// 208 = 13,238, the section count — and that row is where the electorate figures live.
//
// ⚠ AND THE „НЕ ПОДКРЕПЯМ НИКОГО" COUNT IS NOT A TICKET. It is protocol field 7.2, a
// separate column, and it belongs in the VALID total but never in the ticket ranking.
// Leaving it out of the denominator turns Радев's 49.42% in round 1 into 50.57% and
// elects him outright — see the plan's §2.4.
//
// Plan: docs/plans/presidential-elections-v1.md T2.1.

import fs from "node:fs";
import path from "node:path";
import { decodeBundleText, parseSemicolonRows } from "./encoding";
import {
  addTicketVotes,
  canonicalTicketKey,
  emptyProtocol,
  nominatorKind,
  normaliseEkatte,
  splitTicketNames,
  type PresidentialRound,
  type PresidentialSection,
  type Ticket,
} from "./types";
import type { PresidentialSource, RoundNumber } from "./sources";

/** Protocol forms that carry the section's electorate figures. Exactly one per
 *  section. */
const ELECTORATE_FORMS = new Set(["24", "25", "26", "28", "29"]);
/** Forms whose ticket votes were cast on PAPER. */
const PAPER_VOTE_FORMS = new Set(["24", "26", "28"]);
/** Forms whose ticket votes came off a MACHINE. `27`/`31` are the control-receipt
 *  protocols filled in when a machine stopped; they carry their own votes and are not
 *  a duplicate of a `32` row (only 37 of 101 such sections have both). */
const MACHINE_VOTE_FORMS = new Set(["27", "31", "32", "41"]);

/** Field indices, from the round's own readme. The readme numbers fields from 1, so
 *  field N is index N-1; these are the indices. */
const F = {
  form: 0,
  section: 1,
  rik: 2,
  /** 7) А. ballots received */
  received: 6,
  /** 8) 1. registered voters */
  registered: 7,
  /** 9) 2. added on the day */
  additional: 8,
  /** 10) 3. signatures — the turnout numerator */
  signatures: 9,
  /** 11) 4а. unused paper ballots */
  unused: 10,
  /** 12) 4б. spoiled and destroyed */
  destroyed: 11,
  /** 14) 5.1 ballots found in the box (form 26); 5. for 24/28 */
  inBox: 13,
  /** 15) 5.2 confirmed machine votes */
  machineConfirmed: 14,
  /** 16) 6. invalid ballots in the box */
  invalid: 15,
  /** 17) 7. valid in the box — and, on a machine row, 1. voters */
  validOrVoters: 16,
  /** 18) 7.1 valid for the ticket lists */
  ticketVotes: 17,
  /** 19) 7.2 „не подкрепям никого" */
  noneOfTheAbove: 18,
} as const;

const num = (raw: string | undefined): number => {
  if (raw === undefined) return 0;
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

const readFile = (dir: string, prefix: string): string[][] => {
  const hit = fs
    .readdirSync(dir)
    .find((f) => f.startsWith(prefix) && f.endsWith(".txt"));
  if (!hit) {
    throw new Error(
      `era2021: no "${prefix}*.txt" in ${dir} — found ${fs.readdirSync(dir).join(", ")}`,
    );
  }
  return parseSemicolonRows(
    decodeBundleText(fs.readFileSync(path.join(dir, hit)), "utf8"),
  );
};

/**
 * Read the ticket list.
 *
 * ⚠ NAMES COME FROM `cik_candidates`, NOMINATORS FROM IT TOO — and `cik_parties` is
 * NOT a substitute for either. For an инициативен комитет that file carries a
 * composite („ИК за Румен Радев и Илияна Йотова-Румен Георгиев Радев и Илияна
 * Малинова Йотова") in which the pair name and the committee name are run together
 * with a hyphen, so splitting it yields neither cleanly.
 */
export const readTickets = (dir: string): Ticket[] => {
  const rows = readFile(dir, "cik_candidates");
  const tickets: Ticket[] = [];
  for (const row of rows) {
    const number = Number(row[0]);
    if (!Number.isFinite(number)) continue;
    const nominator = (row[1] ?? "").trim();
    const combined = (row[3] ?? "").trim();
    const split = splitTicketNames(combined);
    if (!split) {
      throw new Error(
        `era2021: ticket ${number} has no „<president> и <vice>" pair: "${combined}"`,
      );
    }
    tickets.push({
      number,
      president: split.president,
      vicePresident: split.vicePresident,
      nominatedBy: { name: nominator, kind: nominatorKind(nominator) },
      canonicalKey: canonicalTicketKey(split.president),
    });
  }
  if (!tickets.length) throw new Error(`era2021: no tickets in ${dir}`);
  return tickets;
};

type SectionMeta = {
  ekatte?: string;
  placeName: string;
  isMobile: boolean;
  isShip: boolean;
  machines: number;
  adminName: string;
};

/** `code;adminId;adminName;ekatte;place;mobile;ship;machines` */
export const readSections = (dir: string): Map<string, SectionMeta> => {
  const out = new Map<string, SectionMeta>();
  for (const row of readFile(dir, "sections")) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    out.set(code, {
      adminName: (row[2] ?? "").trim(),
      // ⚠ Padded: this file strips leading zeros and the settlement catalogue does
      // not. See normaliseEkatte.
      ekatte: normaliseEkatte(row[3] ?? ""),
      placeName: (row[4] ?? "").trim(),
      isMobile: num(row[5]) === 1,
      isShip: num(row[6]) === 1,
      machines: num(row[7]),
    });
  }
  if (!out.size) throw new Error(`era2021: no sections in ${dir}`);
  return out;
};

/**
 * Read one round of a 2021-format cycle.
 *
 * @param dir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 * @returns Every section, with its protocol and per-ticket votes.
 */
export const readEra2021Round = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const tickets = readTickets(dir);
  const known = new Set(tickets.map((t) => t.number));
  const meta = readSections(dir);

  const sections = new Map<string, PresidentialSection>();
  const sectionOf = (code: string): PresidentialSection => {
    const existing = sections.get(code);
    if (existing) return existing;
    const m = meta.get(code);
    if (!m) {
      throw new Error(
        `era2021: section ${code} appears in a protocol or votes row but not in sections`,
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

  // Every section exists even if no protocol row mentions it, so a missing protocol is
  // visible downstream as a section with an empty one rather than as an absent place.
  for (const code of meta.keys()) sectionOf(code);

  for (const row of readFile(dir, "protocols")) {
    const form = (row[F.form] ?? "").trim();
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const p = sectionOf(code).protocol;
    if (ELECTORATE_FORMS.has(form)) {
      // The one row per section that carries the electorate.
      p.ballotsReceived = num(row[F.received]);
      p.numRegisteredVoters = num(row[F.registered]);
      p.numAdditionalVoters = num(row[F.additional]);
      p.totalActualVoters = num(row[F.signatures]);
      p.numUnusedPaperBallots = num(row[F.unused]);
      p.numInvalidAndDestroyedPaperBallots = num(row[F.destroyed]);
      if (PAPER_VOTE_FORMS.has(form)) {
        p.numPaperBallotsFound = num(row[F.inBox]);
        p.numInvalidBallotsFound = num(row[F.invalid]);
        p.numValidVotes = num(row[F.ticketVotes]);
        p.numValidNoOnePaperVotes = num(row[F.noneOfTheAbove]);
      }
      // ⚠ 5.2 (the section's own statement of its machine total) is NOT stored, and
      // that is deliberate: it disagrees with the machines' own counts on 97 sections,
      // and where it does the machines are right. 244606005 claims 712 machine
      // ballots against 398 signatures — impossible — while its two machines report
      // 197 + 155 = 352, each internally consistent with its valid + „никого". So
      // `numMachineBallots` is summed from the machine rows below, which is also what
      // the parliamentary parser does for the ballot held the same day.
    } else if (MACHINE_VOTE_FORMS.has(form)) {
      // One row per machine: accumulate, never assign.
      p.numMachineBallots =
        (p.numMachineBallots ?? 0) + num(row[F.validOrVoters]);
      p.numValidMachineVotes =
        (p.numValidMachineVotes ?? 0) + num(row[F.ticketVotes]);
      p.numValidNoOneMachineVotes =
        (p.numValidNoOneMachineVotes ?? 0) + num(row[F.noneOfTheAbove]);
    }
  }

  for (const row of readFile(dir, "votes")) {
    const form = (row[F.form] ?? "").trim();
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const section = sectionOf(code);
    const isMachine = MACHINE_VOTE_FORMS.has(form);
    // `form;code;adminUnit;` then (ticket, votes) pairs.
    for (let i = 3; i + 1 < row.length; i += 2) {
      const ticket = Number(row[i]);
      if (!Number.isFinite(ticket)) continue;
      if (!known.has(ticket)) {
        throw new Error(
          `era2021: section ${code} votes for ticket ${ticket}, which is not on the ballot`,
        );
      }
      const votes = num(row[i + 1]);
      addTicketVotes(
        section.votes,
        ticket,
        isMachine ? { machine: votes } : { paper: votes },
      );
    }
  }

  return {
    cycle: source.cycle,
    round,
    date: source.rounds[round].date,
    tickets,
    sections: [...sections.values()],
    sourceEra: "2021",
  };
};
