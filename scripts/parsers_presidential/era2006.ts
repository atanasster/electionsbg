// The 2006 reader — windows-1251, three files per round, and a ticket list that exists
// only in prose.
//
// FILES (`raw_data/2006_10_22_pvr/ТУРn/`): `Readme.txt`, `izbori2006_Tn_protocols.txt`,
// `izbori2006_tn_sections.txt`. All windows-1251. Note the case: the protocols file
// spells the round `T1`/`T2` and the sections file `t1`/`t2`.
//
// ⚠ THERE IS NO CANDIDATES FILE. The ballot is published as PROSE inside `Readme.txt`,
// as the tail of the protocol's own field list:
//
//     17) Гласове за 1. Неделчо Беронов, Юлиана Николова
//     …
//     23) Гласове за 7. Георги Марков, Мария Цонева-Иванова
//
// So the readme is not documentation here — it is the only statement of which column
// holds which ticket, and it must be parsed rather than assumed.
//
// ⚠⚠ AND THE COLUMN ORDER IS NOT THE TICKET ORDER IN ROUND 2. The runoff keeps the
// candidates' ROUND-1 numbers while re-packing them into the first two vote columns:
//
//     17) Гласове за 3. Георги Първанов, Ангел Марин
//     18) Гласове за 6. Волен Сидеров, Павел Шопов
//
// A reader that assumed „first vote column = ticket 1" would publish Първанов's
// 2,050,488 against a candidate who was not in the runoff, at no error and with the
// national total still exact. Every column→ticket mapping comes from the readme.
//
// Three smaller differences from the later eras:
//
//   • the two names are separated by a COMMA, not „и", so `splitTicketNames` is not used;
//   • the bundle names no NOMINATOR at all — not for any ticket, in either round — so
//     `nominatedBy` is empty with kind `unknown`. That is the source's silence, recorded;
//     inventing a party here would be a claim about a real candidate that nothing backs.
//   • the sections file carries only `code; населено място; ЕКАТТЕ` — no oblast and no
//     obshtina name, unlike 2011.
//
// Plan: docs/plans/presidential-elections-v1.md T2.4.

