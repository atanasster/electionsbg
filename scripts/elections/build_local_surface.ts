// Local-election surfaces — country, region, municipality and settlement (§5.0), plus the
// `surface` key embedded in each polling-station file.
//
// ⚠⚠ MAYOR AND COUNCIL ARE TWO BALLOTS WITH TWO DENOMINATORS, AND THE CORPUS PUBLISHES ONE
// PROTOCOL. §2 decision 4 forbids merging them, and the reason is arithmetic rather than
// editorial: `protocol.numValidVotes` is the COUNCIL's total in **289 of 289** municipalities
// and the mayor's in **0**. In Пазарджик the council ran on 29,533 valid votes and the mayor on
// 34,961 — an 18% difference — so a strip that shares one denominator publishes one of the two
// races at the wrong scale, and every percentage on it is individually plausible.
//
// ⚠ THE MAYOR'S PUBLISHED PERCENTAGE CANNOT BE REPRODUCED FROM THE CORPUS, and it is carried
// verbatim rather than recomputed. §5 makes CIK the result authority, and `pctOfValid` is CIK's
// own figure. Measured: the denominator it implies (35,950 in Пазарджик r1, 32,818 in r2) is
// consistently LARGER than the candidate votes — which summing the sections' own `mayorValid`
// reproduces exactly at 34,961, i.e. `mayorValid` counts candidate votes only. Nothing in the
// corpus itemises the remainder; the probable cause is the "не подкрепям никого" option, which
// is a valid mayoral choice under Bulgarian law, but the corpus does not record it and this
// file does not assert it. The consequence to expect: a mayoral preview's percentages sum to
// slightly UNDER 100, and that is the official result rather than a rounding fault.
//
// ⚠ AN ELECTED MAYOR RESOLVES TO THE DECISIVE ROUND. `mayor.elected` names the winner and the
// round they won in; a runoff municipality's headline is round 2, and reading round 1 as the
// result names the leader of a race that did not end there.

import fs from "node:fs";
import path from "node:path";
import {
  MAX_BALLOT_PREVIEW,
  ELECTION_SURFACE_VERSION,
  isSplitControl,
  partyIdOrNull,
  type BallotKind,
  type ElectionBallotTotals,
  type ElectionRankedEntry,
  type ElectionSurfaceBallot,
  type ElectionSurfaceFact,
  type ElectionSurfaceV1,
} from "../../src/data/elections/surfaceTypes";
import { descriptorFor } from "../../src/screens/elections/electionSurfaceDescriptors";
import { buildDestinations, readReconciliation } from "./source_links";

export const DATA_ROOT = path.join(process.cwd(), "data");

// ─── the corpus shapes this file reads ──────────────────────────────────────────────────────

export type LocalProtocol = {
  numRegisteredVoters?: number | null;
  totalActualVoters?: number | null;
  /** ⚠ THE COUNCIL's valid votes — see the header. Never the mayor's. */
  numValidVotes?: number | null;
};

export type LocalCouncilRow = {
  localPartyNum: number;
  primaryCanonicalId?: string | null;
  isIndependent?: boolean;
  totalVotes: number;
  pctOfValid: number;
  mandatesWon: number;
};

export type LocalMayorRow = {
  candidateName: string;
  localPartyNum: number;
  primaryCanonicalId?: string | null;
  isIndependent?: boolean;
  round: number;
  votes: number;
  pctOfValid: number;
  isElected?: boolean;
};

export type LocalMunicipality = {
  cycle: string;
  obshtinaCode: string;
  obshtinaName?: string;
  oblastName?: string;
  protocol: LocalProtocol;
  mayor?: {
    round1?: LocalMayorRow[];
    round2?: LocalMayorRow[];
    elected?: LocalMayorRow | null;
  };
  council?: LocalCouncilRow[];
  kmetstva?: {
    kmetstvoName: string;
    ekatte?: string;
    candidates?: LocalMayorRow[];
    elected?: LocalMayorRow | null;
  }[];
};

export type LocalContext = {
  cycle: string;
  /** From the SOURCE FILE's mtime — never the clock (§9). */
  updatedAt: string;
};

// ─── the two ballots ────────────────────────────────────────────────────────────────────────

/** The mayoral round that DECIDED the office. §"Data gates": "an elected mayor resolves to the
 *  decisive round."
 *
 *  Returns round 1's field when no second round was held, and `null` when neither round carries
 *  rows — a municipality whose mayoral race the corpus does not cover, which is an absence
 *  rather than an unelected office. */
