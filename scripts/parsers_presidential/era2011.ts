// The 2011 reader — windows-1251, no machines, and a section grid that is not the
// parliamentary one.
//
// FILES (`raw_data/2011_10_23_pvr/ТУРn/`, all `el2011_president_*`): `candidates`,
// `sections`, `protocols`, `votes`, `result`, `readme`. All windows-1251.
//
// ⚠ THE SECTION CODES ARE ON THE 28-OBLAST ОИК GRID, NOT THE 31-МИР PARLIAMENTARY ONE.
// The election ran through the same commissions as that year's local vote, so prefix
// `22` is София-град, `16` is the whole of Пловдив (city and oblast together, where
// parliamentary splits them into 16 and 17), and abroad is `29` rather than `32`.
// Those codes do NOT join parliamentary sections: the same nine digits mean a
// different place. Everything downstream must resolve this era through ЕКАТТЕ and the
// oblast prefix, never by matching a section code against another election.
//
// ⚠ AND THIS ERA HAS NO „НЕ ПОДКРЕПЯМ НИКОГО" — the option was introduced in 2016. So
// unlike 2016 and 2021, the valid total IS the ticket total here, and a winner rule
// that subtracted a „никого" column would be subtracting a column that does not exist.
//
// Three smaller differences from the modern files:
//
//   • the two names are SEPARATE COLUMNS, so `splitTicketNames` is not used — and its
//     „и" separator would in any case split „Валентина Иванова Гоцева" wrongly;
//   • every row begins with a FLAG column that is blank for an ordinary section, `П`
//     for a mobile one and `Е` for an experimental counting commission, so the section
//     code is field 2, not field 1;
//   • `result.txt` states who was elected (`И`) or went to a runoff (`Б`) — a
//     cross-check for the computed winner rule, never its source.
//
// Plan: docs/plans/presidential-elections-v1.md T2.3.

import { num, readBundleFile, sectionLookup } from "./readerKit";
import type { PresidentialEncoding } from "./encoding";
import { PRESIDENTIAL_SOURCES } from "./sources";
import {
  addTicketVotes,
  canonicalTicketKey,
  emptyProtocol,
  nominatorKind,
  normaliseEkatte,
  type PresidentialRound,
  type PresidentialSection,
  type Ticket,
} from "./types";
import type { PresidentialSource, RoundNumber } from "./sources";

/**
 * PROTOCOL field indices, from the round's own (windows-1251) readme, which numbers
 * from 1.
 *
 * ⚠ ONLY `flag` AND `section` ARE SHARED ACROSS FILES. The readme gives protocols,
 * sections and votes the same first two fields, so those two are safe everywhere —
 * every OTHER entry here is the PROTOCOL layout and means something different in the
 * other two files. Index 2 is „registered voters" in a protocol row and „име на област"
 * in a sections row, so reaching for `F.registered` while reading sections publishes a
 * place name as an electorate. The sections columns have their own map, `S`.
 */
const F = {
  /** 1) the section-type flag — blank, `П` (mobile) or `Е` (experimental count) */
  flag: 0,
  /** 2) the 9-digit section code */
  section: 1,
  /** 3) registered voters at handover */
  registered: 2,
  /** 4) added on the day, below the line */
  additional: 3,
  /** 5) on the supplementary list */
  additionalList: 4,
  /** 7) signatures — the turnout numerator */
  signatures: 6,
  /**
   * 10) сгрешени — ballots destroyed with the word „сгрешена".
   *
   * ⚠ NOT fields 8/9 (недействителни по чл. 180 / чл. 181), which are a DIFFERENT
   * concept and already sit outside field 26's own 21–25 sum — folding them in here
   * would double-count them against `numInvalidBallotsFound`.
   */
  spoiled: 9,
  /** 20) ballots found in the boxes */
  found: 19,
  /** 26) invalid — the sum of fields 21–25 */
  invalid: 25,
  /** 27) valid — and, this era having no „никого", the ticket total */
  valid: 26,
} as const;

/** SECTIONS columns: `flag; code; област; община; населено място; ЕКАТТЕ`. */
const S = { oblast: 2, obshtina: 3, place: 4, ekatte: 5 } as const;

/** Votes rows are `flag; code;` then (ticket, votes) pairs. */
const VOTES_FIRST_PAIR = 2;

/**
 * ⚠ ANCHORED AT BOTH ENDS, unlike the sibling readers' prefix match. This cycle's
 * archive is the JOINT bundle — the same zip carries общински съветници, кмет на община
 * and кмет на кметство (see `sources.ts`) — so a re-extraction that flattened the race
 * folders would put `el2011_obshtinski_sections.txt` within reach of a suffix-only
 * match, and `find` returns whichever entry `readdir` yields first. Matching the exact
 * name makes a mis-extraction fail loudly instead.
 */
