// Where a runoff's votes came from — an ESTIMATED transition matrix per cycle, and the
// OBSERVED per-oblast swing that sits underneath it.
//
//   npx tsx scripts/parsers_presidential/build_runoff_transfer.ts <cycle> [--write]
//   npx tsx scripts/parsers_presidential/build_runoff_transfer.ts all --write
//
// ⚠⚠ THE FILE CARRIES TWO KINDS OF CLAIM AND NAMES WHICH IS WHICH. `national.matrix` is an
// ESTIMATE — nobody observes an individual switching from Каракачанов to Радев; what is
// observed is that a SECTION's numbers changed, and inferring individual behaviour from
// aggregates is the ecological fallacy. `oblasts[].w1/w2/elim/…` are ARITHMETIC on published
// protocols: this oblast's runoff winner had N votes in round 1 and M in round 2. The first
// needs a caveat on every surface; the second does not. `basis` carries the caveat into the
// data so a consumer cannot render the matrix without it.
//
// The estimate's method is the repo's own: per-oblast Goodman ecological regression with
// non-negativity (`scripts/voteFlows/estimate.ts`), then RAS scaling so the matrix's margins
// equal the PUBLISHED totals exactly. Reused rather than reimplemented — a second estimator
// would be a second answer to „where did the votes go“ that could disagree with the
// parliamentary one — and emitted in `VoteFlowMatrix` shape so `VoteFlowSankey` renders it
// with no new chart.
//
// ⚠ THE MATRIX INCLUDES ABSTENTION ON BOTH SIDES, and that is what makes it balance. A runoff
// is a week after round 1, so the ROLLS barely move — the parliamentary pipeline's joined/exited
// pseudo-nodes are for a four-year gap and do not apply — but TURNOUT does: nationally it fell
// 5.67 points in 2021. „Did not vote in round 1“ is a from-category and „did not vote in the
// runoff“ is a to-category, so both sides sum to the registered voters and the biggest real
// movement in a Bulgarian runoff is inside the matrix rather than outside it.
//
// ⚠ ABROAD IS OUTSIDE THE MATRIX, AND NOT MERELY BECAUSE OF THE FILE LAYOUT. `abroad.json` is a
// per-COUNTRY rollup with no section rows, so there is nothing for a per-section regression to
// read — and even if there were, its `turnoutBasis` is `null`: voters abroad register at the
// section on the day, so „did not vote“ has no denominator there and the fourth category of
// this matrix does not exist. `coverage.abroadVotes` states the mass that is therefore outside
// every number here.
//
// ⚠⚠ THERE IS NO SETTLEMENT MAP, AND THE REASON IS COVERAGE RATHER THAN BYTES. The plan
// (T8.2) asked for one; `places.ts` records why it cannot exist — `data/settlements.json`
// carries neither София (68134) nor the absorbed quarters, so 12–13% of domestic sections name
// a ЕКАТТЕ it does not have and the excluded mass is ~24% of a round's votes, the capital
// included. A national map missing София is not a partial map, it is a false one. The join is
// still PERFORMED and its residue reported in `coverage`, and the map that ships is the OBLAST
// one — the same unit the regression is estimated on, so the map and the Sankey are
// commensurable rather than merely adjacent.
//
// ⚠ ONLY SECTIONS PRESENT IN BOTH ROUNDS carry a transition, and the residue is REPORTED.
// Stations open for the runoff alone (mobile boxes, hospital sections) and a handful close;
// dropping them silently would make the margins disagree with the published totals by an
// amount nobody could account for.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateOblast } from "../voteFlows/estimate";
import { presidentialCyclesIn } from "../lib/electionFolders";
import { UNPLACED_SHARD } from "./aggregate";
import {
  ABSTAIN_ID,
  ABSTAIN_LANE,
  FALLBACK_NODE_COLOR,
} from "../voteFlows/pseudoLanes";
import type {
  VoteFlowEdge,
  VoteFlowMatrix,
  VoteFlowNode,
} from "../../src/data/voteFlows/voteFlowTypes";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

/** ⚠ PSEUDO IDS START WITH `__` — `VoteFlowSankey` and the aggregate generator both derive
 *  „is this a real contestant“ from that prefix, so a lane named otherwise is drawn as a
 *  candidate who stood for office. */
export const NONE_ID = "__none__";
export const INVALID_ID = "__invalid__";
// ⚠ RE-EXPORTED FROM THE SHARED MODULE, NOT RE-DECLARED. Four producers emit this lane into
// one renderer; `pseudoLanes.ts` is where „the same lane, the same colour" stopped being a
// comment. `NONE_ID`/`INVALID_ID` stay local — no other producer has them.
export { ABSTAIN_ID } from "../voteFlows/pseudoLanes";
export const ticketNodeId = (n: number): string => `t${n}`;

const PSEUDO_LABELS: Record<string, { bg: string; en: string; color: string }> =
  {
    [NONE_ID]: {
      bg: "Не подкрепям никого",
      en: "None of the above",
      color: "#a8a29e", // stone-400
    },
    [INVALID_ID]: {
      bg: "Недействителни",
      en: "Invalid ballots",
      color: "#d6d3d1", // stone-300
    },
    // ⚠ SPREAD FROM THE SHARED LANE. „The same lane, the same colour as the parliamentary
    // Sankey" was a comment beside a fourth copy of the literal until `pseudoLanes.ts`.
    [ABSTAIN_ID]: { ...ABSTAIN_LANE },
  };

/** ⚠ A TICKET WITH NO COLOUR GETS THE CHART'S OWN GREY, never another pair's. 17 of 2021's 23
 *  tickets are `neutral-palette` already; inventing one here would put a colour on a candidate
 *  that no other presidential surface uses for them. */
const FALLBACK_COLOR = FALLBACK_NODE_COLOR;

/**
 * One oblast's row. The first three fields describe the ESTIMATE's fit; every field after
 * them is a sum of published protocol figures over exactly the sections the estimate used, so
 * the map and the Sankey are measuring the same population.
 */
export type OblastSwing = {
  oblast: string;
  sections: number;
  /** RAS mass-balance residual, normalised by the oblast's electorate. */
  rasResidual: number;
  /** The runoff WINNER's votes in round 1 and round 2. */
  w1: number;
  w2: number;
  /** Round-1 votes for the pairs that did NOT reach the runoff: the pool that could move. */
  elim: number;
  /** Votes for pairs (ticket votes only — „не подкрепям никого“ is `n1`/`n2`), each round. */
  v1: number;
  v2: number;
  /** „Не подкрепям никого“. ⚠ NULL, NOT 0, BEFORE 2016 — the ballot did not carry the line. */
  n1: number | null;
  n2: number | null;
  /** Voters who turned out, each round, and the PUBLISHED roll each is measured against.
   *  ⚠ `reg1 !== reg2` for most oblasts — rolls are corrected between the rounds and voters
   *  are added at the section on the day. Dividing round 1's turnout by round 2's roll is
   *  wrong by up to 6% (Софийска област, 2006), which is why both are here. */
  a1: number;
  a2: number;
  reg1: number;
  reg2: number;
};

