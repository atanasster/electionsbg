// Presidential surfaces — the five levels §5.0 emits for this kind.
//
// FIVE of the six presidential levels get an artifact: region, abroad, municipality,
// settlement and section. Only `country` is served from its canonical file, because
// `national_summary.json` is 13.6 KB against a 24 KiB budget. `surfacePath.ts` is the
// authority on which, and every row there was measured before it was declared.
//
// ⚠⚠ THE TREE IS PER ROUND, AND THAT IS THE SHAPE OF THIS FILE. Below the country each level
// is ONE file per round covering the whole country, so a place's surface is assembled by
// reading the same file twice — once per round — and emitting ONE surface carrying up to two
// BALLOTS. A presidential page is not two pages; it is one place, two rounds, and the runoff
// is the answer to the first round rather than a separate election.
//
// ⚠ A TICKET IS NOT A PARTY LIST, so a ranked row carries `candidateName` and a NULL
// `partyId` — the shape the mayoral ballot already uses, and for the same reason: the option
// on the ballot is a PERSON. Its nominating body may be a party, a coalition or an
// инициативен комитет, three legally distinct things, so resolving it to a canonical party id
// would label two of them wrongly. The ballot NUMBER rides in `localPartyNum`; that field's
// name says „local" and its docblock says „ballots number their own lists", which is what a
// presidential ballot does — the friction is in the name, not in the meaning.
//
// ⚠⚠ THE TURNOUT RULE IS IMPORTED, NEVER RESTATED. `ballotTotalsFrom` carries the guards a
// presidential-only copy would lose: a place whose votes exceed its voters, a `cast > denom`
// overflow, and the definitional abroad suppression. What this file adds is ONE suppression
// only this corpus needs — `turnoutBasis: null`, which is abroad by definition. A place whose
// sections ALL report точка 3 = 0 while casting real votes (Бобошево 2011 is all eleven of
// its own) needs no clause: the shared self-consistency guard already refuses it, and a
// blanket one was measured too broad — see `totalsFrom`.
//
// ⚠ THE COUNTRY FIGURE IN `national_summary.json` USES A DIFFERENT DENOMINATOR ON PURPOSE.
// Art. 93 (3) is argued on the roll alone, so that file divides by registered voters; a
// SURFACE divides by registered plus additional, like every other surface in this repo. The
// two differ by up to 1.64 points (2021: 40.30% against 38.67%) and answer different
// questions — „did anyone clear the constitutional bar" and „how many of the people who could
// vote here did".
//
// ⚠ NOTHING HERE READS THE CLOCK. §9's byte-identical rebuild gate requires `status.updatedAt`
// to come from the source file's mtime, never from generation time.
//
// Plan: docs/plans/presidential-elections-v1.md Tier 5.

import fs from "node:fs";
import path from "node:path";
import {
  ELECTION_SURFACE_VERSION,
  type BallotKind,
  type ElectionMapMeta,
  type ElectionPlaceLevel,
  type ElectionRankedEntry,
  type ElectionSurfaceBallot,
  type ElectionFactCode,
  type ElectionSurfaceFact,
  type ElectionSurfaceV1,
  type ElectionBallotTotals,
  MAX_BALLOT_PREVIEW,
} from "../../src/data/elections/surfaceTypes";
import {
  ballotTotalsFrom,
  type Protocol,
} from "../../src/data/elections/ballotTotals";
import {
  ballotMapMeta,
  descriptorFor,
} from "../../src/screens/elections/electionSurfaceDescriptors";
import { buildDestinations } from "./source_links";
import {
  UNPLACED_SHARD,
  type ProtocolSum,
  type Rollup,
} from "../parsers_presidential/aggregate";
import type { Votes } from "../../src/data/dataTypes";

export const DATA_ROOT = path.join(process.cwd(), "data");

/** The two rounds, as folder names. A cycle decided in round 1 would have only the first. */
const ROUNDS = [1, 2] as const;
export type RoundNo = (typeof ROUNDS)[number];

// ─── ticket identity (§5.3: the artifact carries a reference or a person, never a party) ────

