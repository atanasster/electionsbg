// The 2016 reader — one row per section, and the first election with voting machines.
//
// FILES (`raw_data/2016_11_06_pvr/ТУРn/`): `cik_candidates`, `sections`, `protocols`,
// `votes`. UTF-8 (a BOM on some files and not others), `;`-separated.
//
// ⚠ THE SHAPE IS THE OPPOSITE OF 2021'S, AND THAT IS THE THING TO GET RIGHT. Here a
// section is exactly ONE protocol row and ONE votes row; the machine half lives in
// EXTRA COLUMNS rather than in extra rows. So the 2021 reader's "sum every row for
// this section" is wrong here and would double nothing, while 2021's "one row per
// section" would have dropped 84% there. The two readers exist because the two
// formats disagree about this, not because the elections do.
//
// Votes are 5-tuples — `ticket; valid; valid(Б); valid(М); invalid` — and the two
// middle columns are, per the readme, "from the protocols WITH machine voting". So on
// the 11,840 non-machine sections they are both 0 and `valid` is entirely paper;
// only the 500 machine-flagged sections carry a real split. Reading Б as "paper
// everywhere" would therefore zero the paper vote for 96% of the corpus.
//
// The three forms, all 32 columns wide:
//
//   1  paper, in country      11,515 sections
//   7  paper, abroad             325
//   8  paper + machine           500   ← the only form whose 7.1/7.2 decompose
//
// ⚠ TWO FILES STATE THE PAPER/MACHINE SPLIT AND THEY DISAGREE, so each is kept for
// the question it can answer rather than one being silently preferred. The PROTOCOL's
// 7.1 box/machine pair is the section's own summary and lands in
// `protocol.numValidVotes` / `numValidMachineVotes` (41,792 machine votes nationally
// in round 1). The VOTES file's Б/М columns are the only PER-TICKET split there is,
// and land in `Votes.paperVotes` / `machineVotes` (41,585). They differ on 56 of the
// 500 machine sections — including exact swaps — and both reconcile to ЦИК's
// published per-ticket totals, so nothing downstream would notice. A surface must
// therefore say which basis a "% cast on machines" figure came from, and must not add
// one to the other.
//
// ⚠ AND „НЕ ПОДКРЕПЯМ НИКОГО" IS A COLUMN, NOT A TICKET (field 7.2, index 26). It
// belongs in the valid total and never in the ranking: Радев's 973,754 is 25.44% of
// the valid votes and 26.95% of the ticket votes, and only the first is the published
// figure.
//
// Plan: docs/plans/presidential-elections-v1.md T2.2.

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

/** Field indices, from the round's own readme (which numbers from 1). */
const F = {
  form: 0,
  section: 1,
  /** 5) А. ballots received */
  received: 4,
  /** 6) 1. registered voters */
  registered: 5,
  /** 7) 2. added on the day */
  additional: 6,
  /** 8) 3. signatures — total, and on form 8 the sum of 3.а and 3.б */
  signatures: 7,
  /** 10) 3.б confirmed machine votes, in the SIGNATURES block. ⚠ Read for the
   *  cross-check only — `numMachineBallots` comes from 5.б below, so that it and its
   *  paper partner 5.а are from the SAME block. The two blocks disagree on 2
   *  sections, and mixing them there produces a found-total that contradicts the
   *  row's own 5. */
  machineSigned: 9,
  /** 11) 4.а unused paper ballots */
  unused: 10,
  /** 12)–16) 4.б–4.е destroyed, mis-numbered, photographed, shown, spoiled */
  destroyedFirst: 11,
  destroyedLast: 15,
  /** 17) 5. found — box + machine on form 8 */
  found: 16,
  /** 18) 5.а found in the box (form 8) */
  foundInBox: 17,
  /** 19) 5.б confirmed machine votes, in the FOUND block — the partner of 5.а. */
  foundOnMachine: 18,
  /** 20) 6. invalid — total */
  invalid: 19,
  /** 23) 7. valid — total */
  valid: 22,
  /** 24) 7.1 valid for the ticket lists */
  ticketVotes: 23,
  /** 25) 7.1 of those, from the box */
  ticketVotesBox: 24,
  /** 26) 7.1 of those, from a machine */
  ticketVotesMachine: 25,
  /** 27) 7.2 „не подкрепям никого" — total */
  noneOfTheAbove: 26,
  /** 28) 7.2 of those, from the box */
  noneBox: 27,
  /** 29) 7.2 of those, from a machine */
  noneMachine: 28,
} as const;