export type RunoffTransfer = {
  cycle: string;
  /** ⚠ THE CAVEAT, IN THE DATA. A consumer that renders `national.matrix` without it is
   *  publishing individual behaviour inferred from aggregates. */
  basis: string;
  basisEn: string;
  /** The two pairs on the runoff ballot, WINNER FIRST — read from the round-2 totals rather
   *  than from ballot order, which is arbitrary. */
  finalists: { number: number; president: string; votes: number }[];
  national: {
    matrix: VoteFlowMatrix;
    sections: number;
    /** Votes in cells below the drawing threshold, or on a lane no node was kept for. ⚠ A
     *  node's `votes` is its PUBLISHED total, so this is the amount by which its ribbons fall
     *  short of it — reported rather than reconciled away. */
    droppedVotes: number;
    /** The estimate's own imprecision, made visible: the largest relative gap between a
     *  node's published total and the sum of the ribbons drawn into or out of it, over every
     *  node. ⚠ It is NOT zero and cannot be — RAS converges geometrically and a nearly
     *  degenerate oblast (2006 Софийска, at 6.4%) does not get there in 500 iterations. A
     *  surface that prints a node's total beside ribbons that do not add up to it owes the
     *  reader this number. */
    marginGap: number;
  };
  oblasts: OblastSwing[];
  /** What the numbers above do and do not cover. ⚠ Every field here is a REFUSAL made
   *  visible: read together they say which votes are outside the matrix and why. */
  coverage: {
    basis: string;
    basisEn: string;
    /** Domestic sections that opened in BOTH rounds — the matrix's population. */
    domesticSections: number;
    /** Votes cast outside the country in the runoff. Outside the matrix entirely. */
    abroadVotes: number;
    /** ⚠ SECTIONS WHOSE OBLAST PLACEMENT WAS REFUSED — the `_unplaced` shard, held out of the
     *  regression because „nowhere" is not a geography. Declared because the votes are real
     *  and are outside every number above: 2011 refuses **1,355 sections / 422,726 runoff
     *  votes**, nine times the abroad figure beside it, all of them Sofia. Undeclared, a
     *  reader reconciling `finalists[].votes` against the published result finds a 276k gap
     *  that nothing in this file explains — and `tur2/region_votes.json`, written by the same
     *  ingest, declares the same mass as `excludedSections`/`excludedVotes`. Zero for the
     *  other four cycles. */
    unplacedSections: number;
    unplacedVotes: number;
    /** The `(code, ЕКАТТЕ)` join, performed and measured — see the header for why it does
     *  not become a map. */
    settlementsJoined: number;
    sectionsWithEkatte: number;
    sectionsWithoutEkatte: number;
    votesWithoutEkatte: number;
  };
  /** Sections in one round and not the other — named, because they cannot carry a transition
   *  and their votes are therefore outside every number above. */
  residue: {
    round1Only: string[];
    round2Only: string[];
    round1OnlyVotes: number;
    round2OnlyVotes: number;
  };
};

/**
 * ONE OBLAST'S transition matrix — the same estimate the national Sankey is summed from,
 * emitted per oblast so a region page can draw its own.
 *
 * ⚠⚠ IT IS ITS OWN FILE, AND THE CAVEAT IS REPEATED IN IT RATHER THAN LINKED. A region page
 * fetches this shard and nothing else, so `basis` living only in `runoff_transfer.json`
 * would be a matrix rendered with no caveat anywhere in the document — the exact failure
 * `RunoffTransfer.basis` exists to prevent, one level down. The strings are the SAME strings,
 * copied from the one build, so the two surfaces cannot state different qualifications.
 *
 * ⚠ SEPARATE FILES RATHER THAN A FIELD ON `oblasts[]`. `runoff_transfer.json` is fetched by
 * the COUNTRY page, which needs no per-oblast matrix at all; folding 31 of them into it grows
 * that page's payload several-fold to serve a question it never asks. Measured 2026-09-07, a
 * shard is 6.3-15.2 KB on disk (mean 10.4 KB; 155 files, 1.57 MB in all) and ~2.3 KB gzipped,
 * which is what `bucket:gz` actually stores — and only the oblast being read is fetched.
 *
 * ⚠ `flows` IS `est.flows` VERBATIM, from the same pass that feeds `national`. Re-estimating
 * per oblast would be a second answer to „where did this oblast's votes go", and the two would
 * disagree the first time either side of the pipeline moved.
 */
export type OblastTransfer = {
  cycle: string;
  oblast: string;
  /** ⚠ THE CAVEAT, IN EVERY SHARD — see the type's header. */
  basis: string;
  basisEn: string;
  /** The runoff pair, WINNER FIRST, with this oblast's own round-2 votes. */
  finalists: { number: number; president: string; votes: number }[];
  /** Sections in THIS oblast that opened in both rounds — the shard's population. */
  sections: number;
  /**
   * ⚠⚠ WHAT THIS SHARD DOES NOT COVER — the `basis` argument applied to the OTHER half of the
   * caveat, and on one cycle it is the larger half. A region page fetches this file and
   * nothing else, so a refusal declared only in `runoff_transfer.json` is a refusal nobody
   * can see.
   *
   * Measured on 2011: the ingest refused to place **1,355 sections / 422,726 runoff votes**,
   * all of them Sofia, against **32,024** votes inside Sofia's three shards — so **93% of
   * Sofia's runoff vote is outside its own shards**. Without these fields that page renders a
   * complete-looking Sankey, a winner-first pair and a `sections: 35` with no denominator,
   * and a reader has no way to discover any of it.
   *
   * ⚠ CYCLE-WIDE, NOT PER-OBLAST, AND THAT IS NOT AN APPROXIMATION. The `_unplaced` shard
   * carries no oblast BY CONSTRUCTION — that is what „unplaced" means — so the mass cannot be
   * attributed to one, which is precisely why a shard that omits it invites a reader to
   * assume it is complete. The field names say `InCycle` so no surface can render it as this
   * oblast's own.
   */
  coverage: {
    basis: string;
    basisEn: string;
    unplacedSectionsInCycle: number;
    unplacedVotesInCycle: number;
    /** Votes cast outside the country in the runoff — outside every matrix, national and
     *  per-oblast alike, because abroad sections have no oblast and no electoral roll. */
    abroadVotesInCycle: number;
  };
  matrix: VoteFlowMatrix;
  /** Votes in cells below the drawing threshold, or on a lane no node was kept for. */
  droppedVotes: number;
  /**
   * The largest relative gap between a node's total and its drawn ribbons, in this oblast.
   *
   * ⚠⚠ AN ORDER OF MAGNITUDE WORSE THAN THE NATIONAL FIGURE, for a structural reason: the RAS
   * residual cancels when 31 oblasts are summed and does not cancel inside one. Measured over
   * 155 shards — median 0.09, p90 0.287, max 0.70 — against 0.012-0.047 nationally. At 0.54
   * (2016/LOV) „Недействителни" prints 2,884 beside ribbons summing to 1,314. A surface that
   * prints a node's total beside its ribbons owes the reader this number — the same
   * obligation `national.marginGap` carries, and more so here.
   */
  marginGap: number;
  /** RAS mass-balance residual, normalised by the oblast's electorate — the same number the
   *  national file's `oblasts[]` row carries, repeated so a shard is readable on its own. */
  rasResidual: number;
};