import { num, readBundleFile, sectionLookup } from "./readerKit";
import type { PresidentialEncoding } from "./encoding";
import { PRESIDENTIAL_SOURCES } from "./sources";
import {
  addTicketVotes,
  canonicalTicketKey,
  emptyProtocol,
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
 * ⚠ Only `section` is shared with the sections file, whose other two columns are a place
 * name and an ЕКАТТЕ — nothing here means anything there. The vote columns start after
 * this block and are mapped by the readme, never by position; see `readTickets`.
 */
const F = {
  /** 1) the 9-digit section code */
  section: 0,
  /** 4) точка В — сгрешени бюлетини, destroyed */
  spoiled: 3,
  /**
   * 5) точка 1 — the MAIN list.
   *
   * ⚠ A DIFFERENT BASIS FROM 2011's „registered", and the readme says so: this figure is
   * „при предаването му на СИК ПЛЮС броя на дописаните в него в изборния ден", i.e.
   * handover plus the day's additions already summed. 2011 publishes those two
   * separately (its fields 3 and 4). So `numRegisteredVoters` is NOT comparable across
   * the two eras on its own — only `registered + additional` is, and it reconciles:
   * 6,403,911 + 26,206 = 6,430,117, the published 2006 electorate.
   */
  registered: 4,
  /** 6) точка 2 — the supplementary list */
  additional: 5,
  /** 7) точка 3 — signatures. ⚠ Published as 0 for every abroad section, which is
   *  not a count; see `signaturesUnreported` and `ABROAD_PREFIX_2006`. */
  signatures: 6,
  /** 10) точка 6 — ballots found in the boxes */
  found: 9,
  /** 15) точка 11 — invalid, the sum of точки 7–10 */
  invalid: 14,
  /** 16) точка 12 — valid, and this era having no „никого", the ticket total */
  valid: 15,
} as const;

/** SECTIONS columns: `code; населено място; ЕКАТТЕ`. */
const S = { place: 1, ekatte: 2 } as const;

/**
 * Abroad is prefix `32` here — the МИР grid, the same one 2016 and 2021 run on. Only
 * 2011 differs, at `29`.
 *
 * ⚠ Suffixed with the era on purpose, matching `ABROAD_PREFIX_2011`: the grids genuinely
 * disagree, and the aggregator (T3.1) imports both, where a bare `ABROAD_PREFIX` at a
 * call site would not say which one it is. It is deliberately NOT hoisted into a shared
 * `ABROAD_PREFIX_MIR` — 2016 and 2021 identify an abroad section by its protocol FORM
 * rather than by a code prefix, so the constant would have exactly these two users while
 * reading as though it had four. (`era2021`'s `MACHINE_VOTE_FORMS` also contains `"32"`,
 * as a FORM number; the collision is a coincidence and a shared name would invite it.)
 */
export const ABROAD_PREFIX_2006 = "32";

const FILE_PREFIX = "izbori2006_";

/** The cycle's DECLARED encoding — read from `sources.ts`, never re-typed as a literal,
 *  so a correction there actually reaches this parser. */
const ENCODING_2006: PresidentialEncoding =
  PRESIDENTIAL_SOURCES["2006_10_22_pvr"].encoding;

/**
 * ⚠ The two data files differ in CASE on the round marker — `izbori2006_T1_protocols`
 * against `izbori2006_t1_sections` — so the match is case-insensitive on the whole name
 * rather than exact. Anchoring on the prefix as well keeps a flattened re-extraction from
 * matching some other race's file, the way the 2011 reader does.
 */
const readFile = (
  dir: string,
  kind: "protocols" | "sections" | "readme",
  encoding: PresidentialEncoding = ENCODING_2006,
): string[][] =>
  readBundleFile(
    "era2006",
    dir,
    kind === "readme" ? "Readme.txt" : `${FILE_PREFIX}t<n>_${kind}.txt`,
    (f) => {
      const lower = f.toLowerCase();
      return kind === "readme"
        ? lower === "readme.txt"
        : lower.startsWith(FILE_PREFIX) && lower.endsWith(`_${kind}.txt`);
    },
    encoding,
  );

/** One ballot line of the readme: which COLUMN holds which TICKET. */
export interface TicketColumn {
  /** 0-based index into a protocol row. */
  column: number;
  ticket: Ticket;
}

/**
 * ⚠ The readme is read as SEMICOLON rows like every other file, so a line arrives as a
 * one-element array. Joining it back is deliberate rather than a workaround: it keeps
 * every file in this bundle on one decoder and one splitter, so a future line that does
 * contain a semicolon cannot silently lose its tail.
 */
const BALLOT_LINE = /^\s*(\d+)\)\s*Гласове\s+за\s+(\d+)\.\s*(.+?)\s*$/u;

/**
 * Read the ballot out of `Readme.txt`.
 *
 * @returns One entry per vote column, in readme order.
 * @throws If a ballot line names no two candidates, if two lines claim one column or one
 *   ticket number, or if the file holds none at all — each of which would otherwise
 *   publish votes against the wrong person.
 */