/** Vote-row layout: `code; adminUnit;` then repeating 5-tuples. */
const VOTES_FIRST_TUPLE = 2;
const VOTES_TUPLE_WIDTH = 5;

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
      `era2016: no "${prefix}*.txt" in ${dir} — found ${fs.readdirSync(dir).join(", ")}`,
    );
  }
  return parseSemicolonRows(
    decodeBundleText(fs.readFileSync(path.join(dir, hit)), "utf8"),
  );
};

/**
 * Read the ticket list.
 *
 * `num; nominator; candidateNum; „president и vice"; electedFlag` — the same combined
 * name string as 2021, and the only era besides it that uses „и" as the separator.
 *
 * @returns The tickets, and which of them the file marks as ELECTED — a cross-check
 *   for the computed winner rule, never its source.
 */
export const readTickets = (
  dir: string,
): { tickets: Ticket[]; electedNumbers: number[] } => {
  const tickets: Ticket[] = [];
  const electedNumbers: number[] = [];
  for (const row of readFile(dir, "cik_candidates")) {
    const number = Number(row[0]);
    if (!Number.isFinite(number)) continue;
    const nominator = (row[1] ?? "").trim();
    const combined = (row[3] ?? "").trim();
    const split = splitTicketNames(combined);
    if (!split) {
      throw new Error(
        `era2016: ticket ${number} has no „<president> и <vice>" pair: "${combined}"`,
      );
    }
    tickets.push({
      number,
      president: split.president,
      vicePresident: split.vicePresident,
      nominatedBy: { name: nominator, kind: nominatorKind(nominator) },
      canonicalKey: canonicalTicketKey(split.president),
    });
    if (num(row[4]) === 1) electedNumbers.push(number);
  }
  if (!tickets.length) throw new Error(`era2016: no tickets in ${dir}`);
  return { tickets, electedNumbers };
};

type SectionMeta = {
  ekatte?: string;
  placeName: string;
  isMobile: boolean;
  isShip: boolean;
  /** ⚠ A FLAG, not a count — this era publishes whether the section had machine
   *  voting, not how many machines it had. Stored as 1/0 in `machines` so the shared
   *  shape holds; a consumer must not read it as a machine count for 2016. */
  hasMachine: boolean;
};

/** `code; adminId; adminName; ekatte; place; mobile; ship; machineFlag` */
export const readSections = (dir: string): Map<string, SectionMeta> => {
  const out = new Map<string, SectionMeta>();
  for (const row of readFile(dir, "sections")) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    out.set(code, {
      ekatte: normaliseEkatte(row[3] ?? ""),
      placeName: (row[4] ?? "").trim(),
      isMobile: num(row[5]) === 1,
      isShip: num(row[6]) === 1,
      hasMachine: num(row[7]) === 1,
    });
  }
  if (!out.size) throw new Error(`era2016: no sections in ${dir}`);
  return out;
};

/**
 * Read one round of a 2016-format cycle.
 *
 * @param dir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 * @returns Every section, with its protocol and per-ticket votes.
 */