/** What ONE build produces: the cycle-level file and its per-oblast shards.
 *
 *  ⚠ TWO ARTIFACTS, ONE ESTIMATE. They are returned together rather than by two functions
 *  because the second would have to re-run the regression — a full NNLS+RAS pass per cycle —
 *  and could then disagree with the first. */
export type RunoffTransferBuild = {
  transfer: RunoffTransfer;
  oblasts: OblastTransfer[];
};

type ShardSection = {
  code: string;
  ekatte?: string;
  oblast?: string;
  protocol: {
    numRegisteredVoters?: number;
    numAdditionalVoters?: number;
    totalActualVoters?: number;
    numInvalidBallotsFound?: number;
    numValidNoOnePaperVotes?: number;
    numValidNoOneMachineVotes?: number;
  };
  votes: { partyNum: number; totalVotes: number }[];
};

type Ticket = { number: number; president: string; rounds?: number[] };

const readJson = <T>(f: string): T | null => {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
};

/** Every ingested presidential cycle, oldest first. ⚠ A THIN RE-EXPORT of the shared lister
 *  — the function lived here, in `build_split_ticket.ts` and in the prerender, three times
 *  over, and this module's own CLI and test import it by this name. */
export const presidentialCyclesFor = (root = DATA_ROOT): string[] =>
  presidentialCyclesIn(root);

/** One round's sections for one oblast. */
const readShard = (
  cycle: string,
  round: 1 | 2,
  oblast: string,
  root: string,
): ShardSection[] =>
  readJson<ShardSection[]>(
    path.join(root, cycle, `tur${round}`, "sections", `${oblast}.json`),
  ) ?? [];

const oblastsOf = (cycle: string, round: 1 | 2, root: string): string[] => {
  const dir = path.join(root, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir)) return [];
  return (
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      // ⚠ `_unplaced` IS EXCLUDED. It is the residue bucket — sections whose oblast placement
      // was REFUSED rather than guessed — and an oblast-level regression over „nowhere“ is a
      // regression over a population that shares no geography.
      .filter((o) => o !== UNPLACED_SHARD)
      .sort()
  );
};

/** „не подкрепям никого“ for one section. ⚠ ABSENT (not 0) BEFORE 2016 — the form did not ask,
 *  and a 0 would put real abstainers into a category nobody was offered. */
const noneOfTheAbove = (s: ShardSection): number | null => {
  const p = s.protocol;
  if (
    p.numValidNoOnePaperVotes === undefined &&
    p.numValidNoOneMachineVotes === undefined
  )
    return null;
  return (p.numValidNoOnePaperVotes ?? 0) + (p.numValidNoOneMachineVotes ?? 0);
};

/** One section's observed counts, in one round. Nothing here is derived or clamped. */
export type SectionCounts = {
  /** Votes per ballot number, in the order asked for. */
  ticket: number[];
  /** „не подкрепям никого“ — NULL where the ballot did not carry the line (pre-2016). */
  none: number | null;
  invalid: number;
  /** Ballots accounted for: tickets + „никого“ + invalid. */
  counted: number;
  /** The published roll, plus voters added on the day. */
  registered: number;
};

export const sectionCounts = (
  s: ShardSection,
  ticketNumbers: number[],
): SectionCounts => {
  const byNum = new Map(s.votes.map((v) => [v.partyNum, v.totalVotes]));
  const p = s.protocol;
  const none = noneOfTheAbove(s);
  const invalid = p.numInvalidBallotsFound ?? 0;
  const ticket = ticketNumbers.map((n) => byNum.get(n) ?? 0);
  return {
    ticket,
    none,
    invalid,
    counted: ticket.reduce((a, b) => a + b, 0) + (none ?? 0) + invalid,
    registered: (p.numRegisteredVoters ?? 0) + (p.numAdditionalVoters ?? 0),
  };
};

/**
 * ONE electorate for both rounds of a section, and this is what makes the matrix balance.
 *
 * ⚠ THE TWO PUBLISHED ROLLS DISAGREE, AND NOT BY A ROUNDING AMOUNT. Between the rounds a roll
 * is corrected and voters are added at the section on the day: measured over matched sections,
 * 2006 drifts +0.61% nationally and **+6.4% in Софийска област**. Fed to RAS as two different
 * margins that is not a small imprecision — it is a matrix whose rows and columns cannot both
 * be satisfied, and `rasResidual` reported exactly that (ten 2006 oblasts above 1%).
 *
 * A runoff is one week later, so this is the SAME electorate: nobody turns 18 into it and
 * nobody dies out of it in numbers like these. So the section gets ONE pool — big enough to
 * hold whichever round counted more — and „did not vote“ then means the same thing on both
 * sides, which is the only way that lane can carry a transition at all. The published rolls
 * are still what the OBSERVED turnout figures (`reg1`/`reg2`) are measured against; the pool
 * is internal to the estimate.
 */
export const sectionPool = (a: SectionCounts, b: SectionCounts): number =>
  Math.max(a.registered, b.registered, a.counted, b.counted);

/** A section's category vector against a given pool. The last element is „did not vote“. */
export const vectorFor = (c: SectionCounts, pool: number): number[] => [
  ...c.ticket,
  c.none ?? 0,
  c.invalid,
  Math.max(0, pool - c.counted),
];

