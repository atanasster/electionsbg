// The 2001 reader — MIK encoding, INI-style blocks, one file per oblast, and a ballot
// whose vote vector is POSITIONAL.
//
// FILES (`raw_data/2001_11_11_pvr/ТУРn/`): `COMMON.<ext>` plus 33 data files —
// `000000z0.<ext>` (the national aggregate) and one per oblast, `NN0000z0.<ext>`. The
// extension is the round: `.201` for round 1, `.301` for round 2. All MIK-encoded.
//
// Each file is blocks of semicolon rows, `[NAME]` … `[END]`:
//
//   COMMON   [VID_IZB] [PARTII] [OBL] [OBSHT] [RAYON] [TOCHKI]
//   per-oblast   [INFO] [IZB] [NM] [SEC] [MAJ] [PROP] [LISTI] [PROT] [AGGR]
//
// ⚠⚠ `[PARTII]`'s ROW ORDER IS THE VOTE VECTOR'S MAPPING, AND THE NUMBERS DO NOT HELP.
// `[PROT]`'s second `+`-joined group is positional — one figure per ticket, in
// `[PARTII]` order — while the tickets keep their ROUND-1 numbers into the runoff:
//
//   ТУР2 [PARTII]   02;Петър Стефанов Стоянов и Нели Петрова Куцкова;…
//                   05;Георги Седефчов Първанов и Ангел Иванов Марин;…
//
// So round 2's two figures belong to tickets 02 and 05, and reading the vector as
// „ticket 1, ticket 2" attributes 2,043,443 votes to a candidate who was not on the
// ballot. This is 2006's trap seen from the other side: there the mapping lived in the
// readme's column numbers, here it lives in a row ORDER with misleading numbers beside
// it.
//
// ⚠ THE 2001 BALLOT WAS PUT IN AN ENVELOPE, so the protocol counts ENVELOPES where later
// eras count ballots — see `SIK` below, whose labels come from the bundle's own
// `[TOCHKI]` block rather than from an external readme.
//
// Two things this era gives that no other does:
//
//   • `[MAJ]` (per-ticket) and `[AGGR]` (the protocol totals) are published PER OBLAST
//     and again nationally in `000000z0`, and both reconcile EXACTLY with the sections —
//     verified over both rounds, 32 oblasts, 0 mismatches. The reader enforces every one
//     of them, oblast and national, and REFUSES a file that has lost either block, so a
//     dropped or double-counted section cannot pass. ⚠ The national file is reconciled
//     in a SECOND pass, because it sorts first and would otherwise be compared against
//     an empty corpus — see `readEra2001Round`.
//   • `[PARTII]`'s third column is the ticket's initials (`ПКБ+СВА`), which is an
//     INDEPENDENT check on splitting the names on „и".
//
// Plan: docs/plans/presidential-elections-v1.md T2.5.

import fs from "node:fs";
import { num, readBundleFile, sectionLookup } from "./readerKit";
import type { PresidentialEncoding } from "./encoding";
import { PRESIDENTIAL_SOURCES } from "./sources";
import {
  addTicketVotes,
  canonicalTicketKey,
  emptyProtocol,
  normaliseEkatte,
  splitTicketNames,
  type PresidentialRound,
  type PresidentialSection,
  type Ticket,
} from "./types";
import type { PresidentialSource, RoundNumber } from "./sources";

/**
 * The nine СИК protocol positions of `[PROT]`'s first `+`-joined group.
 *
 * Named by the bundle's own `[TOCHKI]` block, which is this era's field list — it is in
 * the data rather than in a readme, and it is identical in both rounds.
 *
 * ⚠ `sameListEnvelopes` (т. 8) IS NOT INVALID. An envelope holding two ballots for the
 * SAME list counts as one VALID vote; only т. 5 and т. 6 are invalid, and `[TOCHKI]`
 * states the arithmetic itself — „т. 7 = т. 5 + т. 6". Folding т. 8 into the invalid
 * count would move 73,546 valid votes nationally into the invalid column.
 */
const SIK = {
  /** 1. main roll, handover plus the day's additions — the 2006 basis, not 2011's */
  registered: 0,
  /** 2. supplementary roll, equal to the certificates to vote elsewhere */
  additional: 1,
  /** 3. signatures — the turnout numerator */
  signatures: 2,
  /** 4. ENVELOPES found in the box */
  envelopesFound: 3,
  /** 5. envelopes holding no valid-format ballot, empty ones included */
  emptyEnvelopes: 4,
  /** 6. envelopes holding ballots for DIFFERENT lists */
  mixedEnvelopes: 5,
  /** 7. invalid = т. 5 + т. 6 */
  invalid: 6,
  /** 8. envelopes holding several ballots for the SAME list — ⚠ VALID, see above */
  sameListEnvelopes: 7,
  /** 9. valid votes */
  valid: 8,
} as const;