const FILE_PREFIX = "el2011_president_";

/** The cycle's DECLARED encoding — read from `sources.ts`, never re-typed as a literal,
 *  so a correction there actually reaches this parser. */
const ENCODING_2011: PresidentialEncoding =
  PRESIDENTIAL_SOURCES["2011_10_23_pvr"].encoding;

const readFile = (
  dir: string,
  suffix: string,
  encoding: PresidentialEncoding = ENCODING_2011,
): string[][] => {
  const want = `${FILE_PREFIX}${suffix}.txt`;
  return readBundleFile("era2011", dir, want, (f) => f === want, encoding);
};

/**
 * Read the ticket list.
 *
 * `num; president; vicePresident; nominator` — the two names in SEPARATE columns,
 * which is why this era does not go through `splitTicketNames`.
 */
export const readTickets = (
  dir: string,
  encoding: PresidentialEncoding = ENCODING_2011,
): Ticket[] => {
  const tickets: Ticket[] = [];
  for (const row of readFile(dir, "candidates", encoding)) {
    const number = Number(row[0]);
    if (!Number.isFinite(number)) continue;
    const president = (row[1] ?? "").trim();
    const vicePresident = (row[2] ?? "").trim();
    const nominator = (row[3] ?? "").trim();
    if (!president || !vicePresident) {
      throw new Error(
        `era2011: ticket ${number} is missing a name ("${president}" / "${vicePresident}")`,
      );
    }
    tickets.push({
      number,
      president,
      vicePresident,
      nominatedBy: { name: nominator, kind: nominatorKind(nominator) },
      canonicalKey: canonicalTicketKey(president),
    });
  }
  if (!tickets.length) throw new Error(`era2011: no tickets in ${dir}`);
  return tickets;
};

/**
 * The outcome marker, refused rather than defaulted.
 *
 * ⚠ `Б` IS TESTED FOR EXPLICITLY, NEVER INFERRED AS „not И". Falling through to
 * „runoff" would turn an empty cell, a mojibake byte or a marker ЦИК adds later into the
 * POSITIVE assertion that a named real candidate reached a balotage — and this file is
 * the INDEPENDENT cross-check on the computed winner rule (plan decision 5), so an
 * outcome invented here would silently agree with a broken rule instead of catching it.
 * It also makes „every round-1 row is a runoff" satisfiable by a total decode failure,
 * since mojibake is `!== "И"`. Same refusal as the section flag below.
 */
const outcomeOf = (raw: string, dir: string): "elected" | "runoff" => {
  const flag = raw.trim().toUpperCase();
  if (flag === "И") return "elected";
  if (flag === "Б") return "runoff";
  throw new Error(
    `era2011: result row in ${dir} carries an unknown outcome marker "${flag}" ` +
      `— the readme declares only И (избран) and Б (балотаж)`,
  );
};

/**
 * Read `result.txt` — ЦИК's own statement of the outcome.
 *
 * @returns One entry per listed ticket: `И` elected, `Б` through to the runoff.
 *   ⚠ A CROSS-CHECK ONLY. The winner is computed from the votes (plan decision 5) and
 *   compared with this; taking it from here would mean the rule is never exercised.
 */
export const readResult = (
  dir: string,
  encoding: PresidentialEncoding = ENCODING_2011,
): { number: number; outcome: "elected" | "runoff"; votes: number }[] =>
  readFile(dir, "result", encoding)
    .filter((row) => row.length >= 5)
    .map((row) => ({
      number: Number(row[1]),
      outcome: outcomeOf(row[0], dir),
      votes: num(row[4]),
    }))
    .filter((r) => Number.isFinite(r.number));

type SectionMeta = {
  ekatte?: string;
  oblastName: string;
  obshtinaName: string;
  placeName: string;
  isMobile: boolean;
  /**
   * An experimental counting commission (`Е`) — a 2011-only pilot that counted a
   * section's ballots a second time.
   *
   * ⚠ DOCUMENTED BY THE READ-ME, ABSENT FROM THE CORPUS. Measured over both rounds: the
   * flag column holds only blank (11,702 / 11,699) and `П` (82 / 80), so this is `false`
   * on every section we hold and the branch that sets it has never run against real
   * data.
   *
   * ⚠ IT IS NOT CARRIED ONTO `PresidentialSection`, and the shared five-era shape has no
   * field for it — inventing one for a pilot with zero rows would cost every other era.
   * So `readEra2011Round` REFUSES a round containing one rather than publishing it as an
   * ordinary section. Whoever re-downloads a tree that does carry `Е` has to decide what
   * it means, which is the right person to decide.
   */
  isExperimental: boolean;
};