export const nodesOf = (
  nums: number[],
  tickets: Ticket[],
  totals: number[],
  /** ⚠ ABSENT IS NOT ZERO. „Не подкрепям никого“ reached the ballot in 2016; drawn as a
   *  zero-height lane on 2001 it says nobody chose an option nobody was offered. */
  hasNoneOption: boolean,
): VoteFlowNode[] => {
  const ids = [...nums.map(ticketNodeId), NONE_ID, INVALID_ID, ABSTAIN_ID];
  return (
    ids
      .map((id, i) => {
        const pseudo = PSEUDO_LABELS[id];
        const num = nums[i];
        const ticket = pseudo
          ? undefined
          : tickets.find((t) => t.number === num);
        const label = pseudo?.bg ?? ticket?.president ?? String(num);
        return {
          id,
          label,
          // ⚠ A PERSON'S NAME IS NOT TRANSLATED. The EN label of a ticket is the same Cyrillic
          // name every other presidential surface prints; only the pseudo lanes differ.
          labelEn: pseudo?.en ?? label,
          color: pseudo?.color ?? FALLBACK_COLOR,
          votes: Math.round(totals[i]),
          pseudo: pseudo ? (true as const) : undefined,
        };
      })
      // A ticket with no votes on its side ran in only one round: on the runoff axis every
      // eliminated pair is exactly that, and drawn it is a bare label implying they stood.
      // Pseudo lanes stay even at 0 — „nobody spoiled a ballot“ is a result — EXCEPT the one
      // the ballot did not carry at all.
      .filter((n) =>
        n.id === NONE_ID ? hasNoneOption : n.pseudo || n.votes > 0,
      )
  );
};

/** ⚠ RETURNS THE DROPPED MASS ALONGSIDE THE EDGES. Every threshold loses something; what
 *  makes it safe is that the loss is reported rather than left for a reader to notice as a
 *  ribbon that does not reach its node. */
export const edgesOf = (
  fromIds: string[],
  toIds: string[],
  flows: number[][],
  /** ⚠ TWO SETS, ONE PER AXIS, and a union is NOT the same question. A finalist can survive
   *  on the to-axis while being dropped from the from-axis in an oblast where they polled
   *  nothing in round 1 — a union then admits a ribbon LEAVING a node the chart does not
   *  draw. Zero such edges on today's 155 shards; the precondition is a row sum disagreeing
   *  with its margin, which `marginGap` shows happens routinely once the matrix is one
   *  oblast wide. */
  keepFrom: Set<string>,
  keepTo: Set<string>,
): { edges: VoteFlowEdge[]; droppedVotes: number } => {
  // ⚠ THE PARLIAMENTARY GENERATOR'S THRESHOLD (0.005% OF TOTAL MASS) DOES NOT TRANSFER, and
  // adopting it cost a fifth of a lane. That chart's smallest node is a party; this one's is
  // „недействителни“ — 2,776 votes in 2021 against a 6.7M electorate, so a mass-relative floor
  // of 335 votes deleted 22% of it while the node still printed the published total beside a
  // ribbon that no longer added up to it. The floor here is ABSOLUTE, because what makes an
  // edge noise is its own size, not the electorate's.
  const min = 20;
  const edges: VoteFlowEdge[] = [];
  let droppedVotes = 0;
  /** The largest cell each node LOST to the floor. ⚠ TWO MAPS, ONE PER SIDE, and that is not
   *  tidiness: a pseudo lane is BOTH a from-node and a to-node, so a single map keyed by id
   *  holds one cell for two independent questions. Measured — with one map, S25's
   *  „недействителни" was rescued by its largest INCOMING cell and left with no outgoing
   *  ribbon at all, i.e. still orphaned on the side the rescue was for. */
  type Candidate = { cell: VoteFlowEdge; raw: number };
  const bestFrom = new Map<string, Candidate>();
  const bestTo = new Map<string, Candidate>();
  /** ⚠ RANKED ON THE RAW FLOW, not on the rounded cell. A node whose margin rounds to 1 while
   *  every one of its cells rounds to 0 has no rounded candidate at all, so the rescue below
   *  would skip it and leave exactly the orphan it exists to prevent. */
  const remember = (side: Map<string, Candidate>, id: string, c: Candidate) => {
    const cur = side.get(id);
    if (!cur || c.raw > cur.raw) side.set(id, c);
  };
  fromIds.forEach((from, i) =>
    toIds.forEach((to, j) => {
      const raw = flows[i][j];
      const votes = Math.round(raw);
      if (!keepFrom.has(from) || !keepTo.has(to)) {
        droppedVotes += votes;
        return;
      }
      if (votes >= min) {
        edges.push({ from, to, votes });
        return;
      }
      droppedVotes += votes;
      remember(bestFrom, from, { cell: { from, to, votes }, raw });
      remember(bestTo, to, { cell: { from, to, votes }, raw });
    }),
  );

  // ⚠⚠ A NODE MAY NEVER BE DRAWN WITH NO RIBBON AT ALL, and an ABSOLUTE floor does exactly
  // that once the matrix is cut per oblast. Nationally „недействителни" is 2,776 votes and
  // every one of its cells clears 20; in Sofia's S25 the same lane is **20 votes**, all of its
  // cells fall under the floor, and the node renders as a labelled bar with nothing attached —
  // `marginGap` 1.0, i.e. the chart asserting it cannot account for any of a total it prints.
  // So a node's LARGEST lost cell is restored: by definition that cell is not noise relative
  // to the node, since it is most of it. Measured, this is a NO-OP on all five national
  // matrices — none has an orphaned node (worst gap 0.047) — and fires on 4 of 155 shards,
  // rescuing 18 nodes in all (2011: S23 5, S24 9, S25 2; 2021: S25 2).
  const drawnFrom = new Set(edges.map((e) => e.from));
  const drawnTo = new Set(edges.map((e) => e.to));
  const restored = new Set<string>();
  for (const [side, drawn] of [
    [bestFrom, drawnFrom],
    [bestTo, drawnTo],
  ] as const)
    for (const [id, best] of side) {
      if (drawn.has(id) || best.raw <= 0) continue;
      // ⚠ AT LEAST ONE VOTE. A cell that rounds to 0 is still the node's largest, and a
      // 0-vote ribbon is this same orphan wearing a different mask.
      const cell = { ...best.cell, votes: Math.max(1, best.cell.votes) };
      // ⚠ ONE CELL CAN RESCUE BOTH ITS ENDS, so it must not be pushed twice.
      const key = `${cell.from}\u0000${cell.to}`;
      if (restored.has(key)) continue;
      restored.add(key);
      edges.push(cell);
      droppedVotes -= cell.votes;
      // ⚠ THE SNAPSHOTS FOLLOW THE RESCUE. A cell restored for its from-node also un-orphans
      // its to-node; without this the second pass restores a redundant second edge.
      drawnFrom.add(cell.from);
      drawnTo.add(cell.to);
    }

  // ⚠ CANONICAL ORDER, so a rescued edge does not land at the end and make the committed
  // artifact's diff depend on which nodes happened to be orphaned. A no-op when nothing was
  // rescued — the loop above already emits `(i, j)` order.
  const fromIdx = new Map(fromIds.map((id, i) => [id, i]));
  const toIdx = new Map(toIds.map((id, j) => [id, j]));
  edges.sort(
    (a, b) =>
      (fromIdx.get(a.from) ?? 0) - (fromIdx.get(b.from) ?? 0) ||
      (toIdx.get(a.to) ?? 0) - (toIdx.get(b.to) ?? 0),
  );
  return { edges, droppedVotes };
};