/**
 * The twelve РИК positions of `[AGGR]`'s `+`-joined group — a different layout from
 * `SIK`, not an offset of it: it prepends the ticket count and the expected/reporting
 * section counts, and only then repeats т. 1–9 as sums.
 */
const RIK = {
  ticketCount: 0,
  sectionsExpected: 1,
  sectionsReporting: 2,
  registered: 3,
  additional: 4,
  signatures: 5,
  envelopesFound: 6,
  invalid: 9,
  valid: 11,
} as const;

/** Abroad is oblast `32` — the МИР grid, as in 2006, 2016 and 2021. Only 2011 differs. */
export const ABROAD_PREFIX_2001 = "32";

/** The cycle's DECLARED encoding — read from `sources.ts`, never re-typed as a literal. */
const ENCODING_2001: PresidentialEncoding =
  PRESIDENTIAL_SOURCES["2001_11_11_pvr"].encoding;

/** The rows of one `[NAME]` … `[END]` block, without its header. */
const blockRows = (rows: string[][], name: string): string[][] => {
  const start = rows.findIndex((r) => (r[0] ?? "").trim() === `[${name}]`);
  if (start < 0) return [];
  const out: string[][] = [];
  for (let i = start + 1; i < rows.length; i++) {
    const head = (rows[i][0] ?? "").trim();
    if (head === "[END]") break;
    // `%` opens a comment line — `[TOCHKI]` uses them as section headings.
    if (!head || head.startsWith("%")) continue;
    out.push(rows[i]);
  }
  return out;
};

const readOne = (
  dir: string,
  file: string,
  encoding: PresidentialEncoding = ENCODING_2001,
): string[][] =>
  readBundleFile("era2001", dir, file, (f) => f === file, encoding);

/**
 * The file extension each round is published under. `.201` is round 1, `.301` round 2.
 *
 * ⚠ MAPPED, NOT DERIVED FROM THE FOLDER, and the difference is a real guard rather than
 * a style choice. This reader is handed `dir` and `round` separately, so the two CAN
 * disagree — and deriving the extension from whatever `COMMON.*` happens to be present
 * makes every such folder self-consistent. Measured before the map existed:
 * `readEra2001Round("…/ТУР2", source, 1)` published all 12,192 RUNOFF sections stamped
 * `round: 1` and dated 2001-11-11, with every internal cross-check green, because each
 * file agreed with the others. Naming the extension is what turns that into a refusal.
 */
const ROUND_EXTENSION: Record<RoundNumber, string> = { 1: ".201", 2: ".301" };

/** The round's extension, refusing a folder that does not carry it. */
const roundExtension = (dir: string, round: RoundNumber): string => {
  const want = ROUND_EXTENSION[round];
  const present = fs
    .readdirSync(dir)
    .filter((f) => f.toUpperCase().startsWith("COMMON."));
  if (!present.length) {
    throw new Error(
      `era2001: no "COMMON.*" in ${dir} — it carries [PARTII], which is the only ` +
        `statement of which ticket each vote position belongs to`,
    );
  }
  if (!present.some((f) => f.endsWith(want))) {
    throw new Error(
      `era2001: ${dir} holds ${present.join(", ")}, not a "COMMON${want}" — round ` +
        `${round} is published as "${want}", so this is the wrong round's folder`,
    );
  }
  return want;
};

/**
 * Read `[PARTII]` — the ballot, IN ORDER.
 *
 * @param round - Which round's folder this is; the extension is checked against it.
 * @returns The tickets in `[PARTII]` row order, which is the order of `[PROT]`'s vote
 *   vector. Never re-sort this.
 * @throws If a row's two names cannot be split, or if the split disagrees with the row's
 *   own initials column.
 */