export type Ticket = {
  number: number;
  president: string;
  vicePresident: string;
  nominatedBy: { name: string; kind: string };
};

export type TicketIndex = Map<number, Ticket>;

/**
 * Read a cycle's ballot lines, keyed by number.
 *
 * ⚠ THE NUMBER IS THE KEY AND IT IS PER CYCLE. It is stable across a cycle's two rounds —
 * measured on all five, the runoff keeps the round-1 numbers — and means nothing across
 * cycles, where 13 is Радев in 2016 and nobody in 2021. Nothing here may join on it.
 */
export const loadTickets = (cycle: string, root = DATA_ROOT): TicketIndex => {
  const p = path.join(root, cycle, "tickets.json");
  if (!fs.existsSync(p)) return new Map();
  const file = JSON.parse(fs.readFileSync(p, "utf8")) as { tickets: Ticket[] };
  return new Map(file.tickets.map((t) => [t.number, t]));
};

/**
 * Rank a place's ticket votes.
 *
 * ⚠ THE DENOMINATOR IS THE TICKET SUM, matching `validVotesOf` — the same rule the
 * parliamentary builder's own banner insists on, for the same reason: it is the only figure a
 * ranking can add up to. „не подкрепям никого" is a valid vote and is NOT in it, so these
 * shares sum to just under 100 on a 2016+ cycle. That is the honest arithmetic for a ranking
 * of the options; the constitutional test uses the wider denominator and lives in
 * `national_summary.json`.
 *
 * @param votes - The place's per-ticket rows.
 * @param tickets - The cycle's ballot lines.
 * @param validVotes - The ticket sum, from `ballotTotalsFrom`.
 * @returns At most `MAX_BALLOT_PREVIEW` rows, best first.
 */
export const rankedTickets = (
  votes: readonly Votes[],
  tickets: TicketIndex,
  validVotes: number,
): ElectionRankedEntry[] => {
  const sorted = [...votes]
    .filter((v) => (v.totalVotes || 0) > 0)
    // ⚠ Ties broken on the ballot number, so a rebuild cannot reorder two tickets with equal
    // votes (§9's byte-identical rebuild).
    .sort((a, b) => b.totalVotes - a.totalVotes || a.partyNum - b.partyNum)
    .slice(0, MAX_BALLOT_PREVIEW);
  return sorted.map((v, i) => {
    const pct = validVotes > 0 ? (v.totalVotes / validVotes) * 100 : 0;
    const t = tickets.get(v.partyNum);
    return {
      // ⚠ NULL, ALWAYS. A ticket has no canonical party: its nominator may be a party, a
      // coalition or an инициативен комитет, and resolving all three to a party id would
      // label two of them wrongly on a page about a named person.
      partyId: null,
      localPartyNum: v.partyNum,
      // ⚠ Bulgarian in BOTH languages and never transliterated — the reader is matching it
      // against a ballot or a protocol scan, both of which print Cyrillic (§5.3).
      candidateName: t?.president,
      votes: v.totalVotes,
      pct: Number(pct.toFixed(2)),
      ...(i === 0 && sorted[1]
        ? {
            marginPct: Number(
              (pct - (sorted[1].totalVotes / (validVotes || 1)) * 100).toFixed(
                2,
              ),
            ),
          }
        : {}),
    } satisfies ElectionRankedEntry;
  });
};