/** The largest relative disagreement between a node's published total and its drawn ribbons. */
export const marginGap = (
  fromNodes: VoteFlowNode[],
  toNodes: VoteFlowNode[],
  edges: VoteFlowEdge[],
): number => {
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const e of edges) {
    out.set(e.from, (out.get(e.from) ?? 0) + e.votes);
    into.set(e.to, (into.get(e.to) ?? 0) + e.votes);
  }
  const gap = (n: VoteFlowNode, side: Map<string, number>) =>
    n.votes > 0 ? Math.abs((side.get(n.id) ?? 0) - n.votes) / n.votes : 0;
  return Math.max(
    0,
    ...fromNodes.map((n) => gap(n, out)),
    ...toNodes.map((n) => gap(n, into)),
  );
};

const sumVotes = (s: ShardSection): number =>
  s.votes.reduce((a, v) => a + v.totalVotes, 0);

/** The runoff's votes cast outside the country, from the per-country rollup. ⚠ NOT part of any
 *  number in the matrix — see the header. Returns 0 when the cycle has no abroad file rather
 *  than throwing: „we could not read it“ and „nobody voted abroad“ are both reported as a
 *  figure a reader can check against `abroad.json` itself. */
const abroadVotesOf = (cycle: string, root: string): number => {
  const file = readJson<{
    entries?: { results?: { votes?: { totalVotes?: number }[] } }[];
  }>(path.join(root, cycle, "tur2", "abroad.json"));
  return (file?.entries ?? []).reduce(
    (sum, e) =>
      sum +
      (e.results?.votes ?? []).reduce((a, v) => a + (v.totalVotes ?? 0), 0),
    0,
  );
};

