// Parliamentary surfaces — the region/abroad and section levels §5.0 emits.
//
// FOUR parliamentary levels get an artifact — region, abroad, settlement and section — and
// `surfacePath.ts` is the authority on which. Country and municipality are served from their
// canonical shards through a thin adapter because those files are already inside budget.
//
// ⚠ THIS HEADER SAID "ONLY TWO" AND THE FILE BUILT TWO, while `emittedLevels("parliamentary")`
// returned four. `settlement` was flipped to `artifact` on measurement — p50 4.0 KB but p99
// 101.6 KB and 1,235 KB at Пловдив, so 208 of 5,364 settlements are over a 16 KiB budget and
// those 208 are the cities. A missing builder for a level the policy says emits does not fail:
// the orchestrator writes nothing, 5,365 pages keep the legacy composition, and the header
// explains why that is intentional. Any level added to the policy needs a builder here.
//
// ⚠⚠ `protocol.numValidVotes` IS PAPER-ONLY, AND IT IS THE TRAP IN THIS FILE. It is the obvious
// field for the valid-vote denominator and it is wrong in EVERY region — Благоевград reports
// 91,243 against a party sum of 150,470, Пловдив 74,918 against 133,484. Using it inflates every
// party's share by ~65%, and the shares still look plausible individually because they all move
// together. The valid total is the SUM OF THE PARTY VOTES, which is also the only figure the
// ranked result can add up to.
//
// ⚠⚠ THE TURNOUT DENOMINATOR IS `numRegisteredVoters + numAdditionalVoters`, AND GETTING THIS
// WRONG FAILS IN BOTH DIRECTIONS AT ONCE. `numAdditionalVoters` are voters added to the list ON
// THE DAY — по настоящ адрес, mobile boxes, ships — so the printed list is not the electorate.
// Measured on 2026_04_19: 530 DOMESTIC sections report more voters than registered (median 1.20x,
// max 14.0x), and **every one of the 530** is resolved by adding the additional voters. A
// generator using the bare list therefore publishes "no turnout" for 530 real sections that have
// one, and it does so silently, because a missing rate looks like a modelled absence.
//
// ⚠ ABROAD STILL PUBLISHES NO TURNOUT, AND NOT FOR AN ARITHMETIC REASON. With the correct
// denominator abroad computes to a perfectly plausible **90%** (196,281 over 59,545 + 159,588) —
// which is exactly why the suppression must be a DEFINITIONAL rule rather than a sanity check.
// Almost everyone abroad joins the list at the section on the day, so the rate approaches 100%
// by construction and measures the registration regime rather than participation; printed beside
// a domestic 48.9% it invites a comparison neither number supports (§2 decision 10, §8). The
// first cut of this file suppressed abroad because the arithmetic overflowed 100%, which got the
// right answer for the wrong reason — and would have started publishing that 90% the moment the
// denominator was fixed.
//
// ⚠ NOTHING HERE READS THE CLOCK. §9's byte-identical rebuild gate requires `status.updatedAt` to
// come from the source file's mtime, never from generation time — a generator that stamps
// `new Date()` either fails that gate or makes it vacuous.

import fs from "node:fs";
import path from "node:path";
import {
  MAX_BALLOT_PREVIEW,
  type BallotKind,
  type ElectionBallotTotals,
  type ElectionRankedEntry,
  type ElectionSurfaceBallot,
  type ElectionSurfaceFact,
  type ElectionSurfaceV1,
  ELECTION_SURFACE_VERSION,
} from "../../src/data/elections/surfaceTypes";
import { descriptorFor } from "../../src/screens/elections/electionSurfaceDescriptors";
import { buildDestinations } from "./source_links";

export const DATA_ROOT = path.join(process.cwd(), "data");

// ─── party identity (§5.3: the artifact carries a REFERENCE, never a label) ──────────────────

/** `(election, partyNum) -> canonical party id`.
 *
 *  ⚠ KEYED ON THE PAIR, NEVER ON THE NICKNAME. `partyNum` is a per-election ballot position — 21
 *  is ПрБ in 2026 and somebody else in 2021 — and the nickname is not unique either
 *  (`byNickName` folds "ГЕРБ" and "ГЕРБ-СДС" onto one id, which is correct for display and wrong
 *  for identity). The `history` array is the only key that names one party in one election. */