export const decisiveMayorRound = (
  mayor: LocalMunicipality["mayor"],
): { round: number; rows: LocalMayorRow[] } | null => {
  const r2 = mayor?.round2 ?? [];
  const r1 = mayor?.round1 ?? [];
  if (r2.length > 0) return { round: 2, rows: r2 };
  if (r1.length > 0) return { round: 1, rows: r1 };
  return null;
};

/** ⚠⚠ `isElected` ON A ROW IS NOT "THIS CANDIDATE WON". On a race that went to a second round
 *  the corpus flags BOTH finalists on their ROUND-1 rows — they were elected TO the runoff — so
 *  copying the flag names two winners for one office. Measured: 441 of 2,989 kmetstvo surfaces
 *  did exactly that, publishing 445 named people as elected village mayors who were not (in
 *  Дрянковец it marked Павел Валентинов Касабов alongside the real winner Мухарем Бейямин
 *  Ахмед). The authority is the race's own `elected` record, so the winner is passed in and
 *  matched, and every other row is explicitly NOT elected.
 *
 *  ⚠ `pctOfValid` IS CARRIED VERBATIM. Recomputing it over the candidate sum disagrees with the
 *  published result by ~3% — see the header — and CIK is the result authority (§5). */
const mayorPreview = (
  rows: readonly LocalMayorRow[],
  /** The race's elected candidate, where the corpus names one. `undefined` means the winner is
   *  taken from the rows' own flags, which is only safe on a single-round race. */
  elected?: LocalMayorRow | null,
): ElectionRankedEntry[] => {
  const sorted = [...rows]
    .sort((a, b) => b.votes - a.votes || a.localPartyNum - b.localPartyNum)
    .slice(0, MAX_BALLOT_PREVIEW);
  return sorted.map((r, i) => {
    const entry: ElectionRankedEntry = {
      // ⚠ AN INDEPENDENT HAS NO CANONICAL PARTY, and `null` is the honest value (§5.3). A
      // placeholder id would attach a named person to a party they do not stand for.
      partyId: r.isIndependent ? null : partyIdOrNull(r.primaryCanonicalId),
      localPartyNum: r.localPartyNum,
      candidateName: r.candidateName,
      isIndependent: r.isIndependent === true,
      votes: r.votes,
      pct: r.pctOfValid,
      isElected:
        elected === undefined
          ? r.isElected === true
          : // Matched on the candidate AND their ballot number: two people can share a name.
            elected !== null &&
            elected.candidateName === r.candidateName &&
            elected.localPartyNum === r.localPartyNum,
    };
    if (i === 0 && sorted.length > 1)
      entry.marginPct = Number(
        (r.pctOfValid - sorted[1].pctOfValid).toFixed(2),
      );
    return entry;
  });
};

const councilPreview = (
  rows: readonly LocalCouncilRow[],
): ElectionRankedEntry[] => {
  const sorted = [...rows]
    .sort(
      (a, b) =>
        b.totalVotes - a.totalVotes || a.localPartyNum - b.localPartyNum,
    )
    .slice(0, MAX_BALLOT_PREVIEW);
  return sorted.map((r, i) => {
    const entry: ElectionRankedEntry = {
      partyId: r.isIndependent ? null : partyIdOrNull(r.primaryCanonicalId),
      localPartyNum: r.localPartyNum,
      isIndependent: r.isIndependent === true,
      votes: r.totalVotes,
      pct: r.pctOfValid,
      seats: r.mandatesWon,
    };
    if (i === 0 && sorted.length > 1)
      entry.marginPct = Number(
        (r.pctOfValid - sorted[1].pctOfValid).toFixed(2),
      );
    return entry;
  });
};

/** ⚠ THE TWO BALLOTS GET THEIR OWN TOTALS. The council's valid votes come from the protocol;
 *  the mayor's are summed from the candidate rows, because the protocol does not carry them. */