export const buildRunoffTransfer = (
  cycle: string,
  root = DATA_ROOT,
): RunoffTransferBuild | null => {
  const tickets =
    readJson<{ tickets: Ticket[] }>(path.join(root, cycle, "tickets.json"))
      ?.tickets ?? [];
  if (!tickets.length) return null;
  const r1Oblasts = oblastsOf(cycle, 1, root);
  const r2Oblasts = new Set(oblastsOf(cycle, 2, root));
  // ⚠ NO RUNOFF, NO MATRIX. A cycle decided in round 1 has nothing to estimate, and emitting
  // an empty one would be a file a consumer could render as „nobody moved“.
  if (!r2Oblasts.size) return null;

  const fromNums = tickets.map((t) => t.number).sort((a, b) => a - b);
  const toNums = tickets
    .filter((t) => t.rounds?.includes(2))
    .map((t) => t.number)
    .sort((a, b) => a - b);
  if (toNums.length !== 2)
    throw new Error(
      `${cycle}: expected exactly two runoff tickets, found ${toNums.length} — ` +
        "art. 93 (4) puts the top two on the runoff ballot",
    );
  const elimNums = fromNums.filter((n) => !toNums.includes(n));

  const rows: OblastSwing[] = [];
  const round1Only: string[] = [];
  const round2Only: string[] = [];
  let round1OnlyVotes = 0;
  let round2OnlyVotes = 0;
  const fromTotals = new Array(fromNums.length + 3).fill(0);
  const toTotals = new Array(toNums.length + 3).fill(0);
  const national: number[][] = fromTotals.map(() => toTotals.map(() => 0));
  let matchedSections = 0;
  const settlements = new Set<string>();
  // Both finalists' figures per oblast, indexed as `toNums` is. The WINNER is not known
  // until every oblast has been summed, so the row's `w1`/`w2` are filled in afterwards
  // rather than guessed from ballot order.
  const finalistFigures = new Map<string, { w1: number; w2: number }[]>();
  // ⚠ THE ESTIMATE, RETAINED PER OBLAST — not re-run afterwards. The shards are built below,
  // once `hasNone` is known, because whether the ballot carried „не подкрепям никого" is a
  // fact about the CYCLE: derived per oblast it would draw the lane in one region and omit it
  // in the next, for the same ballot. Holding `est.flows` costs 31 × 26 × 5 numbers.
  const estimated = new Map<
    string,
    {
      flows: number[][];
      from: number[];
      to: number[];
      sections: number;
      rasResidual: number;
    }
  >();
  let sectionsWithEkatte = 0;
  let sectionsWithoutEkatte = 0;
  let votesWithoutEkatte = 0;

  // ⚠ THE UNION, NOT `r1Oblasts`. An oblast whose shard exists in `tur2/sections/` and not in
  // `tur1/` would otherwise never be visited, so its sections would land in neither the matrix
  // nor `residue` — the same silent drop the header forbids, one level up. Latent today (all
  // 31 are present in both rounds in all five cycles) and invisible when it happens: the
  // „31 oblasts" assertion still passes, because such an oblast contributes no row either way.
  const allOblasts = [
    ...r1Oblasts,
    ...[...r2Oblasts].filter((o) => !r1Oblasts.includes(o)).sort(),
  ];
  for (const oblast of allOblasts) {
    const r1 = r1Oblasts.includes(oblast)
      ? readShard(cycle, 1, oblast, root)
      : [];
    const r2 = r2Oblasts.has(oblast) ? readShard(cycle, 2, oblast, root) : [];
    const r2ByCode = new Map(r2.map((s) => [s.code, s]));
    const seen = new Set<string>();
    const sections: {
      registeredFrom: number;
      registeredTo: number;
      from: number[];
      to: number[];
    }[] = [];
    const oFrom = new Array(fromNums.length + 3).fill(0);
    const oTo = new Array(toNums.length + 3).fill(0);
    // The observed half, accumulated over exactly the sections the estimate will use.
    const obs = {
      w: [0, 0],
      elim: 0,
      v1: 0,
      v2: 0,
      n1: 0,
      n2: 0,
      hasN1: false,
      hasN2: false,
      a1: 0,
      a2: 0,
      reg1: 0,
      reg2: 0,
    };
    for (const s1 of r1) {
      const s2 = r2ByCode.get(s1.code);
      if (!s2) {
        round1Only.push(s1.code);
        round1OnlyVotes += sumVotes(s1);
        continue;
      }
      seen.add(s1.code);
      const a = sectionCounts(s1, fromNums);
      const b = sectionCounts(s2, toNums);
      const pool = sectionPool(a, b);
      const fromVec = vectorFor(a, pool);
      const toVec = vectorFor(b, pool);
      sections.push({
        registeredFrom: pool,
        registeredTo: pool,
        from: fromVec,
        to: toVec,
      });
      fromVec.forEach((v, i) => (oFrom[i] += v));
      toVec.forEach((v, i) => (oTo[i] += v));
      // ⚠ THE JOIN IS `(code, ЕКАТТЕ)`: the two rounds are matched on the SECTION code, and
      // the matched pair is then rolled up on ЕКАТТЕ. Measured here and reported in
      // `coverage`; a section with no ЕКАТТЕ is counted, never folded into a nearby place.
      const ekatte = s2.ekatte ?? s1.ekatte;
      if (ekatte) {
        settlements.add(ekatte);
        sectionsWithEkatte += 1;
      } else {
        sectionsWithoutEkatte += 1;
        votesWithoutEkatte += sumVotes(s2);
      }
      // ⚠ ROUND 1 ONLY. The runoff figures come from `oTo`, which is what the estimate was
      // scaled to; reading them here as well would be a second derivation that could disagree.
      const g1 = new Map(s1.votes.map((v) => [v.partyNum, v.totalVotes]));
      toNums.forEach((n, i) => {
        obs.w[i] += g1.get(n) ?? 0;
      });
      obs.elim += elimNums.reduce((acc, n) => acc + (g1.get(n) ?? 0), 0);
      obs.v1 += sumVotes(s1);
      obs.v2 += sumVotes(s2);
      if (a.none !== null) {
        obs.n1 += a.none;
        obs.hasN1 = true;
      }
      if (b.none !== null) {
        obs.n2 += b.none;
        obs.hasN2 = true;
      }
      obs.a1 += s1.protocol.totalActualVoters ?? 0;
      obs.a2 += s2.protocol.totalActualVoters ?? 0;
      // ⚠ THE PUBLISHED ROLLS, one per round — NOT the estimate's pooled electorate. Turnout is
      // a claim about what the commission published, and the pool is our own construction.
      obs.reg1 += a.registered;
      obs.reg2 += b.registered;
    }
    for (const s2 of r2)
      if (!seen.has(s2.code)) {
        round2Only.push(s2.code);
        round2OnlyVotes += sumVotes(s2);
      }
    if (!sections.length) continue;
    matchedSections += sections.length;
    // ⚠ `estimateOblast` RESCALES BOTH MARGINS IN PLACE when their masses disagree — and `oTo`
    // is read back below for `w2` and for the national totals, which are PUBLISHED figures.
    // The pooled electorate is what makes that branch unreachable: `vectorFor` gives both
    // vectors the same `pool` per section, so the masses are equal integers. Asserted rather
    // than assumed, because the guarantee lives in another module's `if` and a future clamp or
    // extra lane in `sectionPool`/`vectorFor` would break it with nothing failing.
    const fromMass = oFrom.reduce((a: number, b: number) => a + b, 0);
    const toMass = oTo.reduce((a: number, b: number) => a + b, 0);
    if (fromMass !== toMass)
      throw new Error(
        `${cycle}/${oblast}: pooled margins disagree (${fromMass} vs ${toMass}) — ` +
          "estimateOblast would rescale them and w2 would stop being a published figure",
      );
    // ⚠ ROUNDED ONCE, HERE. The residual is a convergence diagnostic, and printing it to 17
    // significant figures implies a precision the estimate does not have — while making the
    // committed artifact's diff unreadable, which is how a corpus change is reviewed. Rounded
    // once because `OblastTransfer.rasResidual` promises to be the SAME number the national
    // row carries, and two `toPrecision` literals make that a coincidence rather than a fact.
    const est = estimateOblast({
      oblast,
      sections,
      fromTotals: oFrom,
      toTotals: oTo,
    });
    const rasResidual = Number(est.rasResidual.toPrecision(4));
    // ⚠ THE WINNER'S ROUND-2 VOTES COME FROM THE MARGINALS, not from a second pass over the
    // shards: `oTo` is what the estimate was scaled to, so a row whose `w2` disagreed with it
    // would be a map contradicting the Sankey it sits beside.
    rows.push({
      oblast,
      sections: sections.length,
      rasResidual,
      // ⚠ PLACEHOLDERS. Filled in below, once the round-2 totals say who won.
      w1: 0,
      w2: 0,
      elim: obs.elim,
      v1: obs.v1,
      v2: obs.v2,
      n1: obs.hasN1 ? obs.n1 : null,
      n2: obs.hasN2 ? obs.n2 : null,
      a1: obs.a1,
      a2: obs.a2,
      reg1: obs.reg1,
      reg2: obs.reg2,
    });
    finalistFigures.set(
      oblast,
      toNums.map((_, i) => ({ w1: obs.w[i], w2: Math.round(oTo[i]) })),
    );
    estimated.set(oblast, {
      flows: est.flows,
      from: oFrom,
      to: oTo,
      sections: sections.length,
      rasResidual,
    });
    est.flows.forEach((row, i) =>
      row.forEach((v, j) => {
        national[i][j] += v;
      }),
    );
    oFrom.forEach((v, i) => (fromTotals[i] += v));
    oTo.forEach((v, i) => (toTotals[i] += v));
  }

  // The option existed for this cycle iff any matched section reported the field at all.
  const hasNone = rows.some((r) => r.n1 !== null || r.n2 !== null);
  // ⚠ THE REFUSED SHARD, COUNTED. `oblastsOf` excludes it from the regression (correctly — see
  // its comment) and neither `residue` nor the loop above can see it, because both are scoped
  // to oblasts that exist. Read from the RUNOFF round: these are the votes the file's headline
  // figures do not contain.
  const unplaced = readShard(cycle, 2, UNPLACED_SHARD, root);
  const unplacedVotes = unplaced.reduce((sum, s) => sum + sumVotes(s), 0);

  const fromNodes = nodesOf(fromNums, tickets, fromTotals, hasNone);
  const toNodes = nodesOf(toNums, tickets, toTotals, hasNone);
  const keepFrom = new Set(fromNodes.map((n) => n.id));
  const keepTo = new Set(toNodes.map((n) => n.id));
  const fromIds = [
    ...fromNums.map(ticketNodeId),
    NONE_ID,
    INVALID_ID,
    ABSTAIN_ID,
  ];
  const toIds = [...toNums.map(ticketNodeId), NONE_ID, INVALID_ID, ABSTAIN_ID];
  const edges = edgesOf(fromIds, toIds, national, keepFrom, keepTo);

  // ⚠ THE WINNER IS READ FROM THE TOTALS, never assumed from ballot order. `toNums` is sorted
  // by ballot number, and in 2001 the lower number lost.
  const nameOf = (n: number) =>
    tickets.find((t) => t.number === n)?.president ?? String(n);
  const finals = toNums.map((n, i) => ({ n, votes: Math.round(toTotals[i]) }));
  const ranked = [...finals].sort((a, b) => b.votes - a.votes);
  const winnerIdx = toNums.indexOf(ranked[0].n);
  for (const row of rows) {
    const figures = finalistFigures.get(row.oblast)?.[winnerIdx];
    if (!figures) continue;
    row.w1 = figures.w1;
    row.w2 = figures.w2;
  }

  // ⚠ HOISTED SO THE SHARDS CARRY THE SAME SENTENCE, not a second one. `OblastTransfer.basis`
  // is this string — a region page renders the matrix with no other caveat in the document, so
  // two literals here would be two qualifications a reader could be shown either of.
  const basis =
    "Оценка, не наблюдение. Никой не вижда как отделен избирател сменя вота си между " +
    "двата тура — вижда се само че числата на секцията са се променили. Матрицата е " +
    "екологична регресия по области, мащабирана така че сборовете ѝ да съвпадат с " +
    "публикуваните резултати; тя показва движение, СЪВМЕСТИМО с данните, а не преброени " +
    "хора.";
  const basisEn =
    "An estimate, not an observation. Nobody sees an individual voter change sides " +
    "between the two rounds — what is seen is that a polling station's numbers changed. " +
    "The matrix is an ecological regression by oblast, scaled so its margins match the " +
    "published results; it shows movement CONSISTENT WITH the data, not counted people.";
  const finalists = ranked.map((f) => ({
    number: f.n,
    president: nameOf(f.n),
    votes: f.votes,
  }));

  // ⚠ HOISTED FOR THE SAME REASON `basis` IS — every shard repeats this sentence verbatim,
  // because a region page fetches one shard and nothing else and a refusal it cannot see is
  // indistinguishable from no refusal at all.
  const coverageBasis =
    "Само секции в страната, отворени и в двата тура. Гласовете в чужбина са извън " +
    "матрицата: те се публикуват по държави, без секции, и нямат избирателен списък, " +
    "спрямо който „не гласували“ да значи нещо. Извън нея са и секциите, за които " +
    "областта не е установена — регресия по „никъде“ няма смисъл, но гласовете са " +
    "истински и затова са преброени тук. Свързването секция→населено място е направено и " +
    "измерено, но не става карта: каталогът няма София.";
  const coverageBasisEn =
    "Domestic sections that opened in both rounds only. Votes cast abroad are outside " +
    "the matrix: they are published by country rather than by section, and have no " +
    "electoral roll for „did not vote“ to be measured against. So are sections whose " +
    "oblast could not be established — a regression over „nowhere“ means nothing, but the " +
    "votes are real and are counted here. The section→settlement join is performed and " +
    "measured but does not become a map: the catalogue has no entry for Sofia.";
  const abroadVotes = abroadVotesOf(cycle, root);

  const transfer: RunoffTransfer = {
    cycle,
    basis,
    basisEn,
    finalists,
    national: {
      matrix: { fromNodes, toNodes, flows: edges.edges },
      sections: matchedSections,
      droppedVotes: edges.droppedVotes,
      marginGap: Number(
        marginGap(fromNodes, toNodes, edges.edges).toPrecision(3),
      ),
    },
    oblasts: rows,
    coverage: {
      basis: coverageBasis,
      basisEn: coverageBasisEn,
      domesticSections: matchedSections,
      abroadVotes,
      unplacedSections: unplaced.length,
      unplacedVotes,
      settlementsJoined: settlements.size,
      sectionsWithEkatte,
      sectionsWithoutEkatte,
      votesWithoutEkatte,
    },
    residue: {
      round1Only: round1Only.sort(),
      round2Only: round2Only.sort(),
      round1OnlyVotes,
      round2OnlyVotes,
    },
  };

  // ⚠ ONE SHARD PER OBLAST, FROM THE RETAINED `est.flows`. `nodesOf` is given the oblast's OWN
  // margins, so a ticket that polled nothing here is dropped from this shard and still drawn
  // nationally — which is the point of a per-region view. The three pseudo lanes survive at 0
  // („nobody spoiled a ballot here" is a result), except the one the ballot did not carry,
  // which is `hasNone` — a CYCLE-wide fact, deliberately not re-derived per oblast.
  const oblastShards: OblastTransfer[] = [...estimated.entries()].map(
    ([oblast, e]) => {
      const oFromNodes = nodesOf(fromNums, tickets, e.from, hasNone);
      const oToNodes = nodesOf(toNums, tickets, e.to, hasNone);
      const oEdges = edgesOf(
        fromIds,
        toIds,
        e.flows,
        new Set(oFromNodes.map((n) => n.id)),
        new Set(oToNodes.map((n) => n.id)),
      );
      return {
        cycle,
        oblast,
        basis,
        basisEn,
        // ⚠ THIS OBLAST'S OWN ROUND-2 VOTES, in the national WINNER-FIRST order. A shard that
        // re-ranked locally would name a different „winner" in the eleven oblasts the runner-up
        // carried in 2021 — a claim about the runoff that the runoff did not make.
        finalists: finalists.map((f) => ({
          ...f,
          votes: Math.round(e.to[toNums.indexOf(f.number)] ?? 0),
        })),
        sections: e.sections,
        coverage: {
          basis: coverageBasis,
          basisEn: coverageBasisEn,
          unplacedSectionsInCycle: unplaced.length,
          unplacedVotesInCycle: unplacedVotes,
          abroadVotesInCycle: abroadVotes,
        },
        matrix: {
          fromNodes: oFromNodes,
          toNodes: oToNodes,
          flows: oEdges.edges,
        },
        droppedVotes: oEdges.droppedVotes,
        marginGap: Number(
          marginGap(oFromNodes, oToNodes, oEdges.edges).toPrecision(3),
        ),
        rasResidual: e.rasResidual,
      };
    },
  );

  return { transfer, oblasts: oblastShards };
};