export type PartyIndex = ReadonlyMap<string, string>;

export const loadPartyIndex = (
  file = path.join(DATA_ROOT, "canonical_parties.json"),
): PartyIndex => {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    parties: {
      id: string;
      history: { election: string; partyNum: number }[];
    }[];
  };
  const out = new Map<string, string>();
  for (const p of raw.parties)
    for (const h of p.history) out.set(`${h.election}:${h.partyNum}`, p.id);
  return out;
};

export const partyIdFor = (
  index: PartyIndex,
  election: string,
  partyNum: number,
): string | null => index.get(`${election}:${partyNum}`) ?? null;

// ─── the two rules that are easy to get wrong ────────────────────────────────────────────────

export type Protocol = {
  numRegisteredVoters?: number | null;
  /** Voters added to the list ON THE DAY. Part of the denominator — see the header. */
  numAdditionalVoters?: number | null;
  totalActualVoters?: number | null;
  numValidVotes?: number | null;
  numValidMachineVotes?: number | null;
  numInvalidBallotsFound?: number | null;
  numPaperBallotsFound?: number | null;
  numMachineBallots?: number | null;
};

export type PartyVote = {
  partyNum: number;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
};

/** Valid votes = the sum of the party votes. See the header: `numValidVotes` is paper-only. */
export const validVotesOf = (votes: readonly PartyVote[]): number =>
  votes.reduce((a, v) => a + (v.totalVotes || 0), 0);

/** ⚠ TURNOUT IS DERIVED, AND `unavailable` IS A REAL ANSWER (§2 decision 10). Three ways there is
 *  no rate: no registered figure at all, a zero one, or one the vote count exceeds — which is
 *  abroad, at 329.6%, and is not a data error but a different registration regime.
 *
 *  Returning a rate we cannot stand behind is the failure; a missing rate is a rendered absence. */
export const ballotTotalsFrom = (
  protocol: Protocol,
  votes: readonly PartyVote[],
  /** ⚠ SET FOR ABROAD. A definitional suppression, not an arithmetic one — see the header. */
  suppressTurnout = false,
): ElectionBallotTotals => {
  const validVotes = validVotesOf(votes);
  const votesCast = protocol.totalActualVoters ?? validVotes;
  const registered =
    (protocol.numRegisteredVoters ?? 0) + (protocol.numAdditionalVoters ?? 0);
  // ⚠ MORE VALID VOTES THAN VOTERS IS IMPOSSIBLE, and three sections report it (060800018
  // publishes 109 cast against 194 valid). The mirror image — voters over the list — was already
  // guarded; this direction was not, so those three published a turnout computed from a
  // `votesCast` their own ballot count contradicts. A protocol that disagrees with itself
  // supports no rate.
  const selfConsistent = votesCast >= validVotes;
  // A rate still over 100% after the additional voters are counted is a protocol we cannot
  // stand behind, so it is reported as absent rather than published.
  if (
    suppressTurnout ||
    !selfConsistent ||
    registered <= 0 ||
    votesCast > registered
  )
    return { votesCast, validVotes, turnoutBasis: "unavailable" };
  return {
    votesCast,
    validVotes,
    registeredVoters: registered,
    turnoutPct: Number(((votesCast / registered) * 100).toFixed(2)),
    turnoutBasis: "registered_voters",
  };
};

/** The ranked preview: at most eight entries, a stable prefix of the complete ranking (§5).
 *
 *  ⚠ THE PERCENTAGE IS OVER VALID VOTES, and the margin belongs to the LEADER ONLY. A margin on
 *  every row reads as "distance from the row above", which is a different quantity, and putting
 *  the leader's margin on a runner-up asserts they led. */