const totalsFor = (
  protocol: LocalProtocol,
  validVotes: number,
  /** ⚠ SET ON A SECOND ROUND. The municipality protocol records the FIRST-round day — it
   *  reproduces the section sums exactly — so attaching its turnout to a round-2 ballot
   *  publishes the wrong day's participation for the round that decided the office. Measured:
   *  111 of 113 runoff municipalities did so, and Пловдив's round 2 drew ~30% fewer voters than
   *  the 34.02% the round-1 protocol reports. */
  suppressTurnout = false,
): ElectionBallotTotals => {
  const votesCast = protocol.totalActualVoters ?? 0;
  const registered = protocol.numRegisteredVoters ?? 0;
  // Same self-consistency and denominator rules as the parliamentary side: a rate we cannot
  // stand behind is reported as absent.
  if (
    suppressTurnout ||
    registered <= 0 ||
    votesCast > registered ||
    validVotes > votesCast
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

// ─── facts ──────────────────────────────────────────────────────────────────────────────────

/** ⚠ EVERY FACT NAMES ITS BALLOT. A strip carrying a mayoral margin beside a council seat count
 *  with nothing saying which is which is the merge §2 decision 4 forbids, done one component
 *  later. `ElectionSurfaceFact.ballot` exists for exactly this. */
export const localFactsFor = (
  level: Parameters<typeof descriptorFor>[1],
  mayorBallot: ElectionSurfaceBallot | null,
  councilBallot: ElectionSurfaceBallot | null,
  splitControl: boolean,
  runoffPending: boolean,
): ElectionSurfaceFact[] => {
  const d = descriptorFor("local", level);
  if (!d.available) return [];
  const mayorLead = mayorBallot?.preview[0];
  const councilLead = councilBallot?.preview[0];
  const available: Partial<Record<string, ElectionSurfaceFact>> = {
    winner: mayorLead
      ? {
          code: "winner",
          value: mayorLead.pct,
          unit: "pct",
          ballot: mayorBallot!.kind,
          basis: "valid_votes",
        }
      : councilLead
        ? {
            code: "winner",
            value: councilLead.pct,
            unit: "pct",
            ballot: councilBallot!.kind,
            basis: "valid_votes",
          }
        : undefined,
    margin:
      mayorLead?.marginPct !== undefined
        ? {
            code: "margin",
            value: mayorLead.marginPct,
            unit: "pct_point",
            ballot: mayorBallot!.kind,
            basis: "valid_votes",
          }
        : undefined,
    seats:
      councilLead?.seats !== undefined
        ? {
            code: "seats",
            value: councilLead.seats,
            unit: "seats",
            ballot: councilBallot!.kind,
            basis: "seats_total",
          }
        : undefined,
    turnout:
      councilBallot?.totals.turnoutBasis === "registered_voters" &&
      councilBallot.totals.turnoutPct !== undefined
        ? {
            code: "turnout",
            value: councilBallot.totals.turnoutPct,
            unit: "pct",
            basis: "registered_voters",
          }
        : undefined,
    // Qualitative facts carry no value — §7's categorical signals, as facts.
    split_control: splitControl
      ? { code: "split_control", unit: "none" }
      : undefined,
    runoff_pending: runoffPending
      ? { code: "runoff_pending", unit: "none" }
      : undefined,
    valid_votes: councilBallot
      ? {
          code: "valid_votes",
          value: councilBallot.totals.validVotes,
          unit: "votes",
          ballot: councilBallot.kind,
          basis: "valid_votes",
        }
      : undefined,
  };
  return d.factPriority
    .map((code) => available[code])
    .filter((f): f is ElectionSurfaceFact => f !== undefined)
    .slice(0, d.maxFacts);
};

// ─── the municipality surface ───────────────────────────────────────────────────────────────

/** Does the mayor's party differ from the council's largest? §7 keeps this signal because it is
 *  rare — 32 of the 245 municipalities whose mayor carries a canonical party id (13.1%).
 *
 *  ⚠ RE-EXPORTED, NOT RE-DECLARED. The rule and its `"independent"` sentinel moved to
 *  `surfaceTypes.ts` — which the browser can import and this file cannot be imported FROM, since
 *  it opens with `node:fs`. `PlaceDigestLocalCell.mayorMatchesCouncil` states exactly what this
 *  signal states, and the two deciding it separately is the defect that field's comment exists
 *  to prevent. The caveats that used to live here are with the definition. */
export {
  NON_PARTY_IDS,
  isSplitControl,
} from "../../src/data/elections/surfaceTypes";

export const buildMunicipalitySurface = (
  m: LocalMunicipality,
  ctx: LocalContext,
): ElectionSurfaceV1 => {
  const decisive = decisiveMayorRound(m.mayor);
  const councilRows = m.council ?? [];

  const mayorBallot: ElectionSurfaceBallot | null = decisive
    ? {
        kind: "municipality_mayor" satisfies BallotKind,
        round: decisive.round,
        resultStatus: "final",
        preview: mayorPreview(decisive.rows, m.mayor?.elected ?? null),
        // The mayor's own denominator: the candidate votes, which is what the rows add to.
        totals: totalsFor(
          m.protocol,
          decisive.rows.reduce((a, r) => a + r.votes, 0),
          decisive.round > 1,
        ),
        completeResult: {
          to: `/local/${ctx.cycle}/${m.obshtinaCode}/mayor`,
          available: true,
        },
      }
    : null;

  const councilBallot: ElectionSurfaceBallot | null = councilRows.length
    ? {
        kind: "municipal_council" satisfies BallotKind,
        resultStatus: "final",
        preview: councilPreview(councilRows),
        totals: totalsFor(m.protocol, m.protocol.numValidVotes ?? 0),
        seatsTotal: councilRows.reduce((a, r) => a + (r.mandatesWon || 0), 0),
        completeResult: {
          to: `/local/${ctx.cycle}/${m.obshtinaCode}/council`,
          available: true,
        },
      }
    : null;

  const councilLeadParty = councilBallot?.preview[0]?.partyId ?? null;
  const mayorParty = m.mayor?.elected?.isIndependent
    ? null
    : partyIdOrNull(m.mayor?.elected?.primaryCanonicalId);
  const splitControl = isSplitControl(mayorParty, councilLeadParty);
  // A second round was held but produced no elected mayor — the office is still open.
  const runoffPending = (m.mayor?.round2?.length ?? 0) > 0 && !m.mayor?.elected;

  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "local",
    cycle: ctx.cycle,
    place: { level: "municipality", id: m.obshtinaCode },
    status: {
      result: runoffPending ? "runoff_pending" : "final",
      sourceLabel: "cik",
      updatedAt: ctx.updatedAt,
      // ⚠ PRESENT IFF THE CYCLE SHIPS A SIDECAR, and re-derived from its parts (§5). Absent
      // means NOT RECONCILED — never "the two sources agree".
      ...(() => {
        const r = readReconciliation(ctx.cycle, m.obshtinaCode);
        return r ? { reconciliation: r } : {};
      })(),
    },
    // ⚠ TWO BALLOTS, NEVER MERGED (§2 decision 4). Mayor first — it is the office a reader came
    // for — then the council.
    ballots: [mayorBallot, councilBallot].filter(
      (b): b is ElectionSurfaceBallot => b !== null,
    ),
    facts: localFactsFor(
      "municipality",
      mayorBallot,
      councilBallot,
      splitControl,
      runoffPending,
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "local",
      level: "municipality",
      id: m.obshtinaCode,
      cycle: ctx.cycle,
      completeResultTo: `/local/${ctx.cycle}/${m.obshtinaCode}`,
      localCycle: ctx.cycle,
      inLocalCycle: true,
    }),
  };
};