export const readTickets = (
  dir: string,
  round: RoundNumber,
  encoding: PresidentialEncoding = ENCODING_2001,
): Ticket[] => {
  const rows = blockRows(
    readOne(dir, `COMMON${roundExtension(dir, round)}`, encoding),
    "PARTII",
  );
  const out: Ticket[] = [];
  for (const row of rows) {
    const number = Number(row[0]);
    if (!Number.isFinite(number)) continue;
    const combined = (row[1] ?? "").trim();
    const names = splitTicketNames(combined);
    if (!names) {
      throw new Error(
        `era2001: ticket ${number} names "${combined}", which does not split on „и" ` +
          `into a president and a vice-president`,
      );
    }
    // ⚠ AN INDEPENDENT CHECK ON THE SPLIT, and the reason it is worth having: „и" is an
    // ordinary Bulgarian word, so a name containing it would cut in the wrong place and
    // produce two plausible-looking people. The row's third column is the pair's
    // initials (`ПКБ+СВА`), which the source derives from the same two names by a
    // different route — verified to agree on all 8 ticket rows across both rounds.
    const initials = (n: string): string =>
      n
        .trim()
        .split(/\s+/)
        .map((w) => [...w][0])
        .join("");
    const abbr = (row[2] ?? "").split("+").map((a) => a.trim());
    if (
      abbr.length !== 2 ||
      initials(names.president) !== abbr[0] ||
      initials(names.vicePresident) !== abbr[1]
    ) {
      throw new Error(
        `era2001: ticket ${number} splits as "${names.president}" + ` +
          `"${names.vicePresident}", whose initials disagree with the row's own ` +
          `"${row[2] ?? ""}" — the split is wrong, or the row is`,
      );
    }
    out.push({
      number,
      president: names.president,
      vicePresident: names.vicePresident,
      // The bundle names no nominating body for a ticket — 2001's ballot was by
      // candidate pair — so this stays unknown rather than being guessed, as in 2006.
      nominatedBy: { name: "", kind: "unknown" },
      canonicalKey: canonicalTicketKey(names.president),
    });
  }
  if (!out.length) {
    throw new Error(`era2001: no [PARTII] rows in ${dir}`);
  }
  return out;
};

/** The per-oblast data files, national aggregate excluded — see `readEra2001Round`. */
const oblastFiles = (dir: string, ext: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.toUpperCase().startsWith("COMMON."))
    .sort();

/**
 * Read one round of the 2001 cycle.
 *
 * @param dir - The round folder (`raw_data/<cycle>/ТУРn`).
 * @param source - The cycle's entry in `sources.ts`.
 * @param round - 1 or 2.
 * @returns Every section, with its protocol and per-ticket votes. All votes are PAPER.
 * @throws If any file's own `[MAJ]` or `[AGGR]` disagrees with the sections read from
 *   it, if either block is MISSING, or if the national aggregate disagrees with the
 *   whole corpus — a dropped, duplicated or mis-parsed section cannot survive that.
 */