export const readEra2016Round = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const { tickets } = readTickets(dir);
  const known = new Set(tickets.map((t) => t.number));
  const meta = readSections(dir);

  const sections = new Map<string, PresidentialSection>();
  for (const [code, m] of meta) {
    sections.set(code, {
      code,
      round,
      ekatte: m.ekatte,
      placeName: m.placeName,
      isMobile: m.isMobile,
      isShip: m.isShip,
      machines: m.hasMachine ? 1 : 0,
      protocol: emptyProtocol(),
      votes: [],
    });
  }
  const sectionOf = (code: string, where: string): PresidentialSection => {
    const s = sections.get(code);
    if (!s) {
      throw new Error(
        `era2016: section ${code} appears in ${where} but not in sections`,
      );
    }
    return s;
  };

  for (const row of readFile(dir, "protocols")) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const p = sectionOf(code, "protocols").protocol;
    p.ballotsReceived = num(row[F.received]);
    p.numRegisteredVoters = num(row[F.registered]);
    p.numAdditionalVoters = num(row[F.additional]);
    p.totalActualVoters = num(row[F.signatures]);
    p.numUnusedPaperBallots = num(row[F.unused]);
    // 4.б–4.е are five separate reasons a ballot was destroyed; the shared shape
    // carries one total, as the parliamentary parser also does for this era.
    let destroyed = 0;
    for (let i = F.destroyedFirst; i <= F.destroyedLast; i++) {
      destroyed += num(row[i]);
    }
    p.numInvalidAndDestroyedPaperBallots = destroyed;
    p.numInvalidBallotsFound = num(row[F.invalid]);

    // ⚠ THE BRANCH IS THE SECTION'S OWN MACHINE FLAG, not "are the machine fields
    // non-zero". Six form-8 sections recorded ZERO machine votes (4 in round 1, 2 in
    // round 2), and a truthiness test files them as paper — harmless for the
    // arithmetic, since a zero-machine form 8 has box == total, but it publishes
    // `machines: 1` beside `numValidMachineVotes: undefined` and so destroys the
    // "absent means this form does not ask" distinction the rest of the shape rests
    // on. The flag agrees with form 8 on all 1,000 rows across both rounds.
    if (meta.get(code)?.hasMachine) {
      // Form 8: the 5.x and 7.x fields decompose, so paper and machine are stated.
      p.numPaperBallotsFound = num(row[F.foundInBox]);
      p.numValidVotes = num(row[F.ticketVotesBox]);
      p.numValidNoOnePaperVotes = num(row[F.noneBox]);
      p.numMachineBallots = num(row[F.foundOnMachine]);
      p.numValidMachineVotes = num(row[F.ticketVotesMachine]);
      p.numValidNoOneMachineVotes = num(row[F.noneMachine]);
    } else {
      // Forms 1 and 7: everything found is paper, and the decomposition columns are
      // empty rather than zero-meaning-none.
      p.numPaperBallotsFound = num(row[F.found]);
      p.numValidVotes = num(row[F.ticketVotes]);
      p.numValidNoOnePaperVotes = num(row[F.noneOfTheAbove]);
    }
  }

  let clampedAway = 0;
  const clampedCells: string[] = [];
  for (const row of readFile(dir, "votes")) {
    const code = (row[0] ?? "").trim();
    if (!code) continue;
    const section = sectionOf(code, "votes");
    const flagged = meta.get(code)?.hasMachine ?? false;
    // `i + WIDTH <= row.length` — a whole tuple must be present. The looser bound
    // this replaces accepted a truncated tail, reading absent columns as zeros.
    for (
      let i = VOTES_FIRST_TUPLE;
      i + VOTES_TUPLE_WIDTH <= row.length;
      i += VOTES_TUPLE_WIDTH
    ) {
      const ticket = Number(row[i]);
      if (!Number.isFinite(ticket)) continue;
      if (!known.has(ticket)) {
        throw new Error(
          `era2016: section ${code} votes for ticket ${ticket}, which is not on the ballot`,
        );
      }
      const valid = num(row[i + 1]);
      const fromMachine = num(row[i + 3]);
      // ⚠ `valid` IS THE TICKET'S TOTAL AND Б/М ARE A DECOMPOSITION OF IT — so the
      // total is taken from the source's own column and the split is derived, rather
      // than the other way round. Two reasons. The Б/М columns are populated ONLY on
      // machine-voting protocols, so on the 11,840 unflagged sections they are both 0
      // and reading Б as "paper" would zero the paper vote for 96% of the corpus. And
      // the decomposition does not always add up: `273100059` ticket 8 states
      // valid = 0 with М = 1 — one cell in 259,140 — where summing Б+М would publish
      // a national total one vote above ЦИК's own.
      const machine = flagged ? Math.min(fromMachine, valid) : 0;
      // ⚠ COUNTED, not silently dropped. The clamp exists for the one cell that
      // states valid = 0 with М = 1; discarding a vote without saying so is the
      // shape this repo treats as worse than the discrepancy itself.
      if (flagged && fromMachine > valid) {
        clampedAway += fromMachine - valid;
        clampedCells.push(`${code}/${ticket}`);
      }
      addTicketVotes(section.votes, ticket, {
        paper: valid - machine,
        machine,
      });
    }
  }

  if (clampedAway) {
    console.warn(
      `[era2016] ${source.cycle} round ${round}: ${clampedAway} machine vote(s) ` +
        `exceeded their cell's stated total and were dropped in favour of it ` +
        `(${clampedCells.join(", ")})`,
    );
  }

  return {
    cycle: source.cycle,
    round,
    date: source.rounds[round].date,
    tickets,
    sections: [...sections.values()],
    sourceEra: "2016",
  };
};