/** `flag; code; oblast; obshtina; place; ekatte` */
export const readSections = (
  dir: string,
  encoding: PresidentialEncoding = ENCODING_2011,
): Map<string, SectionMeta> => {
  const out = new Map<string, SectionMeta>();
  for (const row of readFile(dir, "sections", encoding)) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const flag = (row[F.flag] ?? "").trim().toUpperCase();
    // ⚠ Refuse an unrecognised flag rather than defaulting it to an ordinary
    // section. The flag decides which protocol form the row is, so a value this reader
    // does not know is a row whose field map is unverified — and treating it as
    // ordinary publishes those numbers under the wrong headings at no error.
    if (flag !== "" && flag !== "П" && flag !== "Е") {
      throw new Error(
        `era2011: section ${code} carries an unknown protocol flag "${flag}"`,
      );
    }
    out.set(code, {
      oblastName: (row[S.oblast] ?? "").trim(),
      obshtinaName: (row[S.obshtina] ?? "").trim(),
      placeName: (row[S.place] ?? "").trim(),
      ekatte: normaliseEkatte(row[S.ekatte] ?? ""),
      isMobile: flag === "П",
      isExperimental: flag === "Е",
    });
  }
  if (!out.size) throw new Error(`era2011: no sections in ${dir}`);
  return out;
};

/** Abroad sections are prefix `29` in this era — NOT `32`, which is what every other
 *  era uses. Reading `32` here finds nothing and silently publishes zero votes
 *  abroad. */
export const ABROAD_PREFIX_2011 = "29";

/**
 * Read one round of a 2011-format cycle.
 *
 * @param dir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 * @returns Every section, with its protocol and per-ticket votes. All votes are
 *   PAPER — there was no machine voting in 2011.
 */
export const readEra2011Round = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const encoding = source.encoding;
  const tickets = readTickets(dir, encoding);
  const known = new Set(tickets.map((t) => t.number));
  const meta = readSections(dir, encoding);

  // ⚠ Refuse the read-me's `Е` rather than publishing it as an ordinary section. No
  // committed round carries one, so this reader has never been exercised against the
  // form, and `PresidentialSection` has nowhere to record it — a silently-ordinary
  // experimental protocol would put a second count of the same ballots into the
  // national total. See `SectionMeta.isExperimental`.
  const experimental = [...meta]
    .filter(([, m]) => m.isExperimental)
    .map(([code]) => code);
  if (experimental.length) {
    throw new Error(
      `era2011: ${experimental.length} section(s) carry the readme's Е ` +
        `(експериментална преброителна комисия) flag, which no committed round has and ` +
        `which this reader has never been exercised against — ` +
        `${experimental.slice(0, 5).join(", ")}`,
    );
  }

  const sections = new Map<string, PresidentialSection>();
  for (const [code, m] of meta) {
    sections.set(code, {
      code,
      round,
      ekatte: m.ekatte,
      placeName: m.placeName,
      isMobile: m.isMobile,
      isShip: false,
      machines: 0,
      protocol: emptyProtocol(),
      votes: [],
      ...(code.startsWith(ABROAD_PREFIX_2011)
        ? { abroad: { country: null, city: m.placeName } }
        : {}),
    });
  }
  const sectionOf = sectionLookup("era2011", sections);

  for (const row of readFile(dir, "protocols", encoding)) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const p = sectionOf(code, "protocols").protocol;
    p.numRegisteredVoters = num(row[F.registered]);
    // Two separate additions: below-the-line and the supplementary list. The shared
    // shape carries one figure, and both are additions to the same electorate.
    p.numAdditionalVoters = num(row[F.additional]) + num(row[F.additionalList]);
    p.totalActualVoters = num(row[F.signatures]);
    p.numInvalidAndDestroyedPaperBallots = num(row[F.spoiled]);
    p.numPaperBallotsFound = num(row[F.found]);
    p.numInvalidBallotsFound = num(row[F.invalid]);
    p.numValidVotes = num(row[F.valid]);
    // ⚠ No „никого" column exists before 2016, so this is left ABSENT rather than
    // set to 0 — "the form does not ask" and "nobody chose it" are different facts,
    // and the winner rule reads this to build its denominator.
  }

  for (const row of readFile(dir, "votes", encoding)) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const section = sectionOf(code, "votes");
    for (let i = VOTES_FIRST_PAIR; i + 1 < row.length; i += 2) {
      const ticket = Number(row[i]);
      if (!Number.isFinite(ticket)) continue;
      if (!known.has(ticket)) {
        throw new Error(
          `era2011: section ${code} votes for ticket ${ticket}, which is not on the ballot`,
        );
      }
      // Paper only — machine voting did not exist yet.
      addTicketVotes(section.votes, ticket, { paper: num(row[i + 1]) });
    }
  }

  return {
    cycle: source.cycle,
    round,
    date: source.rounds[round].date,
    tickets,
    sections: [...sections.values()],
    sourceEra: "2011",
  };
};