/**
 * A place's ballot totals for one round.
 *
 * ⚠ ONE SUPPRESSION THIS CORPUS NEEDS ON TOP OF THE SHARED RULE: `turnoutBasis === null`,
 * which is ABROAD, by definition rather than by arithmetic (decision 6). Almost everyone
 * joins the list at the section on the day, so the rate measures a registration regime —
 * measured, it renders 87–98% for every country with the shared `cast > denom` guard never
 * firing, i.e. plausible and meaningless.
 *
 * ⚠⚠ AND A FULL SIGNATURE GAP NEEDS NO CLAUSE HERE, WHICH IS WHY THERE IS NOT ONE. A place
 * whose sections all report точка 3 = 0 while casting real votes — Бобошево 2011 is all
 * eleven of its own, 17 registered against 1,812 ticket votes — has `votesCast` 0 against a
 * positive `validVotes`, and the SHARED rule's self-consistency guard („more valid votes than
 * voters is impossible") already refuses it. A blanket `sectionsWithoutSignatures > 0` was
 * tried and is too broad. Measured over ROUND 1 of all five cycles — the round these figures
 * come from, and the one the fact strip describes: the gap is FULL in 1 municipality and 10
 * settlements, every one of which the shared guard catches, and PARTIAL in two regions (KNL
 * 2011 at 4.0% of its sections, S23 2016 at 0.2%).
 * a whole oblast's turnout for an eleven-section gap, where the rate is understated by a
 * bounded amount rather than meaningless. `ProtocolSum.sectionsWithoutSignatures` carries the
 * gap so a later surface field can STATE it; `ElectionBallotTotals` has nowhere to put it
 * today, which is the honest reason it is not stated.
 */
export const totalsFrom = (
  protocol: ProtocolSum,
  votes: readonly Votes[],
): ElectionBallotTotals => {
  // ⚠⚠ A FULL SIGNATURE GAP MUST NOT PUBLISH `votes_cast: 0`. `ProtocolSum.signatures` is a
  // `number`, so the shared rule's own `?? validVotes` fallback can never fire on it — and
  // `votes_cast` is SECOND in the abroad fact priority, so all 48 of 2006's abroad places
  // rendered „0 гласували" beside a positive valid-vote count and 119 ballots found. The true
  // figure is in this same struct; §2.5-3 already prescribes falling back to ballots found for
  // exactly this population, and `PresidentialSection.signaturesUnreported`'s own docblock says
  // so. `null` where even that is 0, so the shared fallback is re-armed rather than a zero
  // reinstated.
  const fullGap =
    protocol.sections > 0 &&
    protocol.sectionsWithoutSignatures === protocol.sections;
  return ballotTotalsFrom(
    {
      numRegisteredVoters: protocol.registeredVoters,
      numAdditionalVoters: protocol.additionalVoters,
      totalActualVoters: fullGap
        ? protocol.ballotsFound || null
        : protocol.signatures,
      numInvalidBallotsFound: protocol.invalidBallots,
    },
    votes,
    protocol.turnoutBasis === null,
  );
};

/**
 * The facts a presidential level publishes.
 *
 * ⚠ IT IS NOT `parliamentarySurface.factsFor`, which hard-codes `descriptorFor("parliamentary",
 * …)` and knows neither of this kind's two own codes. What it DOES share is the shape and the
 * §7.1 rule below.
 *
 * @param level - The place level, which decides the priority order.
 * @param totals - The round's totals at this place.
 * @param ranked - The round's ranking at this place.
 * @param paperMachinePct - The machine share of the valid votes, where the cycle had both
 *   channels. ⚠ `undefined` for 2001/2006/2011, which had no machines at all — a rendered 0%
 *   would present an absent technology as a measured share.
 * @returns At most the level's `maxFacts`, in its declared order.
 */