export const rankedFrom = (
  votes: readonly PartyVote[],
  index: PartyIndex,
  election: string,
  validVotes: number,
): ElectionRankedEntry[] => {
  const sorted = [...votes]
    .filter((v) => (v.totalVotes || 0) > 0)
    // Ties broken on partyNum so a rebuild cannot reorder two parties with equal votes (§9).
    .sort((a, b) => b.totalVotes - a.totalVotes || a.partyNum - b.partyNum)
    .slice(0, MAX_BALLOT_PREVIEW);
  return sorted.map((v, i) => {
    const pct = validVotes > 0 ? (v.totalVotes / validVotes) * 100 : 0;
    const entry: ElectionRankedEntry = {
      partyId: partyIdFor(index, election, v.partyNum),
      localPartyNum: v.partyNum,
      votes: v.totalVotes,
      pct: Number(pct.toFixed(2)),
    };
    if (i === 0 && sorted.length > 1) {
      const next = (sorted[1].totalVotes / validVotes) * 100;
      entry.marginPct = Number((pct - next).toFixed(2));
    }
    return entry;
  });
};

// ─── facts ──────────────────────────────────────────────────────────────────────────────────

/** The facts a level can fill, in the LEVEL's declared priority. The descriptor decides which
 *  codes may appear and how many; this only supplies the ones the data actually supports, so a
 *  level never renders a fact the corpus cannot back. */
export const factsFor = (
  level: Parameters<typeof descriptorFor>[1],
  totals: ElectionBallotTotals,
  ranked: readonly ElectionRankedEntry[],
  paperMachinePct?: number,
  topGainer?: { partyId: string; deltaPp: number },
): ElectionSurfaceFact[] => {
  const d = descriptorFor("parliamentary", level);
  if (!d.available) return [];
  const leader = ranked[0];
  const available: Partial<Record<string, ElectionSurfaceFact>> = {
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
    // ⚠ ONLY WHEN THERE IS A BASIS FOR IT. `turnoutBasis: "unavailable"` means the surface
    // publishes no rate — abroad's would be 329.6%.
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
    // ⚠ THE FACT CARRIES THE PARTY AS A REFERENCE, never a name (§5.3). The renderer resolves
    // the label from the canonical corpus, so the artifact stays language-free.
    top_gainer: topGainer
      ? {
          code: "top_gainer",
          value: topGainer.deltaPp,
          unit: "pct_point",
          basis: "valid_votes",
          // `labelParams` is the declared home for an id: "numbers and IDS ONLY, never
          // resolved names". The renderer turns `p_20` into ПрБ at render time (§5.3).
          labelParams: { partyId: topGainer.partyId },
        }
      : undefined,
    paper_machine:
      paperMachinePct !== undefined
        ? {
            code: "paper_machine",
            value: Number(paperMachinePct.toFixed(2)),
            unit: "pct",
            // ⚠ OVER VALID VOTES, not over votes cast. The machine share is a share of the
            // ballots that counted; measured against votes cast it silently absorbs the
            // invalid ones and reads a point or two low.
            basis: "valid_votes",
          }
        : undefined,
  };
  // ⚠ §7.1: A FIGURE APPEARS ONCE PER SCREEN — SUPPRESSED STRUCTURALLY, NEVER BY VALUE.
  //
  // The case is real and systematic: ПрБ contested its first election in 2026, so its prior
  // share is 0 and its GAIN equals its SHARE at every place. "Winner 39.84%" beside "top gainer
  // +39.84 pp" is one number wearing two labels, on 31 of 32 regions.
  //
  // The first fix deduped on the raw number and was 72% FALSE POSITIVES: it dropped 110 facts of
  // which only 31 were this case. 59 dropped `paper_machine` because a machine share coincided
  // with a winner's share — two unrelated quantities that happened to round the same — and 13
  // compared a PERCENTAGE against a VOTE COUNT (winner 20% against valid_votes 20). 572 strips
  // rendered three cards where the level declares four. Equal numbers are not the same figure.
  //
  // The structural test names the actual redundancy — the gainer IS the leader, and its gain IS
  // its whole share — and fires on 31 of 31 with nothing else touched.
  const leaderId = leader?.partyId;
  const gainerIsWholeShare =
    topGainer !== undefined &&
    leaderId !== undefined &&
    topGainer.partyId === leaderId &&
    leader?.pct !== undefined &&
    Math.abs(topGainer.deltaPp - leader.pct) < 0.01;
  return d.factPriority
    .map((code) => available[code])
    .filter((f): f is ElectionSurfaceFact => f !== undefined)
    .filter((f) => !(f.code === "top_gainer" && gainerIsWholeShare))
    .slice(0, d.maxFacts);
};