export const readEra2001Round = (
  dir: string,
  source: PresidentialSource,
  round: RoundNumber,
): PresidentialRound => {
  const encoding = source.encoding;
  const ext = roundExtension(dir, round);
  const tickets = readTickets(dir, round, encoding);

  const sections = new Map<string, PresidentialSection>();

  // ⚠⚠ TWO PASSES, AND THE ORDER IS THE WHOLE POINT. `000000z0` carries no `[PROT]` — it
  // is the NATIONAL cross-check — and it sorts FIRST by filename. Reconciling it inside
  // one pass therefore compared it against an EMPTY section map and returned before
  // asserting anything: measured, corrupting its registered / signatures / valid figures
  // to 7777777 / 8888888 / 9999999 read perfectly clean. The strongest guard this era
  // has was dead. Aggregate-only files are deferred to the end so they see the whole
  // corpus.
  const aggregateOnly: { file: string; rows: string[][] }[] = [];

  for (const file of oblastFiles(dir, ext)) {
    const rows = readOne(dir, file, encoding);
    const prot = blockRows(rows, "PROT");

    // Driven off the block's emptiness rather than off the filename, so a bundle that
    // names the national file differently is still handled — and one that starts
    // publishing sections there is read rather than silently skipped.
    if (!prot.length) {
      aggregateOnly.push({ file, rows });
      continue;
    }

    // `[NM]`: obshtinaKey(4); settlementNo(3); name; ЕКАТТЕ(5); …
    const places = new Map<string, { name: string; ekatte?: string }>();
    for (const r of blockRows(rows, "NM")) {
      places.set(`${(r[0] ?? "").trim()}/${(r[1] ?? "").trim()}`, {
        name: (r[2] ?? "").trim(),
        ekatte: normaliseEkatte(r[3] ?? ""),
      });
    }

    // `[SEC]`: oblast(2); obshtina+rayon(4); section(3); electionType; settlementNo(3)
    for (const r of blockRows(rows, "SEC")) {
      const oblast = (r[0] ?? "").trim();
      const obshtinaRayon = (r[1] ?? "").trim();
      const code = `${oblast}${obshtinaRayon}${(r[2] ?? "").trim()}`;
      // ⚠ A SECTION CAN SERVE SEVERAL SETTLEMENTS — 62 of them do, in both rounds, and
      // the field is then `+`-joined („020+010"). Their ЕКАТТЕ is genuinely ambiguous,
      // so it is left ABSENT rather than resolved to whichever came first: the code is
      // the aggregator's join key for a settlement, and picking one would file a whole
      // section's votes in a village that provided part of it.
      const ids = (r[4] ?? "").trim().split("+").filter(Boolean);
      // ⚠ An EMPTY list would satisfy `every`/`some` vacuously and publish a section
      // with no place at all, so it is refused rather than passing the guard below.
      if (!ids.length) {
        throw new Error(
          `era2001: section ${code} in ${file} names no settlement at all`,
        );
      }
      const resolved = ids.map((id) =>
        places.get(`${oblast}${obshtinaRayon.slice(0, 2)}/${id}`),
      );
      if (resolved.some((p) => !p)) {
        throw new Error(
          `era2001: section ${code} names settlement(s) ${ids.join("+")}, which [NM] ` +
            `in ${file} does not carry`,
        );
      }
      const existing = sections.get(code);
      if (existing) {
        throw new Error(
          `era2001: section ${code} appears twice — once already, and again in [SEC] ` +
            `of ${file}`,
        );
      }
      sections.set(code, {
        code,
        round,
        ekatte: resolved.length === 1 ? resolved[0]!.ekatte : undefined,
        placeName: resolved.map((p) => p!.name).join(" / "),
        isMobile: false,
        isShip: false,
        machines: 0,
        protocol: emptyProtocol(),
        votes: [],
        ...(oblast === ABROAD_PREFIX_2001
          ? {
              // This era names only a city, never a country — resolving it is the
              // aggregator's job (T3.1), and it is never guessed here.
              abroad: {
                country: null,
                city: resolved.map((p) => p!.name).join(" / "),
              },
            }
          : {}),
      });
    }

    const sectionOf = sectionLookup("era2001", sections);

    // `[PROT]`: type; oblast(2); obshtina+rayon(4); section(3); protocol+…; votes+…
    for (const r of prot) {
      const code = `${(r[1] ?? "").trim()}${(r[2] ?? "").trim()}${(r[3] ?? "").trim()}`;
      const section = sectionOf(code, `[PROT] of ${file}`);
      const p = section.protocol;
      const f = (r[4] ?? "").split("+");
      p.numRegisteredVoters = num(f[SIK.registered]);
      p.numAdditionalVoters = num(f[SIK.additional]);
      p.totalActualVoters = num(f[SIK.signatures]);
      p.numPaperBallotsFound = num(f[SIK.envelopesFound]);
      p.numInvalidBallotsFound = num(f[SIK.invalid]);
      p.numValidVotes = num(f[SIK.valid]);
      // ⚠ No „не подкрепям никого" before 2016, so it is left ABSENT rather than 0.

      const v = (r[5] ?? "").split("+");
      // ⚠ POSITIONAL — the i-th figure is the i-th [PARTII] row, NOT ticket i. See the
      // banner: round 2's two figures belong to tickets 02 and 05.
      if (v.length !== tickets.length) {
        throw new Error(
          `era2001: section ${code} carries ${v.length} vote figures against ` +
            `${tickets.length} tickets in [PARTII] — the vector is positional, so a ` +
            `mismatch would attribute votes to the wrong candidates`,
        );
      }
      tickets.forEach((t, i) => {
        addTicketVotes(section.votes, t.number, { paper: num(v[i]) });
      });
    }

    verifyAggregate(file, rows, sections, tickets, /* national */ false);
  }

  for (const { file, rows } of aggregateOnly) {
    verifyAggregate(file, rows, sections, tickets, /* national */ true);
  }
  const nationalChecked = aggregateOnly.length > 0;

  if (!nationalChecked) {
    throw new Error(
      `era2001: ${dir} holds no national aggregate file (one with [AGGR] and no ` +
        `[PROT]) — that file is the corpus-wide cross-check`,
    );
  }

  return {
    cycle: source.cycle,
    round,
    date: source.rounds[round].date,
    tickets,
    sections: [...sections.values()],
    sourceEra: "2001",
  };
};

/**
 * Reconcile a file's own published totals against the sections read so far.
 *
 * ⚠ ENFORCED, NOT REPORTED, and that is what this era buys over the others: the source
 * publishes `[MAJ]` (per ticket) and `[AGGR]` (the protocol totals) per oblast AND
 * nationally, and both agree with the sections EXACTLY — measured over both rounds, 32
 * oblasts, zero mismatches. So a dropped section, a duplicated one, a mis-split `+`
 * group or a vote vector read in the wrong order all fail here rather than being
 * discovered by a national anchor much later.
 *
 * @param national - When true, reconcile against EVERY section read; otherwise against
 *   the sections of this oblast alone.
 */