export const presidentialFacts = (
  level: ElectionPlaceLevel,
  totals: ElectionBallotTotals,
  ranked: readonly ElectionRankedEntry[],
  paperMachinePct?: number,
): ElectionSurfaceFact[] => {
  const d = descriptorFor("presidential", level);
  if (!d.available) return [];
  const leader = ranked[0];
  // ⚠ KEYED BY THE FACT CODE, not by `string`: a mistyped key would otherwise be a silently
  // unreachable entry, and a level's declared fact would simply never render.
  const available: Partial<Record<ElectionFactCode, ElectionSurfaceFact>> = {
    winner: leader
      ? { code: "winner", value: leader.pct, unit: "pct", basis: "valid_votes" }
      : undefined,
    margin:
      leader?.marginPct !== undefined
        ? {
            code: "margin",
            value: leader.marginPct,
            unit: "pct_point",
            basis: "valid_votes",
          }
        : undefined,
    turnout:
      totals.turnoutBasis === "registered_voters" &&
      totals.turnoutPct !== undefined
        ? {
            code: "turnout",
            value: totals.turnoutPct,
            unit: "pct",
            basis: "registered_voters",
          }
        : undefined,
    valid_votes: {
      code: "valid_votes",
      value: totals.validVotes,
      unit: "votes",
      basis: "valid_votes",
    },
    votes_cast: {
      code: "votes_cast",
      value: totals.votesCast,
      unit: "votes",
      basis: "votes_cast",
    },
    paper_machine:
      paperMachinePct !== undefined
        ? {
            code: "paper_machine",
            value: Number(paperMachinePct.toFixed(2)),
            // ⚠ OVER VALID VOTES, not over votes cast — the machine share is a share of the
            // ballots that counted, and against votes cast it silently absorbs the invalid
            // ones and reads low.
            basis: "valid_votes",
            unit: "pct",
          }
        : undefined,
  };
  return d.factPriority
    .map((code) => available[code])
    .filter((f): f is ElectionSurfaceFact => f !== undefined)
    .slice(0, d.maxFacts);
};

const mapMeta = (level: ElectionPlaceLevel): { map?: ElectionMapMeta } => {
  const meta = ballotMapMeta("presidential", level, "presidential_ticket");
  return meta ? { map: meta } : {};
};

// ─── reading the per-round roll-ups ─────────────────────────────────────────────────────────

export type LevelFile = "region" | "municipality" | "settlement" | "abroad";

const FILE_OF: Record<LevelFile, string> = {
  region: "region_votes.json",
  municipality: "municipality_votes.json",
  settlement: "settlement_votes.json",
  abroad: "abroad.json",
};

/** One round's roll-up for one level, or `null` when the round was not held / not ingested. */
export const readRollup = (
  cycle: string,
  round: RoundNo,
  level: LevelFile,
  root = DATA_ROOT,
): Rollup<string> | null => {
  const p = path.join(root, cycle, `tur${round}`, FILE_OF[level]);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as Rollup<string>;
};

/** The source file's mtime as an ISO string — never the clock (§9). */
export const sourceUpdatedAt = (file: string): string =>
  fs.statSync(file).mtime.toISOString();

export type BuildContext = {
  cycle: string;
  tickets: TicketIndex;
  updatedAt: string;
  /**
   * Whether this cycle had voting machines at all.
   *
   * ⚠ A ROLLED-UP PLACE HAS NO MACHINE COUNT — `ProtocolSum` carries protocol figures and the
   * machine count lives on the SECTION — so a place falls back to the cycle. A section uses
   * its own `machines`, which is the exact discriminator.
   */
  cycleHadMachines: boolean;
  /** The local cycle a place's cross-view link points at, when one covers it. */
  localCycle?: string;
  inLocalCycle?: (id: string) => boolean;
};

const machineShare = (
  votes: readonly Votes[],
  validVotes: number,
  /**
   * Was the technology PRESENT here?
   *
   * ⚠ PRESENCE, NOT THE TOTAL, and the two are different facts. „No machine" and „a machine
   * nobody used" both sum to zero machine votes, and only the first must withhold the fact:
   * a rendered „0% машинно" on a 2006 page presents an ABSENT technology as a measured share
   * (rule 2 of the surface contract), while on a 2021 station that had one it is a measured
   * fact. Measured: 22 sections across 2016 and 2021 have `machines > 0` and zero machine
   * votes, and a total-based rule silently dropped the fact on every one of them — leaving
   * three facts where the level declares four. A section knows its own count; a rolled-up
   * place does not, so it falls back to whether the CYCLE had any.
   */
  hadMachines: boolean,
): number | undefined => {
  if (!hadMachines || validVotes <= 0) return undefined;
  const machine = votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0);
  return (machine / validVotes) * 100;
};