export const TRANSFER_FILE = "runoff_transfer.json";
/** The per-oblast shards, beside the cycle file. ⚠ A DIRECTORY WHOSE NAME IS THE CYCLE FILE'S
 *  STEM — `runoff_transfer.json` and `runoff_transfer/` coexist on a filesystem and in the
 *  bucket, and the pairing is what makes the relationship obvious in a listing. */
export const TRANSFER_DIR = "runoff_transfer";

/** One oblast's shard path, relative to the cycle folder. ⚠ THE ONE PLACE THE LAYOUT IS
 *  SPELLED — the writer here and the browser's fetch both have to agree, and a second literal
 *  is a page requesting a file nobody wrote. */
export const oblastTransferFile = (oblast: string): string =>
  path.join(TRANSFER_DIR, `${oblast}.json`);

/**
 * Write ONE already-built pair — the cycle file and its per-oblast shards. Returns the paths
 * RELATIVE TO `root`, the shape `ingestPresidentialCycle` puts in its `files` list.
 *
 * ⚠ STALE SHARDS ARE DELETED, not left. An oblast that disappears from a rebuild would
 * otherwise keep serving the previous vintage at a 200 — the „green locally, stale on prod"
 * shape — and unlike the cycle file, which is overwritten whole, nothing else ever touches it.
 */