// ─── the region / abroad surface ─────────────────────────────────────────────────────────────

/** The largest gain in SHARE against the prior cycle, at this place.
 *
 *  ⚠ SHARE, NOT VOTES, and the difference decides who is named. A cycle with higher turnout
 *  lifts every party's raw count, so a votes-based "top gainer" reports whoever is largest
 *  rather than whoever grew — on 2026 that would name the winner in almost every region.
 *
 *  Returns `undefined` when the prior cycle has no comparable row: a place that did not exist,
 *  or a party index that cannot resolve. A missing comparison is a missing comparison. */
export const topGainerPctPoint = (
  current: readonly PartyVote[],
  prior: readonly PartyVote[] | undefined,
  index: PartyIndex,
  cycle: string,
  priorCycle: string,
): { partyId: string; deltaPp: number } | undefined => {
  if (!prior || prior.length === 0) return undefined;
  const curValid = validVotesOf(current);
  const priorValid = validVotesOf(prior);
  if (curValid <= 0 || priorValid <= 0) return undefined;
  // ⚠ COMPARED BY CANONICAL ID, NEVER BY partyNum. Ballot positions are re-drawn every election,
  // so joining on partyNum compares one party's 2026 share against a different party's 2024 one.
  //
  // ⚠ BOTH SIDES ARE AGGREGATED. The prior side summed by id and the current side did not, so a
  // coalition occupying two ballot numbers that fold to one party compared a whole prior share
  // against one of two current FRAGMENTS — turning a +20 pp gain into a −10 pp loss and naming a
  // different party. No such fold exists in the corpus today, which is exactly why an asymmetry
  // here would have sat unnoticed.
  const shareBy = (
    rows: readonly PartyVote[],
    election: string,
    valid: number,
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const v of rows) {
      const id = partyIdFor(index, election, v.partyNum);
      if (!id) continue;
      m.set(id, (m.get(id) ?? 0) + (v.totalVotes / valid) * 100);
    }
    return m;
  };
  const priorShare = shareBy(prior, priorCycle, priorValid);
  const curShare = shareBy(current, cycle, curValid);

  let best: { partyId: string; deltaPp: number } | undefined;
  // Iterated in id order, and the candidate is ROUNDED BEFORE COMPARISON — comparing an
  // unrounded challenger against a rounded incumbent makes the winner depend on arrival order
  // and can name the smaller gainer, which is the non-determinism §9 forbids.
  for (const id of [...curShare.keys()].sort()) {
    const deltaPp = Number(
      (curShare.get(id)! - (priorShare.get(id) ?? 0)).toFixed(2),
    );
    if (!best || deltaPp > best.deltaPp) best = { partyId: id, deltaPp };
  }
  return best && best.deltaPp > 0 ? best : undefined;
};

export type RegionRow = {
  key: string;
  nuts3?: string | null;
  results: { votes: PartyVote[]; protocol: Protocol };
};

export type BuildContext = {
  cycle: string;
  index: PartyIndex;
  /** From the SOURCE FILE's mtime or the ingest ledger — never the clock (§9). */
  updatedAt: string;
  /** The local cycle a reader can cross to, when one covers this place. */
  localCycle?: string;
  /** Whether that cycle covers this place — a resolvable URL is not evidence of data. */
  inLocalCycle?: (placeId: string) => boolean;
  /** The cycle `top_gainer` is measured against, and that cycle's rows by place id. Absent
   *  means no comparison is published — never a zero delta, which would read as "this party
   *  did not move" about a place that was not compared. */
  priorCycle?: string;
  priorByPlace?: ReadonlyMap<string, PartyVote[]>;
};

/** ⚠ THE ABROAD OBLAST IS A REGION ON DISK AND A LEVEL IN THE ARTIFACT. It is key "32" among the
 *  region rows, so it is read here — but its `place.level` is `abroad`, which is what makes the
 *  descriptor select the abroad composition (no turnout, no child places). Emitting it as a
 *  region would give it a turnout slot it can never fill. */
export const ABROAD_KEY = "32";