// ─── the settlement surface ─────────────────────────────────────────────────────────────────

/** ⚠ A KMETSTVO RACE CARRIES NO EKATTE — 0 of 3,032 — so a settlement surface cannot be keyed
 *  from the municipality bundle alone. The committed `data/local_mayors/kmetstvo_to_ekatte.json`
 *  is what the site already resolves them with (2,989 entries, keyed
 *  `"<OBSHTINA>:<lowercased name>"`), so it is read rather than a second matcher written.
 *
 *  ⚠ AN UNRESOLVED NAME EMITS NOTHING. 43 of 3,032 races do not resolve; guessing an ekatte
 *  would publish a village's mayoral result under a different village's page. */
export type KmetstvoEkatteMap = ReadonlyMap<string, string>;

export const loadKmetstvoEkatte = (
  file = path.join(DATA_ROOT, "local_mayors", "kmetstvo_to_ekatte.json"),
): KmetstvoEkatteMap => {
  if (!fs.existsSync(file)) return new Map();
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    string
  >;
  return new Map(Object.entries(raw).map(([k, v]) => [k, String(v)]));
};

export const kmetstvoKey = (obshtina: string, name: string): string =>
  `${obshtina}:${name.trim().toLowerCase()}`;

/** A kmetstvo (settlement-mayor) race, as its own surface.
 *
 *  ⚠ IT CARRIES THE MAYORAL BALLOT ONLY. §"Data gates": "settlement surfaces never attribute a
 *  parent council as a settlement office." A kmetstvo elects a mayor and no council; folding the
 *  municipality's council in would publish a body the settlement does not elect. */