const verifyAggregate = (
  file: string,
  rows: string[][],
  sections: Map<string, PresidentialSection>,
  tickets: Ticket[],
  national: boolean,
): void => {
  // ⚠⚠ FAILS CLOSED. Returning quietly on a missing block would make the cross-check
  // vanish exactly when the file is damaged, which is when it is worth having: measured
  // before this, stripping oblast 01's two blocks and duplicating one [PROT] row
  // published Първанов at 1,032,789 against a true 1,032,665, with no error anywhere.
  const aggr = blockRows(rows, "AGGR")[0];
  const maj = blockRows(rows, "MAJ");
  if (!aggr || !maj.length) {
    throw new Error(
      `era2001: ${file} carries ${!aggr ? "no [AGGR]" : "no [MAJ]"} block — those are ` +
        `the source's own totals and the only independent check on the sections`,
    );
  }
  const oblast = (aggr[0] ?? "").trim();
  const mine = [...sections.values()].filter(
    (s) => national || s.code.startsWith(oblast),
  );
  if (!mine.length) {
    throw new Error(
      `era2001: ${file} publishes aggregates for ${national ? "the country" : `oblast ${oblast}`}, ` +
        `but no sections were read for it`,
    );
  }

  const a = (aggr[3] ?? "").split("+").map(Number);
  const totals = {
    sections: mine.length,
    registered: 0,
    additional: 0,
    signatures: 0,
    envelopesFound: 0,
    invalid: 0,
    valid: 0,
  };
  for (const s of mine) {
    totals.registered += s.protocol.numRegisteredVoters ?? 0;
    totals.additional += s.protocol.numAdditionalVoters ?? 0;
    totals.signatures += s.protocol.totalActualVoters;
    totals.envelopesFound += s.protocol.numPaperBallotsFound ?? 0;
    totals.invalid += s.protocol.numInvalidBallotsFound ?? 0;
    totals.valid += s.protocol.numValidVotes ?? 0;
  }
  const expect = (
    block: string,
    label: string,
    got: number,
    want: number,
  ): void => {
    if (got !== want) {
      throw new Error(
        `era2001: ${file}'s [${block}] says ${label} = ${want}, the sections say ${got}`,
      );
    }
  };
  // ⚠ BOTH section counts, because they answer different questions: `sectionsExpected`
  // is how many the commission was owed and `sectionsReporting` how many filed. They are
  // equal throughout this corpus, and `mine.length` is the count of sections we actually
  // built — so checking it against both is what would catch a file where they diverge.
  expect("AGGR", "sections expected", totals.sections, a[RIK.sectionsExpected]);
  expect(
    "AGGR",
    "sections reporting",
    totals.sections,
    a[RIK.sectionsReporting],
  );
  expect("AGGR", "registered", totals.registered, a[RIK.registered]);
  expect("AGGR", "additional", totals.additional, a[RIK.additional]);
  expect("AGGR", "signatures", totals.signatures, a[RIK.signatures]);
  expect(
    "AGGR",
    "envelopes found",
    totals.envelopesFound,
    a[RIK.envelopesFound],
  );
  // ⚠ THE CHECK THAT DEFENDS THE т. 8 DECISION. `SIK.sameListEnvelopes` is VALID, not
  // invalid — 73,546 votes nationally — and reading that position as invalid instead
  // would show up here and nowhere else in the reader.
  expect("AGGR", "invalid", totals.invalid, a[RIK.invalid]);
  expect("AGGR", "valid", totals.valid, a[RIK.valid]);
  expect("AGGR", "tickets", tickets.length, a[RIK.ticketCount]);

  // `[MAJ]`: oblast; type; …; ticketNumber; …; names; …; abbr; VOTES; …
  const byTicket = new Map<number, number>();
  for (const s of mine) {
    for (const v of s.votes) {
      byTicket.set(v.partyNum, (byTicket.get(v.partyNum) ?? 0) + v.totalVotes);
    }
  }
  const known = new Set(tickets.map((t) => t.number));
  for (const m of maj) {
    const number = Number(m[3]);
    if (!known.has(number)) {
      throw new Error(
        `era2001: [MAJ] in ${file} reports ticket ${number}, which is not in [PARTII]`,
      );
    }
    expect("MAJ", `ticket ${number}`, byTicket.get(number) ?? 0, Number(m[9]));
  }
};