export const readTickets = (
  dir: string,
  encoding: PresidentialEncoding = ENCODING_2006,
): TicketColumn[] => {
  const out: TicketColumn[] = [];
  const seenColumn = new Set<number>();
  const seenTicket = new Set<number>();
  for (const row of readFile(dir, "readme", encoding)) {
    const m = BALLOT_LINE.exec(row.join(";"));
    if (!m) continue;
    const column = Number(m[1]) - 1;
    const number = Number(m[2]);
    // ⚠ A COMMA, not „и". „Петър Берон, Стела Ангелова-Банкова" carries a hyphen a name
    // splitter must not touch, and „и" appears inside no separator here — requiring
    // exactly one comma is what makes a malformed line fail rather than silently produce
    // a president with an empty running mate.
    const parts = m[3].split(",").map((p) => p.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `era2006: ballot line "${m[0].trim()}" does not name exactly two candidates`,
      );
    }
    // Branched rather than combined: a readme giving ONE column two tickets and one
    // giving two columns the SAME ticket are different corruptions of the ballot, and a
    // single message sends the reader back to the file to work out which.
    if (seenColumn.has(column)) {
      throw new Error(
        `era2006: the readme in ${dir} repeats column ${column + 1}`,
      );
    }
    if (seenTicket.has(number)) {
      throw new Error(`era2006: the readme in ${dir} repeats ticket ${number}`);
    }
    seenColumn.add(column);
    seenTicket.add(number);
    out.push({
      column,
      ticket: {
        number,
        president: parts[0],
        vicePresident: parts[1],
        // ⚠ The bundle names no nominating party or committee for ANY ticket, in either
        // round. Recorded as absent rather than guessed: naming a party here would be an
        // assertion about a real candidate that nothing in the source supports.
        nominatedBy: { name: "", kind: "unknown" },
        canonicalKey: canonicalTicketKey(parts[0]),
      },
    });
  }
  if (!out.length) {
    throw new Error(
      `era2006: no "NN) Гласове за K. Име, Име" lines in the readme in ${dir} — ` +
        `this bundle has no candidates file, so that prose IS the ballot`,
    );
  }

  // ⚠⚠ THE BALLOT COLUMNS MUST BE A CONTIGUOUS RUN FROM `F.valid + 1`, AND THIS IS THE
  // ONLY THING STANDING BETWEEN A NEAR-MISS AND SILENT VOTE LOSS. A readme line that
  // fails `BALLOT_LINE` is skipped, and „no lines at all" is a weak completeness test —
  // any PROPER SUBSET of the ballot parses happily, so one reflowed line, one different
  // dash or one stray character in a future re-download drops a whole ticket's votes
  // with the national total simply smaller and nothing failing.
  //
  // What makes this a check rather than a guess: the protocol's own field block ends at
  // `F.valid`, so where the votes START is known INDEPENDENTLY of the prose. A gap in
  // the run therefore means a line this reader could not parse, and a column past the
  // end means a ticket the file has no data for — which `num()` would otherwise publish
  // as a real candidate at 0 votes, the same fabricated-claim class `nominatedBy`'s
  // `unknown` exists to refuse.
  const first = F.valid + 1;
  const got = out.map((c) => c.column).sort((a, b) => a - b);
  if (got.some((c, i) => c !== first + i)) {
    throw new Error(
      `era2006: the readme in ${dir} maps ballot columns ` +
        `${got.map((c) => c + 1).join(", ")}, which is not a contiguous run from ` +
        `${first + 1} — the protocol's own fields end at ${F.valid + 1}, so a gap here ` +
        `is a ballot line this reader failed to parse`,
    );
  }
  return out;
};

interface SectionMeta {
  placeName: string;
  ekatte?: string;
}

/** `code; населено място; ЕКАТТЕ` — no oblast or obshtina name in this era. */
export const readSections = (
  dir: string,
  encoding: PresidentialEncoding = ENCODING_2006,
): Map<string, SectionMeta> => {
  const out = new Map<string, SectionMeta>();
  for (const row of readFile(dir, "sections", encoding)) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    // The place name and ЕКАТТЕ are the ONLY things this file contributes, and ЕКАТТЕ is
    // the key the aggregator resolves settlement → municipality → oblast through. A
    // repeated code would silently take the later row's, relocating a section's votes to
    // another settlement with every count still reconciling.
    if (out.has(code)) {
      throw new Error(
        `era2006: section ${code} appears twice in the sections file — the later row ` +
          `would take over its place name and ЕКАТТЕ, and ЕКАТТЕ is the aggregator's ` +
          `join key`,
      );
    }
    out.set(code, {
      placeName: (row[S.place] ?? "").trim(),
      ekatte: normaliseEkatte(row[S.ekatte] ?? ""),
    });
  }
  if (!out.size) throw new Error(`era2006: no sections in ${dir}`);
  return out;
};

/**
 * Read one round of the 2006 cycle.
 *
 * @param dir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 * @returns Every section, with its protocol and per-ticket votes. All votes are PAPER —
 *   machine voting did not exist in 2006.
 */