export const buildSettlementSurface = (
  args: {
    ekatte: string;
    obshtina: string;
    kmetstvoName: string;
    candidates: LocalMayorRow[];
    elected?: LocalMayorRow | null;
  },
  ctx: LocalContext,
): ElectionSurfaceV1 => {
  const rows = args.candidates;
  const round = Math.max(1, ...rows.map((r) => r.round || 1));
  const decisive = rows.filter((r) => (r.round || 1) === round);
  const validVotes = decisive.reduce((a, r) => a + r.votes, 0);
  const ballot: ElectionSurfaceBallot = {
    kind: "settlement_mayor" satisfies BallotKind,
    round,
    resultStatus: "final",
    preview: mayorPreview(decisive, args.elected ?? null),
    // A kmetstvo has no protocol of its own in this corpus, so there is no registered-voter
    // denominator and therefore no turnout — an absence, not a zero.
    totals: { votesCast: validVotes, validVotes, turnoutBasis: "unavailable" },
    completeResult: {
      to: `/local/${ctx.cycle}/settlement/${args.ekatte}`,
      available: true,
    },
  };
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "local",
    cycle: ctx.cycle,
    place: { level: "settlement", id: args.ekatte },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots: rows.length ? [ballot] : [],
    facts: rows.length
      ? localFactsFor("settlement", ballot, null, false, false)
      : [],
    standouts: [],
    destinations: buildDestinations({
      kind: "local",
      level: "settlement",
      id: args.ekatte,
      cycle: ctx.cycle,
      completeResultTo: `/local/${ctx.cycle}/settlement/${args.ekatte}`,
      localCycle: ctx.cycle,
      inLocalCycle: true,
    }),
  };
};

/** Every resolvable kmetstvo race in a municipality, keyed by ekatte. */
export const settlementRacesOf = (
  m: LocalMunicipality,
  map: KmetstvoEkatteMap,
): {
  ekatte: string;
  kmetstvoName: string;
  candidates: LocalMayorRow[];
  elected?: LocalMayorRow | null;
}[] => {
  const out: ReturnType<typeof settlementRacesOf> = [];
  for (const k of m.kmetstva ?? []) {
    const ekatte =
      k.ekatte || map.get(kmetstvoKey(m.obshtinaCode, k.kmetstvoName));
    if (!ekatte) continue; // unresolved — see loadKmetstvoEkatte
    out.push({
      ekatte,
      kmetstvoName: k.kmetstvoName,
      candidates: k.candidates ?? [],
      elected: k.elected ?? null,
    });
  }
  return out;
};

// ─── the section surface, EMBEDDED rather than emitted (§5.0) ───────────────────────────────

export type LocalSectionFile = {
  cycle: string;
  obshtinaCode: string;
  section: {
    sectionCode: string;
    ekatte?: string;
    numRegisteredVoters?: number | null;
    totalActualVoters?: number | null;
    /** ⚠ THE COUNCIL's valid votes. `mayorValid` is the mayor's — see the file header. */
    numValidVotes?: number | null;
    partyVotes?: { localPartyNum: number; votes: number }[];
    mayorVotes?: { localPartyNum: number; votes: number }[];
    mayorValid?: number | null;
  };
  /** The per-cycle party dictionary; a section's rows carry only a ballot number. */
  parties?: { localPartyNum: number; primaryCanonicalId?: string | null }[];
};

/** ⚠ THE SECTION CARRIES BOTH BALLOTS EXPLICITLY, and the corpus is unusually clear here:
 *  `numValidVotes` is the council's and `mayorValid` is the mayor's, published side by side.
 *  This is the level that PROVES the two denominators differ — 168 against 201 in Пазарджик's
 *  station 131900001 — so a section surface that shared one is contradicted by its own source. */