export const buildRegionSurface = (
  row: RegionRow,
  ctx: BuildContext,
): ElectionSurfaceV1 => {
  const isAbroad = row.key === ABROAD_KEY;
  const level = isAbroad ? "abroad" : "region";
  const totals = ballotTotalsFrom(
    row.results.protocol,
    row.results.votes,
    isAbroad,
  );
  const ranked = rankedFrom(
    row.results.votes,
    ctx.index,
    ctx.cycle,
    totals.validVotes,
  );
  const machine = row.results.votes.reduce(
    (a, v) => a + (v.machineVotes ?? 0),
    0,
  );
  const gainer =
    ctx.priorCycle && ctx.priorByPlace
      ? topGainerPctPoint(
          row.results.votes,
          ctx.priorByPlace.get(row.key),
          ctx.index,
          ctx.cycle,
          ctx.priorCycle,
        )
      : undefined;
  const ballot: ElectionSurfaceBallot = {
    kind: "parliamentary_list" satisfies BallotKind,
    resultStatus: "final",
    preview: ranked,
    totals,
    completeResult: {
      to: `/municipality/${row.key}`,
      available: true,
    },
  };
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "parliamentary",
    cycle: ctx.cycle,
    place: { level, id: row.key },
    status: {
      result: "final",
      sourceLabel: "cik",
      updatedAt: ctx.updatedAt,
    },
    ballots: [ballot],
    facts: factsFor(
      level,
      totals,
      ranked,
      totals.validVotes > 0 ? (machine / totals.validVotes) * 100 : undefined,
      gainer,
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "parliamentary",
      level,
      id: row.key,
      cycle: ctx.cycle,
      completeResultTo: `/municipality/${row.key}`,
      localCycle: ctx.localCycle,
      inLocalCycle: ctx.inLocalCycle?.(row.key) ?? false,
    }),
  };
};

export const readRegionRows = (cycle: string): RegionRow[] => {
  const p = path.join(DATA_ROOT, cycle, "region_votes.json");
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as RegionRow[];
};

/** A place's turnout as a percentage, on the SAME denominator the surface uses
 *  (`registered + additional`) — or null where there is none.
 *
 *  ⚠ THE DENOMINATOR MATTERS TO THE COMPARISON, not just to the published figure. On the
 *  corrected denominator, abroad excluded, the national turnout delta for 2026 against 2024_10
 *  is **11.1195 pp**;
 *  on the bare registered list it is 11.87 pp, which is also what `national_summary.json`
 *  publishes and the site prerenders. A selector mixing the two measures each place against a
 *  national move computed a different way.
 *
 *  ⚠ THE METHODOLOGY RECORDS 12.05 pp FOR THIS PAIR AND NOTHING HERE REPRODUCES IT — nine
 *  derivations were tried. Stated as an open discrepancy rather than explained away: the two
 *  candidate denominators give 11.12 and 11.87, and where 12.05 came from is not recoverable
 *  from this corpus. It is not load-bearing (the selector uses the value it computes, not the
 *  recorded one) but it should not be quietly rounded into agreement. */
export const turnoutPctOf = (protocol: Protocol): number | null => {
  const denom =
    (protocol.numRegisteredVoters ?? 0) + (protocol.numAdditionalVoters ?? 0);
  const cast = protocol.totalActualVoters ?? 0;
  if (denom <= 0 || cast > denom) return null;
  return (cast / denom) * 100;
};

/** The national turnout across a cycle's region rows, on the same denominator. */
export const nationalTurnoutPct = (
  rows: readonly RegionRow[],
): number | null => {
  let cast = 0;
  let denom = 0;
  for (const r of rows) {
    // ⚠ ABROAD IS OUT OF THE BASELINE. Its rate measures a different registration regime — ~90%
    // by construction, because almost everyone joins the list at the section on the day — so
    // folding it in contaminates the very number every domestic place is then compared against.
    // The effect today is 0.0018 pp and changes no selection, which is exactly why it would
    // never have been noticed.
    if (r.key === ABROAD_KEY) continue;
    const p = r.results.protocol;
    cast += p.totalActualVoters ?? 0;
    denom += (p.numRegisteredVoters ?? 0) + (p.numAdditionalVoters ?? 0);
  }
  return denom > 0 ? (cast / denom) * 100 : null;
};