export const readEra2006Round = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const encoding = source.encoding;
  const columns = readTickets(dir, encoding);
  const meta = readSections(dir, encoding);

  const sections = new Map<string, PresidentialSection>();
  for (const [code, m] of meta) {
    const abroad = code.startsWith(ABROAD_PREFIX_2006);
    sections.set(code, {
      code,
      round,
      ekatte: m.ekatte,
      placeName: m.placeName,
      isMobile: false,
      isShip: false,
      machines: 0,
      protocol: emptyProtocol(),
      votes: [],
      // This era names only a CITY („Стокхолм"), never a country — and abroad rows carry
      // no ЕКАТТЕ, which is why `normaliseEkatte` returns undefined for them rather than
      // padding an empty string into a code.
      ...(abroad ? { abroad: { country: null, city: m.placeName } } : {}),
    });
  }
  const sectionOf = sectionLookup("era2006", sections);

  const lastBallot = columns[columns.length - 1].column;
  const seenProtocol = new Set<string>();
  for (const row of readFile(dir, "protocols", encoding)) {
    const code = (row[F.section] ?? "").trim();
    if (!code) continue;
    const section = sectionOf(code, "protocols");
    // ⚠ A SECOND ROW FOR ONE SECTION DOUBLES ITS TALLY, and neither the section count nor
    // the per-ticket count moves. The votes here are COLUMNS of this row and
    // `addTicketVotes` sums by design (it must — 2021's machines are separate rows), so
    // reading the same row twice adds the same numbers twice. Measured on a fixture: a
    // ticket at 50 becomes 100, with the protocol fields also silently overwritten.
    if (seenProtocol.has(code)) {
      throw new Error(
        `era2006: section ${code} appears twice in protocols — the votes are COLUMNS of ` +
          `this row and addTicketVotes sums, so a second row doubles this section's tally`,
      );
    }
    seenProtocol.add(code);
    // The other half of the readme-vs-file check (see `readTickets`): a value past the
    // last ballot column means the file holds a ticket the readme does not name, whose
    // votes would be dropped. Measured over both committed rounds — every row is exactly
    // 24 cells in R1 and 19 in R2, and not one carries a non-blank cell past its last
    // ballot column.
    if (row.slice(lastBallot + 1).some((c) => (c ?? "").trim() !== "")) {
      throw new Error(
        `era2006: protocol row ${code} carries a value past ballot column ` +
          `${lastBallot + 1}, so the readme names fewer tickets than the file holds — ` +
          `those votes would be dropped`,
      );
    }
    const p = section.protocol;
    p.numRegisteredVoters = num(row[F.registered]);
    p.numAdditionalVoters = num(row[F.additional]);
    p.numInvalidAndDestroyedPaperBallots = num(row[F.spoiled]);
    p.numPaperBallotsFound = num(row[F.found]);
    p.numInvalidBallotsFound = num(row[F.invalid]);
    p.numValidVotes = num(row[F.valid]);
    // ⚠ No „не подкрепям никого" before 2016, so it is left ABSENT rather than 0 — the
    // form did not ask, which is a different fact from nobody choosing it.

    // ⚠⚠ THE ABROAD SIGNATURE FIGURE IS NOT A COUNT, AND READING THE 0 AS ONE IS A CLAIM.
    // ⚠ This is an INFERENCE from the pattern, not something the file states — the cell
    // is a literal „0" in all 288 abroad rows and never empty. The evidence: measured
    // over both rounds, all 144 prefix-32 sections carry точка 3 = 0 while holding
    // 46,113 valid votes in round 1, and NOT ONE of the 11,665 domestic sections does.
    // Read as a count that is 0% turnout abroad against real ballots — and it hides
    // inside a national sum that still reconciles. The shared `SectionProtocol` requires
    // the field, so the published value stays and `signaturesUnreported` carries the
    // distinction; see its docblock, and plan §2.5-3.
    p.totalActualVoters = num(row[F.signatures]);
    // FINDING-008: one spelling of „is this abroad", so a future change to what counts
    // reaches both sites.
    if (section.abroad && p.totalActualVoters === 0) {
      section.signaturesUnreported = true;
    }

    for (const { column, ticket } of columns) {
      // Paper only — machine voting did not exist yet.
      addTicketVotes(section.votes, ticket.number, { paper: num(row[column]) });
    }
  }

  return {
    cycle: source.cycle,
    round,
    date: source.rounds[round].date,
    tickets: columns.map((c) => c.ticket),
    sections: [...sections.values()],
    sourceEra: "2006",
  };
};