export const buildLocalSectionSurface = (
  f: LocalSectionFile,
  ctx: LocalContext,
): ElectionSurfaceV1 => {
  const sec = f.section;
  const idOf = new Map(
    (f.parties ?? []).map((p) => [
      p.localPartyNum,
      p.primaryCanonicalId ?? null,
    ]),
  );
  const protocol: LocalProtocol = {
    numRegisteredVoters: sec.numRegisteredVoters,
    totalActualVoters: sec.totalActualVoters,
    numValidVotes: sec.numValidVotes,
  };
  const rank = (
    rows: readonly { localPartyNum: number; votes: number }[],
    valid: number,
  ): ElectionRankedEntry[] =>
    [...rows]
      .filter((r) => r.votes > 0)
      .sort((a, b) => b.votes - a.votes || a.localPartyNum - b.localPartyNum)
      .slice(0, MAX_BALLOT_PREVIEW)
      .map((r, i, arr) => {
        const pct =
          valid > 0 ? Number(((r.votes / valid) * 100).toFixed(2)) : 0;
        const e: ElectionRankedEntry = {
          partyId: idOf.get(r.localPartyNum) ?? null,
          localPartyNum: r.localPartyNum,
          votes: r.votes,
          pct,
        };
        if (i === 0 && arr.length > 1)
          e.marginPct = Number(
            (pct - (valid > 0 ? (arr[1].votes / valid) * 100 : 0)).toFixed(2),
          );
        return e;
      });

  const ballots: ElectionSurfaceBallot[] = [];
  const mayorRows = sec.mayorVotes ?? [];
  const mayorValid = sec.mayorValid ?? 0;
  if (mayorRows.length && mayorValid > 0)
    ballots.push({
      kind: "municipality_mayor" satisfies BallotKind,
      resultStatus: "final",
      preview: rank(mayorRows, mayorValid),
      totals: totalsFor(protocol, mayorValid),
      completeResult: {
        to: `/local/${ctx.cycle}/${f.obshtinaCode}/mayor`,
        available: true,
      },
    });
  const councilRows = sec.partyVotes ?? [];
  if (councilRows.length)
    ballots.push({
      kind: "municipal_council" satisfies BallotKind,
      resultStatus: "final",
      preview: rank(councilRows, sec.numValidVotes ?? 0),
      totals: totalsFor(protocol, sec.numValidVotes ?? 0),
      completeResult: {
        to: `/local/${ctx.cycle}/${f.obshtinaCode}/council`,
        available: true,
      },
    });

  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "local",
    cycle: ctx.cycle,
    place: { level: "section", id: sec.sectionCode },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots,
    facts: localFactsFor(
      "section",
      ballots.find((b) => b.kind === "municipality_mayor") ?? null,
      ballots.find((b) => b.kind === "municipal_council") ?? null,
      false,
      false,
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "local",
      level: "section",
      id: sec.sectionCode,
      cycle: ctx.cycle,
      completeResultTo: sec.ekatte
        ? `/local/${ctx.cycle}/settlement/${sec.ekatte}`
        : null,
    }),
  };
};

export const sectionObshtini = (cycle: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "sections");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
};

export const sectionFilesOf = (cycle: string, obshtina: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "sections", obshtina);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
};

export const readLocalSection = (file: string): LocalSectionFile =>
  JSON.parse(fs.readFileSync(file, "utf8")) as LocalSectionFile;

// ─── the country and region rollups ─────────────────────────────────────────────────────────

export type LocalIndex = {
  cycle: string;
  municipalities?: {
    obshtinaCode: string;
    oblast?: string;
    hadRound2?: boolean;
  }[];
  // ⚠ `displayName` IS READ, and it is the only thing that can name a `local:` bucket. The
  // narrowed shapes here omitted it, so the builders had nothing but the id — which is why the
  // id's own Bulgarian name ended up in `partyId`. It is the source's own printed form; do not
  // reconstruct it from the id, which is lowercased.
  councilVoteShare?: {
    canonicalId: string;
    displayName: string;
    totalVotes: number;
    pctOfValid: number;
  }[];
  mayorsByCanonical?: {
    canonicalId: string;
    displayName: string;
    count: number;
  }[];
};

export type LocalRegion = {
  oblast: string;
  turnout?: LocalProtocol & { pct?: number };
  mayorsWon?: { canonicalId: string; count: number }[];
  councilSeats?: { canonicalId: string; displayName: string; seats: number }[];
  municipalities?: unknown[];
};

/** ⚠ THE COUNTRY'S MAYORAL "RESULT" IS A COUNT OF OFFICES, NOT A VOTE SHARE. `mayorsByCanonical`
 *  is how many mayoralties each party won; rendering it as a percentage of anything would invent
 *  a national mayoral election that does not exist. The unit is `count` and the fact code says
 *  so, which is what stops a consumer captioning it "%".  */