/**
 * One place's surface, carrying a ballot per round it took part in.
 *
 * ⚠ THE FACTS DESCRIBE ROUND 1, which is the round the page leads with. A runoff's figures are
 * in its own ballot's `totals`, so nothing is lost — what is refused is a fact strip that
 * silently mixes the two, since a place's turnout and margin differ between them (nationally
 * 40.30% against 34.63% in 2021).
 *
 * @param id - The place's own key — oblast, obshtina, ekatte or country code.
 * @param level - Which level this place is.
 * @param rounds - The place's row in each round's roll-up, round 1 first.
 * @param ctx - The cycle's shared context.
 * @param completeResultTo - Where the full result for this place lives.
 */
export const buildPlaceSurface = (
  id: string,
  level: ElectionPlaceLevel,
  rounds: { round: RoundNo; votes: Votes[]; protocol: ProtocolSum }[],
  ctx: BuildContext,
  completeResultTo: string,
): ElectionSurfaceV1 => {
  const ballots: ElectionSurfaceBallot[] = rounds.map((r) => {
    const totals = totalsFrom(r.protocol, r.votes);
    const preview = rankedTickets(r.votes, ctx.tickets, totals.validVotes);
    return {
      kind: "presidential_ticket" satisfies BallotKind,
      // ⚠ EVERY ROUND CARRIES ITS NUMBER, because all six presidential levels declare the
      // `round` ranked column and `ballotFillsColumn` gates that column on this field being
      // defined — omit it and the column is dropped silently, on the one kind whose whole
      // shape is „round 1 decided nothing".
      round: r.round,
      resultStatus: "final",
      preview,
      totals,
      ...mapMeta(level),
      completeResult: { to: completeResultTo, available: true },
    };
  });
  const first = rounds[0];
  const firstTotals = ballots[0].totals;
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "presidential",
    cycle: ctx.cycle,
    place: { level, id },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots,
    facts: presidentialFacts(
      level,
      firstTotals,
      ballots[0].preview,
      machineShare(first.votes, firstTotals.validVotes, ctx.cycleHadMachines),
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "presidential",
      level,
      id,
      cycle: ctx.cycle,
      completeResultTo,
      localCycle: ctx.localCycle,
      inLocalCycle: ctx.inLocalCycle?.(id) ?? false,
    }),
  };
};

/** A section as a shard stores it — the parliamentary `SectionProtocol` plus placement. */
export type ShardSection = {
  code: string;
  round: RoundNo;
  placeName: string;
  machines: number;
  protocol: Protocol;
  votes: Votes[];
};

/**
 * The oblast shards a round wrote.
 *
 * ⚠ `_unplaced` IS EXCLUDED, and it is not an oblast. It holds the sections placement REFUSED
 * — 2011's 1,354 of them — which have real protocols and real votes and no place to be a page
 * about. It is also the largest file in the tree, which is how it once became the measured
 * „worst case" for this level.
 */
export const sectionOblasts = (
  cycle: string,
  round: RoundNo,
  root = DATA_ROOT,
): string[] => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== `${UNPLACED_SHARD}.json`)
    .map((f) => f.slice(0, -".json".length))
    .sort();
};