const writeBuild = (
  build: RunoffTransferBuild,
  { indent, root }: { indent: number; root: string },
): string[] => {
  const { cycle } = build.transfer;
  const dir = path.join(root, cycle, TRANSFER_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const written = new Set(build.oblasts.map((o) => `${o.oblast}.json`));
  const stale = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !written.has(f));
  // ⚠ NAMED, NOT SILENT. This is the module's only irreversible operation, and a partial
  // corpus — a half-copied `tur1/sections/` tree — is indistinguishable from a genuine
  // retirement without the list. Every loader in this repo that deletes on a rebuild either
  // refuses a shrink or reports it; a rebuild here is cheap, so it reports.
  if (stale.length)
    console.log(
      `  removing ${stale.length} stale shard(s) under ${cycle}/${TRANSFER_DIR}: ` +
        stale.join(", "),
    );
  for (const f of stale) fs.unlinkSync(path.join(dir, f));
  const shards = build.oblasts.map((o) => {
    const shardRel = path.join(cycle, oblastTransferFile(o.oblast));
    fs.writeFileSync(
      path.join(root, shardRel),
      `${JSON.stringify(o, null, indent)}\n`,
    );
    return shardRel;
  });
  // ⚠ THE CYCLE FILE LAST. It names how many oblasts the build found, so writing it FIRST and
  // then throwing in the shard loop leaves a manifest claiming 31 beside a directory holding
  // some other number — the one ordering in which a crash produces a self-contradicting pair.
  const rel = path.join(cycle, TRANSFER_FILE);
  fs.writeFileSync(
    path.join(root, rel),
    `${JSON.stringify(build.transfer, null, indent)}\n`,
  );
  return [rel, ...shards];
};

/**
 * Build one cycle's transfer artifacts and write them. Returns every path written, RELATIVE TO
 * `root`, or an EMPTY ARRAY for a cycle with no runoff.
 *
 * ⚠ ONE WRITER FOR BOTH ENTRY POINTS — this CLI and `scripts/main.ts --pvr`. The pipeline used
 * to be the only way most derived presidential artifacts appeared; a second `writeFileSync`
 * over there would be a second answer to „what does this file look like“, and the two would
 * drift on the next field added.
 */
export const writeRunoffTransfer = (
  cycle: string,
  { indent = 2, root = DATA_ROOT }: { indent?: number; root?: string } = {},
): string[] => {
  const build = buildRunoffTransfer(cycle, root);
  if (!build) return [];
  return writeBuild(build, { indent, root });
};

const main = (): void => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error(
      "usage: build_runoff_transfer.ts <cycle|all> [--write]  (dry run without --write)",
    );
    process.exitCode = 1;
    return;
  }
  const cycles = target === "all" ? presidentialCyclesFor() : [target];
  for (const cycle of cycles) {
    const build = buildRunoffTransfer(cycle);
    if (!build) {
      console.log(`${cycle}: no runoff — nothing to build`);
      continue;
    }
    const { transfer } = build;
    const json = `${JSON.stringify(transfer, null, 2)}\n`;
    const shardBytes = build.oblasts.reduce(
      (a, o) => a + JSON.stringify(o, null, 2).length + 1,
      0,
    );
    const c = transfer.coverage;
    console.log(
      `${cycle}: ${c.domesticSections} sections in ${transfer.oblasts.length} oblasts, ` +
        `${transfer.national.matrix.flows.length} edges, ` +
        `join ${c.sectionsWithEkatte}/${c.sectionsWithEkatte + c.sectionsWithoutEkatte} ` +
        `sections → ${c.settlementsJoined} settlements ` +
        // ⚠ „WITHOUT ЕКАТТЕ" AND „PLACEMENT-REFUSED" ARE DIFFERENT POPULATIONS, and the second
        // is the one literally named `_unplaced`. Printing the first as „unplaced" while
        // silently dropping the second is how 2011's larger omission went unnoticed.
        `(${c.votesWithoutEkatte} votes without ЕКАТТЕ, ` +
        `${c.unplacedSections} sections / ${c.unplacedVotes} votes placement-refused, ` +
        `${c.abroadVotes} abroad), ` +
        `residue ${transfer.residue.round1Only.length}/${transfer.residue.round2Only.length} ` +
        `(${transfer.residue.round1OnlyVotes}/${transfer.residue.round2OnlyVotes} votes) — ` +
        `${(json.length / 1024).toFixed(1)} KB` +
        // ⚠ THE SHARDS ARE REPORTED SEPARATELY, because they are what a REGION page downloads
        // and the cycle file is what the COUNTRY page downloads. One combined figure would
        // describe a request nobody makes.
        ` + ${build.oblasts.length} oblast shards, ` +
        `${(shardBytes / 1024).toFixed(1)} KB total / ` +
        `${(shardBytes / Math.max(1, build.oblasts.length) / 1024).toFixed(1)} KB each`,
    );
    if (!write) continue;
    // ⚠ THE OBJECT ALREADY BUILT, not a second `buildRunoffTransfer`. The summary above and
    // the bytes on disk must describe ONE build — and a second costs a full NNLS+RAS pass per
    // cycle (~1 s each) for nothing.
    for (const rel of writeBuild(build, { indent: 2, root: DATA_ROOT }))
      console.log(`  wrote data/${rel}`);
  }
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