/** Split a local corpus bucket id into the canonical party it names, or the local list's own
 *  Bulgarian name when it names none.
 *
 *  ⚠ THE COUNTRY AND REGION SOURCES BUCKET BY NAME. `index.json` and `region.json` key a list
 *  with no `primaryCanonicalId` under `local:<its lowercased name>`, and passing that straight
 *  into `partyId` put a party's name — in one case a person's — inside an identifier, on the
 *  two levels the no-prose gate never ran on. It also resolved to nothing: 51 of the corpus's
 *  122 ids are not in `canonical_parties.json`, so 108 preview rows had no label in either
 *  language. The name comes from the source's own `displayName`, not from the id, because the
 *  id is lowercased and the displayName is what the corpus prints. */
const partyRef = (
  canonicalId: string,
  displayName: string,
): { partyId: string | null; localPartyName?: string } => {
  const id = partyIdOrNull(canonicalId);
  return id ? { partyId: id } : { partyId: null, localPartyName: displayName };
};

/** The same split for a fact's `labelParams`, which the renderer interpolates into copy. A
 *  `local:` id reaching here is the identical defect one layer along — the copy would print the
 *  bucket id, prefix and all. */
const factParty = (
  canonicalId: string,
  displayName: string,
): Record<string, string | number> => {
  const id = partyIdOrNull(canonicalId);
  return id ? { partyId: id } : { localPartyName: displayName };
};

export const buildCountrySurface = (
  index: LocalIndex,
  ctx: LocalContext,
  /** National council seats by party, summed from the region files — the country source
   *  publishes none of its own. Absent means the `seats` fact is not emitted, never zero. */
  seatsByParty?: ReadonlyMap<string, number>,
): ElectionSurfaceV1 => {
  const council = [...(index.councilVoteShare ?? [])]
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, MAX_BALLOT_PREVIEW);
  const mayors = [...(index.mayorsByCanonical ?? [])].sort(
    (a, b) => b.count - a.count || (a.canonicalId < b.canonicalId ? -1 : 1),
  );
  const validVotes = (index.councilVoteShare ?? []).reduce(
    (a, r) => a + r.totalVotes,
    0,
  );
  const councilBallot: ElectionSurfaceBallot = {
    kind: "municipal_council" satisfies BallotKind,
    resultStatus: "final",
    preview: council.map((r, i) => ({
      ...partyRef(r.canonicalId, r.displayName),
      votes: r.totalVotes,
      pct: Number(r.pctOfValid.toFixed(2)),
      ...(i === 0 && council.length > 1
        ? {
            marginPct: Number(
              (r.pctOfValid - council[1].pctOfValid).toFixed(2),
            ),
          }
        : {}),
    })),
    // The national aggregate carries no registered-voter figure of its own here.
    totals: { votesCast: validVotes, validVotes, turnoutBasis: "unavailable" },
    completeResult: { to: `/local/${ctx.cycle}`, available: true },
  };
  const facts: ElectionSurfaceFact[] = [];
  if (mayors[0])
    facts.push({
      code: "winner",
      value: mayors[0].count,
      unit: "count",
      ballot: "municipality_mayor",
      labelParams: factParty(mayors[0].canonicalId, mayors[0].displayName),
    });
  // ⚠ `seats` MUST BE A SEAT COUNT. It carried the leading party's council VOTE SHARE, which
  // renders under `election_fact_seats` ("Места"/"Seats") as "Места: 23.95%" — a seat count
  // that is a percentage. The country source publishes no seat totals, so they are summed from
  // the region files and the fact is omitted entirely when that sum is unavailable.
  const leadSeats = council[0]
    ? seatsByParty?.get(council[0].canonicalId)
    : undefined;
  if (leadSeats !== undefined)
    facts.push({
      code: "seats",
      value: leadSeats,
      unit: "seats",
      ballot: "municipal_council",
      basis: "seats_total",
      labelParams: factParty(council[0]!.canonicalId, council[0]!.displayName),
    });
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "local",
    cycle: ctx.cycle,
    place: { level: "country", id: "BG" },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots: [councilBallot],
    facts: facts.slice(
      0,
      descriptorFor("local", "country").available
        ? (descriptorFor("local", "country") as { maxFacts: number }).maxFacts
        : 0,
    ),
    standouts: [],
    destinations: buildDestinations({
      kind: "local",
      level: "country",
      id: "BG",
      cycle: ctx.cycle,
      completeResultTo: `/local/${ctx.cycle}`,
      localCycle: ctx.cycle,
      inLocalCycle: true,
    }),
  };
};