/** The prior cycle's region rows, keyed by region code, for the `top_gainer` comparison. */
export const readPriorRegionIndex = (
  priorCycle: string,
): ReadonlyMap<string, PartyVote[]> =>
  new Map(readRegionRows(priorCycle).map((r) => [r.key, r.results.votes]));

/** The prior cycle this one is compared against, from the corpus rather than from a guess. */
export const priorCycleOf = (cycle: string): string | undefined => {
  const p = path.join(DATA_ROOT, cycle, "national_summary.json");
  if (!fs.existsSync(p)) return undefined;
  const d = JSON.parse(fs.readFileSync(p, "utf8")) as {
    priorElection?: string;
  };
  return d.priorElection && fs.existsSync(path.join(DATA_ROOT, d.priorElection))
    ? d.priorElection
    : undefined;
};

// ─── the settlement surface ─────────────────────────────────────────────────────────────────

export type SettlementFile = {
  ekatte: string;
  name?: string;
  oblast?: string;
  obshtina?: string;
  /** Every polling section in the settlement, each with its own protocol and votes. */
  sections?: SectionRow[];
  /** ⚠ `protocol` IS OPTIONAL HERE, and that is the corpus rather than defensive typing — see
   *  `settlementTotalsFrom`. */
  results?: { votes?: PartyVote[]; protocol?: Protocol };
};

/** ⚠ A SETTLEMENT'S TOTALS ARE SUMMED FROM ITS SECTIONS, and that is what makes the artifact
 *  worth emitting at all: the canonical file carries every section in full — 1,235 KB at
 *  Пловдив — while the first screen needs one ranking and four figures.
 *
 *  The protocol fields are summed rather than taken from any single row, because a settlement
 *  has no protocol of its own; `numAdditionalVoters` is summed with the rest, so the turnout
 *  denominator stays `registered + additional` at this level too. */
export const settlementTotalsFrom = (
  file: SettlementFile,
): { votes: PartyVote[]; protocol: Protocol } => {
  // ⚠ A SETTLEMENT MAY CARRY `results` WITH NO `protocol`. 1,134 of 5,364 (21%) hold no polling
  // section at all — their residents vote elsewhere — and the corpus records that as
  // `{ votes: [] }` with the protocol key simply absent. Reading `.protocol` off it throws.
  if (file.results)
    return {
      votes: file.results.votes ?? [],
      protocol: file.results.protocol ?? {},
    };
  const byNum = new Map<number, PartyVote>();
  const protocol: Protocol = {
    numRegisteredVoters: 0,
    numAdditionalVoters: 0,
    totalActualVoters: 0,
  };
  for (const sec of file.sections ?? []) {
    for (const v of sec.results.votes) {
      const cur = byNum.get(v.partyNum);
      if (cur) {
        cur.totalVotes += v.totalVotes;
        cur.machineVotes = (cur.machineVotes ?? 0) + (v.machineVotes ?? 0);
      } else byNum.set(v.partyNum, { ...v });
    }
    const p = sec.results.protocol;
    protocol.numRegisteredVoters! += p.numRegisteredVoters ?? 0;
    protocol.numAdditionalVoters! += p.numAdditionalVoters ?? 0;
    protocol.totalActualVoters! += p.totalActualVoters ?? 0;
  }
  return {
    votes: [...byNum.values()].sort((a, b) => a.partyNum - b.partyNum),
    protocol,
  };
};