export const readSectionShard = (
  cycle: string,
  round: RoundNo,
  oblast: string,
  root = DATA_ROOT,
): ShardSection[] => {
  const p = path.join(root, cycle, `tur${round}`, "sections", `${oblast}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as ShardSection[];
};

/**
 * One polling section's surface.
 *
 * ⚠ THE PROTOCOL IS THE SECTION'S OWN, not a `ProtocolSum`, so the shared rule reads it
 * directly — a section has no sub-sections to fold and therefore no signature gap to carry.
 * It is also the one level with NO MAP: a single station has no geography to answer a
 * question about, which is what makes this route the repo's canonical map-free page.
 */
export const buildSectionSurface = (
  rounds: { round: RoundNo; section: ShardSection }[],
  ctx: BuildContext,
): ElectionSurfaceV1 => {
  const code = rounds[0].section.code;
  const to = `/presidential/${ctx.cycle}/section/${code}`;
  const ballots: ElectionSurfaceBallot[] = rounds.map((r) => {
    const totals = ballotTotalsFrom(r.section.protocol, r.section.votes);
    return {
      kind: "presidential_ticket" satisfies BallotKind,
      round: r.round,
      resultStatus: "final",
      preview: rankedTickets(r.section.votes, ctx.tickets, totals.validVotes),
      totals,
      ...mapMeta("section"),
      completeResult: { to, available: true },
    };
  });
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "presidential",
    cycle: ctx.cycle,
    place: { level: "section", id: code },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots,
    facts: presidentialFacts(
      "section",
      ballots[0].totals,
      ballots[0].preview,
      // ⚠ THE SECTION'S OWN COUNT, not the cycle's. A station with a machine and no machine
      // votes is a measured 0%, and 22 of them exist in 2016 and 2021.
      machineShare(
        rounds[0].section.votes,
        ballots[0].totals.validVotes,
        rounds[0].section.machines > 0,
      ),
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "presidential",
      level: "section",
      id: code,
      cycle: ctx.cycle,
      completeResultTo: to,
    }),
  };
};

/**
 * Every presidential surface for one cycle.
 *
 * ⚠ A PLACE APPEARS IN THE SURFACE SET IF IT APPEARS IN ROUND 1. A place that somehow only
 * had a runoff row would be a corpus defect rather than a page — and driving from round 1
 * keeps the surface's own ordering deterministic, which §9's byte-identical rebuild needs.
 *
 * @param cycle - A presidential cycle id.
 * @param root - Where the data tree lives; defaults to the repo's.
 * @returns One surface per (level, place), or an empty list when the cycle is not ingested.
 */
/**
 * The one cycle whose SECTION artifacts are emitted.
 *
 * ⚠⚠ SECTIONS ARE BOUNDED TO THE LATEST CYCLE, and it is an object-count decision rather than a
 * data one. §5.0 rejects a ~240,000-object shape and asks v1 to stay an order of magnitude
 * below it; five cycles' sections are ~60,000 objects on their own, which would take the corpus
 * from 23,665 to 105,218 — 44% of the shape it rejects. Bounding them mirrors how every other
 * kind is bounded (parliamentary: the latest cycle; local: the latest two) and keeps every
 * PLACE level for all five, which is what a reader actually browses. An older cycle's section
 * page falls back to the legacy composition — the same path a missing artifact already takes.
 *
 * ⚠ IT IS DERIVED FROM THE DATA, not written down: „the latest" must not become a literal that
 * a new cycle silently invalidates.
 */
export const sectionArtifactCycle = (root = DATA_ROOT): string | null => {
  if (!fs.existsSync(root)) return null;
  return (
    fs
      .readdirSync(root)
      .filter((d) => /^\d{4}_\d{2}_\d{2}_pvr$/.test(d))
      .sort()
      .at(-1) ?? null
  );
};

export const buildPresidentialSurfaces = (
  cycle: string,
  root = DATA_ROOT,
): { level: ElectionPlaceLevel; id: string; surface: ElectionSurfaceV1 }[] => {
  const r1Dir = path.join(root, cycle, "tur1");
  if (!fs.existsSync(r1Dir)) return [];
  // ⚠ ONE PASS OVER ROUND 1's SECTIONS, not per place: „did this cycle have machines" is a
  // cycle fact, and computing it per place would ask the same question 23,000 times.
  const cycleHadMachines = sectionOblasts(cycle, 1, root).some((o) =>
    readSectionShard(cycle, 1, o, root).some((x) => x.machines > 0),
  );
  const ctx: BuildContext = {
    cycle,
    cycleHadMachines,
    tickets: loadTickets(cycle, root),
    // ⚠ The ROUND-1 region file's mtime. One source per cycle, so a rebuild that touched
    // nothing produces the same bytes — and the region file exists for every ingested round.
    updatedAt: sourceUpdatedAt(path.join(r1Dir, FILE_OF.region)),
  };
  const out: {
    level: ElectionPlaceLevel;
    id: string;
    surface: ElectionSurfaceV1;
  }[] = [];
  const LEVELS: {
    file: LevelFile;
    level: ElectionPlaceLevel;
    to: (id: string) => string;
  }[] = [
    {
      file: "region",
      level: "region",
      to: (id) => `/presidential/${cycle}/region/${id}`,
    },
    {
      file: "municipality",
      level: "municipality",
      to: (id) => `/presidential/${cycle}/municipality/${id}`,
    },
    {
      file: "settlement",
      level: "settlement",
      to: (id) => `/presidential/${cycle}/settlement/${id}`,
    },
    {
      file: "abroad",
      level: "abroad",
      to: () => `/presidential/${cycle}/abroad`,
    },
  ];
  for (const { file, level, to } of LEVELS) {
    const byRound = ROUNDS.map((r) => readRollup(cycle, r, file, root));
    const first = byRound[0];
    if (!first) continue;
    const laterByKey = byRound
      .slice(1)
      .map((r) => new Map((r?.entries ?? []).map((e) => [e.key, e])));
    for (const entry of first.entries) {
      // ⚠ THE „" KEY IS A REAL BUCKET, not an absence: abroad sections whose country the
      // corpus cannot name still cast real votes. It gets no page of its own — there is no
      // place to name — so it is folded out here rather than emitted under an empty id.
      if (level === "abroad" && entry.key === "") continue;
      const rounds: {
        round: RoundNo;
        votes: Votes[];
        protocol: ProtocolSum;
      }[] = [
        {
          round: 1,
          votes: entry.results.votes,
          protocol: entry.results.protocol,
        },
      ];
      laterByKey.forEach((m, i) => {
        const hit = m.get(entry.key);
        if (hit)
          rounds.push({
            round: (i + 2) as RoundNo,
            votes: hit.results.votes,
            protocol: hit.results.protocol,
          });
      });
      out.push({
        level,
        id: entry.key,
        surface: buildPlaceSurface(
          entry.key,
          level,
          rounds,
          ctx,
          to(entry.key),
        ),
      });
    }
  }
  // ⚠ SECTIONS ARE READ FROM THE PER-OBLAST SHARDS, and only for the LATEST cycle — see
  // `sectionArtifactCycle`. The place levels above run for every cycle; this level is ~60,000
  // objects across five, which is the object-count decision §5.0 forces.
  if (cycle !== sectionArtifactCycle(root)) return out;

  // Round 1 decides the population — but NOT because a runoff-only section is impossible. It is
  // 16 real stations across the five cycles, opened for the runoff alone (mobile boxes, hospital
  // sections, late additions), and an earlier draft asserted they could not exist while dropping
  // every one silently. They are counted and named below rather than published: a one-ballot
  // surface whose strip describes „round 1" at a place that had none is a page about a round
  // that did not happen there.
  //
  // ⚠ The PLACE loop above is different and its claim holds — measured, 0 round-2-only rows at
  // region, municipality, settlement and abroad in every cycle.
  const laterSections = new Map<string, ShardSection>();
  for (const round of ROUNDS.slice(1) as RoundNo[])
    for (const oblast of sectionOblasts(cycle, round, root))
      for (const sec of readSectionShard(cycle, round, oblast, root))
        laterSections.set(`${round}/${sec.code}`, sec);
  const seenInRound1 = new Set<string>();
  for (const oblast of sectionOblasts(cycle, 1, root))
    for (const section of readSectionShard(cycle, 1, oblast, root)) {
      const rounds: { round: RoundNo; section: ShardSection }[] = [
        { round: 1, section },
      ];
      for (const r of ROUNDS.slice(1) as RoundNo[]) {
        const hit = laterSections.get(`${r}/${section.code}`);
        if (hit) rounds.push({ round: r, section: hit });
      }
      seenInRound1.add(section.code);
      out.push({
        level: "section",
        id: section.code,
        surface: buildSectionSurface(rounds, ctx),
      });
    }
  const runoffOnly = [...laterSections.values()].filter(
    (x) => !seenInRound1.has(x.code),
  );
  if (runoffOnly.length)
    process.stderr.write(
      `presidential/${cycle}: ${runoffOnly.length} section(s) appear only in the runoff ` +
        `and get no page (${runoffOnly
          .slice(0, 3)
          .map((x) => x.code)
          .join(", ")})\n`,
    );
  return out;
};