export const buildRegionSurface = (
  r: LocalRegion,
  ctx: LocalContext,
): ElectionSurfaceV1 => {
  const seats = [...(r.councilSeats ?? [])].sort(
    (a, b) => b.seats - a.seats || (a.canonicalId < b.canonicalId ? -1 : 1),
  );
  const totalSeats = seats.reduce((a, x) => a + x.seats, 0);
  const t = r.turnout ?? {};
  const ballot: ElectionSurfaceBallot = {
    kind: "municipal_council" satisfies BallotKind,
    resultStatus: "final",
    // ⚠⚠ A REGION AGGREGATE HAS SEATS AND NO PER-PARTY VOTES, AND `pct` IS THE VOTE SHARE.
    // Putting the seat share there overstates it badly — ГЕРБ in Варна read 40.18 against a
    // true council vote share of 23.17%, a 17-point error on a ballot whose own
    // `totals.validVotes` (141,998) makes the number checkable. An earlier comment here
    // disclaimed exactly what the code then did.
    //
    // So `pct` is 0 and `seats` carries the result. `votes: 0` asserts nothing about turnout at
    // this level: the field is required by the type and this source publishes no per-party
    // total, which is what `seats` being the only populated column says.
    preview: seats.slice(0, MAX_BALLOT_PREVIEW).map((x) => ({
      ...partyRef(x.canonicalId, x.displayName),
      votes: 0,
      pct: 0,
      seats: x.seats,
    })),
    totals: totalsFor(t, t.numValidVotes ?? 0),
    seatsTotal: totalSeats,
    completeResult: {
      to: `/local/${ctx.cycle}/region/${r.oblast}`,
      available: true,
    },
  };
  const facts: ElectionSurfaceFact[] = [];
  if (seats[0])
    facts.push({
      code: "seats",
      value: seats[0].seats,
      unit: "seats",
      ballot: "municipal_council",
      basis: "seats_total",
      labelParams: factParty(seats[0].canonicalId, seats[0].displayName),
    });
  if (ballot.totals.turnoutBasis === "registered_voters")
    facts.push({
      code: "turnout",
      value: ballot.totals.turnoutPct!,
      unit: "pct",
      basis: "registered_voters",
    });
  return {
    schemaVersion: ELECTION_SURFACE_VERSION,
    kind: "local",
    cycle: ctx.cycle,
    place: { level: "region", id: r.oblast },
    status: { result: "final", sourceLabel: "cik", updatedAt: ctx.updatedAt },
    ballots: [ballot],
    facts,
    standouts: [],
    destinations: buildDestinations({
      kind: "local",
      level: "region",
      id: r.oblast,
      cycle: ctx.cycle,
      completeResultTo: `/local/${ctx.cycle}/region/${r.oblast}`,
      localCycle: ctx.cycle,
      inLocalCycle: true,
    }),
  };
};

// ─── reading the corpus ─────────────────────────────────────────────────────────────────────

export const municipalityCodes = (cycle: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "municipalities");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
};

export const readMunicipality = (
  cycle: string,
  code: string,
): LocalMunicipality | null => {
  const p = path.join(DATA_ROOT, cycle, "municipalities", `${code}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as LocalMunicipality;
};

/** National council seats by party, summed from every region file. The country source carries
 *  no seat totals, so this is the only place they exist at national scope. */
export const nationalSeatsByParty = (
  cycle: string,
): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const o of regionCodes(cycle)) {
    const r = readRegion(cycle, o);
    for (const s of r?.councilSeats ?? [])
      out.set(s.canonicalId, (out.get(s.canonicalId) ?? 0) + s.seats);
  }
  return out;
};

export const readIndex = (cycle: string): LocalIndex | null => {
  const p = path.join(DATA_ROOT, cycle, "index.json");
  return fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf8")) as LocalIndex)
    : null;
};

export const regionCodes = (cycle: string): string[] => {
  const dir = path.join(DATA_ROOT, cycle, "region");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
};

export const readRegion = (
  cycle: string,
  oblast: string,
): LocalRegion | null => {
  const p = path.join(DATA_ROOT, cycle, "region", `${oblast}.json`);
  return fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf8")) as LocalRegion)
    : null;
};

export const sourceUpdatedAt = (file: string): string =>
  fs.statSync(file).mtime.toISOString();