export const buildSettlementSurface = (
  file: SettlementFile,
  ctx: BuildContext,
): ElectionSurfaceV1 => {
  const { votes, protocol } = settlementTotalsFrom(file);
  // A settlement abroad sits in oblast 32 and inherits the definitional suppression.
  const totals = ballotTotalsFrom(protocol, votes, file.oblast === ABROAD_KEY);
  const ranked = rankedFrom(votes, ctx.index, ctx.cycle, totals.validVotes);
  const machine = votes.reduce((a, v) => a + (v.machineVotes ?? 0), 0);
  const completeResultTo = `/sections/${file.ekatte}`;
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "parliamentary",
    cycle: ctx.cycle,
    place: { level: "settlement", id: file.ekatte },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    // ⚠ NO SECTION HERE MEANS "NOT HELD HERE", NEVER A ZERO RESULT (§8). 1,134 settlements hold
    // no polling station; publishing a ballot with 0 votes and a 0% winner would assert that
    // nobody in the village voted, when in fact they voted at the next village. An empty
    // `ballots` array is what makes the shell render the level's own empty-state copy.
    ballots: votes.length
      ? [
          {
            kind: "parliamentary_list" satisfies BallotKind,
            resultStatus: "final",
            preview: ranked,
            totals,
            completeResult: { to: completeResultTo, available: true },
          },
        ]
      : [],
    facts: votes.length
      ? factsFor(
          "settlement",
          totals,
          ranked,
          totals.validVotes > 0
            ? (machine / totals.validVotes) * 100
            : undefined,
        )
      : [],
    standouts: [],
    destinations: buildDestinations({
      kind: "parliamentary",
      level: "settlement",
      id: file.ekatte,
      cycle: ctx.cycle,
      completeResultTo,
      localCycle: ctx.localCycle,
      inLocalCycle: ctx.inLocalCycle?.(file.ekatte) ?? false,
    }),
  };
};

export const settlementEkattes = (cycle: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "settlements");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
};

export const readSettlement = (
  cycle: string,
  ekatte: string,
): SettlementFile | null => {
  const p = path.join(DATA_ROOT, cycle, "settlements", `${ekatte}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as SettlementFile;
};

// ─── the section surface ────────────────────────────────────────────────────────────────────

export type SectionRow = {
  section: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  settlement?: string;
  results: { votes: PartyVote[]; protocol: Protocol };
};

/** ⚠ A SECTION DRAWS NO MAP, and its descriptor declares none — one polling station has no
 *  interior geography, so a map would be decoration on the level with the tightest byte budget
 *  (8 KiB) and the largest object count (12,721 per cycle). */
export const buildSectionSurface = (
  row: SectionRow,
  ctx: BuildContext,
): ElectionSurfaceV1 => {
  // ⚠ A SECTION IN OBLAST 32 IS AN ABROAD SECTION and inherits the definitional suppression.
  // The section code's first two digits are its oblast, which is how the shard is keyed.
  const totals = ballotTotalsFrom(
    row.results.protocol,
    row.results.votes,
    (row.oblast ?? row.section.slice(0, 2)) === ABROAD_KEY,
  );
  const ranked = rankedFrom(
    row.results.votes,
    ctx.index,
    ctx.cycle,
    totals.validVotes,
  );
  const machine = row.results.votes.reduce(
    (a, v) => a + (v.machineVotes ?? 0),
    0,
  );
  // A section's cross-view links resolve through its PARENT SETTLEMENT — section numbering is
  // not stable across cycles — but §4.1 omits `views` at section level entirely, so the ekatte
  // is only used for the complete-result route.
  const completeResultTo = row.ekatte ? `/sections/${row.ekatte}` : null;
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "parliamentary",
    cycle: ctx.cycle,
    place: { level: "section", id: row.section },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots: [
      {
        kind: "parliamentary_list" satisfies BallotKind,
        resultStatus: "final",
        preview: ranked,
        totals,
        completeResult: {
          to: completeResultTo ?? "",
          available: completeResultTo !== null,
          ...(completeResultTo ? {} : { reason: "no_data_for_place" as const }),
        },
      },
    ],
    facts: factsFor(
      "section",
      totals,
      ranked,
      totals.validVotes > 0 ? (machine / totals.validVotes) * 100 : undefined,
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "parliamentary",
      level: "section",
      id: row.section,
      cycle: ctx.cycle,
      completeResultTo,
    }),
  };
};

/** One oblast shard of sections, as a map keyed by section code. */
export const readSectionShard = (
  cycle: string,
  oblast: string,
): Record<string, SectionRow> => {
  const p = path.join(
    DATA_ROOT,
    cycle,
    "sections",
    "by-oblast",
    `${oblast}.json`,
  );
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, SectionRow>;
};

export const sectionOblasts = (cycle: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "sections", "by-oblast");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
};

/** §9: the timestamp is a property of the SOURCE, not of the run. */
export const sourceUpdatedAt = (file: string): string =>
  fs.statSync(file).mtime.toISOString();
