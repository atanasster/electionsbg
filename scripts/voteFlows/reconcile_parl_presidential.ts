// Cross-type reconciliation: the PARLIAMENTARY vote at or before a presidential cycle (the
// "from") → one round of that cycle's presidential ballot (the "to"). „Where did the party's
// voters go when the same people chose a president."
//
// Produces the same `ReconcileResult` shape as reconcile.ts / reconcile_local.ts /
// reconcile_parl_local.ts, so the estimator (`estimateOblast`: NNLS + RAS) and the serializer
// (`buildVoteFlowScopeFiles`) are reused verbatim. Only the inputs differ.
//
// ⚠⚠ THE JOIN IS A CASCADE, BECAUSE NEITHER KEY WINS EVERYWHERE. Measured over the whole
// corpus (2026-09-08), share of PRESIDENTIAL sections finding a parliamentary twin:
//
//     pair                 full 9-digit   (obshtina, last-7)   cascade
//     2005_06_25 → 2006          66.1%                54.6%     66.1%
//     2009_07_05 → 2011          54.6%                86.8%     87.3%
//     2014_10_05 → 2016          97.4%                85.5%     97.4%
//     2021_11_14 → 2021         100.0%                87.2%    100.0%
//
// The МИР prefix scheme moved between 2009 and 2011, which is why the full code collapses
// there and the obshtina-keyed one does not; and 2005→2006 is poor on both. `(ekatte, last-3)`
// was measured too — worse everywhere, and carrying 99–356 DUPLICATE keys, so a match on it
// would silently pick one of two stations. It is not used.
//
// ⚠⚠ „НЕ ПОДКРЕПЯМ НИКОГО" IS ITS OWN LANE AND IS NOT IN `votes[]`. It lives in the protocol
// (`numValidNoOnePaperVotes` + `numValidNoOneMachineVotes`) and is a real option on the
// presidential ballot from 2016. Folded into abstain it would claim those people stayed home
// when they turned out and chose nobody; dropped, the column mass would not balance and RAS
// would smear the difference across every ticket. The lane appears only where the ballot had
// the option.
//
// ⚠ THE OBLAST GROUPING IS THE PRESIDENTIAL SHARD NAME (`PDV`, `PDV-00`, `S23`…), so the scope
// files line up with `/presidential/:cycle/region/:oblast`. `_unplaced` is excluded — „nowhere"
// is not a geography, the rule `build_runoff_transfer.ts` already follows — and its sections
// are counted as dropped rather than vanishing.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { PartyInfo, SectionInfo } from "@/data/dataTypes";
import { ABSTAIN_LANE } from "./pseudoLanes";
import {
  ABSTAIN_ID,
  EXITED_ID,
  JOINED_ID,
  ReconcileResult,
  buildPartyNumToCanonical,
} from "./reconcile";
import { PARL_OTHER_ID } from "./reconcile_parl_local";

/** To-side pseudo: tickets below the readability cut. */
export const PVR_OTHER_ID = "__pvr_other";
/** To-side lane: „не подкрепям никого" — a vote cast for nobody, never an abstention. */
export const PVR_NONE_ID = "__pvr_none";

/** ⚠ A READABILITY CUT AND NOTHING ELSE — a presidential ballot has no legal threshold, and
 *  2021 put 23 tickets on it. Applied to the ROUND's own valid votes. */
const TICKET_THRESHOLD = 0.01;
/** The parliamentary side's cut, the same 1% `reconcile_parl_local.ts` uses. */
const PARTY_THRESHOLD = 0.01;

/** The shard „nowhere" lands in — see the header. */
const UNPLACED_SHARD = "_unplaced";

/**
 * The roll a section's shares are taken over.
 *
 * ⚠⚠ `numRegisteredVoters` ALONE PRODUCES ROWS THE REGRESSION CANNOT SURVIVE. The other three
 * reconcilers divide by `Math.max(1, registered)`, which turns a protocol reporting no roll
 * into a denominator of ONE — measured on this corpus, that gives 2016 a section whose share
 * vector sums to **534** and 2011 one at 389, each of them then dominating the NNLS fit inside
 * its oblast. Seven such sections exist on 2011 and one on 2016.
 *
 * ⚠ AND IT IS NOT ONLY THE ZERO CASE. 581 of 2021's 12,488 sections (4.65%) record more votes
 * than registered voters — mobile and ship sections, and voters added on the day — where an
 * abstention clamped at zero leaves the vector summing above 1.
 *
 * Both are the same mistake: a roll cannot be smaller than the turnout it produced. Taking the
 * larger of the two needs no threshold, makes the abstention non-negative by construction, and
 * keeps every section rather than dropping the ones that voted hardest. The floor of 1 remains
 * for a section with neither a roll nor a vote, which contributes nothing either way.
 */
const effectiveRoll = (registered: number, voted: number): number =>
  Math.max(1, registered, voted);

type ParlSection = { info: SectionInfo; registered: number };

type PvrSection = {
  code: string;
  /** Presidential shard name — the scope key for the per-oblast files. */
  oblast: string;
  obshtina?: string;
  registered: number;
  /** Ticket ballot number → votes. */
  byTicket: Map<number, number>;
  /** „не подкрепям никого", from the protocol rather than from `votes[]`. */
  noOne: number;
};

type Ticket = { number: number; president: string; color?: string };

/** Parliamentary sections, indexed BOTH ways so the cascade can try either key. */
const loadParliamentary = (
  publicFolder: string,
  date: string,
  canMap: Map<number, string>,
) => {
  const byCode = new Map<string, ParlSection>();
  const byObshtina = new Map<string, Map<string, ParlSection>>();
  const totalByCanonical = new Map<string, number>();
  let totalVotes = 0;
  const dir = path.join(publicFolder, date, "sections", "by-oblast");
  if (!fs.existsSync(dir))
    return { byCode, byObshtina, totalByCanonical, totalVotes };
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const obj: Record<string, SectionInfo> = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf-8"),
    );
    for (const [code, info] of Object.entries(obj)) {
      const registered = info.results.protocol?.numRegisteredVoters ?? 0;
      const sec: ParlSection = { info, registered };
      byCode.set(code, sec);
      const ob = info.obshtina;
      if (ob) {
        if (!byObshtina.has(ob)) byObshtina.set(ob, new Map());
        byObshtina.get(ob)!.set(code.slice(2), sec);
      }
      for (const v of info.results.votes) {
        const votes = v.totalVotes ?? 0;
        totalVotes += votes;
        const can = canMap.get(v.partyNum);
        if (can)
          totalByCanonical.set(can, (totalByCanonical.get(can) ?? 0) + votes);
      }
    }
  }
  return { byCode, byObshtina, totalByCanonical, totalVotes };
};

const loadPresidential = (
  publicFolder: string,
  cycle: string,
  round: 1 | 2,
) => {
  const sections: PvrSection[] = [];
  const totalByTicket = new Map<number, number>();
  let totalValid = 0;
  let noOneTotal = 0;
  let unplaced = 0;
  const dir = path.join(publicFolder, cycle, `tur${round}`, "sections");
  if (!fs.existsSync(dir))
    return { sections, totalByTicket, totalValid, noOneTotal, unplaced };
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const oblast = file.replace(/\.json$/, "");
    const rows = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf-8"),
    ) as Array<{
      code: string;
      obshtina?: string;
      protocol?: Record<string, number>;
      votes: { partyNum: number; totalVotes: number }[];
    }>;
    for (const s of rows) {
      // ⚠ COUNTED AS DROPPED, NOT SKIPPED SILENTLY — the coverage figure this pipeline
      // refuses on has to include them.
      if (oblast === UNPLACED_SHARD) {
        unplaced += 1;
        continue;
      }
      const p = s.protocol ?? {};
      const byTicket = new Map<number, number>();
      for (const v of s.votes) {
        byTicket.set(
          v.partyNum,
          (byTicket.get(v.partyNum) ?? 0) + v.totalVotes,
        );
        totalByTicket.set(
          v.partyNum,
          (totalByTicket.get(v.partyNum) ?? 0) + v.totalVotes,
        );
        totalValid += v.totalVotes;
      }
      const noOne =
        (p.numValidNoOnePaperVotes ?? 0) + (p.numValidNoOneMachineVotes ?? 0);
      noOneTotal += noOne;
      totalValid += noOne;
      sections.push({
        code: s.code,
        oblast,
        obshtina: s.obshtina,
        registered: p.numRegisteredVoters ?? 0,
        byTicket,
        noOne,
      });
    }
  }
  return { sections, totalByTicket, totalValid, noOneTotal, unplaced };
};

const readTickets = (
  publicFolder: string,
  cycle: string,
): Map<number, Ticket> => {
  const file = path.join(publicFolder, cycle, "tickets.json");
  if (!fs.existsSync(file)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    tickets?: Ticket[];
  };
  return new Map((parsed.tickets ?? []).map((t) => [t.number, t]));
};

export const reconcileParliamentaryToPresidential = ({
  publicFolder,
  fromDate,
  cycle,
  round,
  canonical,
}: {
  publicFolder: string;
  /** Parliamentary election folder, e.g. "2014_10_05". */
  fromDate: string;
  /** Presidential cycle folder, e.g. "2016_11_06_pvr". */
  cycle: string;
  round: 1 | 2;
  canonical: CanonicalPartiesIndex;
}): ReconcileResult => {
  const cikPath = path.join(publicFolder, fromDate, "cik_parties.json");
  const cik: PartyInfo[] = JSON.parse(fs.readFileSync(cikPath, "utf-8"));
  const canMap = buildPartyNumToCanonical(canonical, cik, fromDate);
  const from = loadParliamentary(publicFolder, fromDate, canMap);
  const to = loadPresidential(publicFolder, cycle, round);
  const tickets = readTickets(publicFolder, cycle);

  // ── lanes ──────────────────────────────────────────────────────────────────
  const partyShare = (id: string) =>
    (from.totalByCanonical.get(id) ?? 0) / Math.max(1, from.totalVotes);
  const bigParties = [...from.totalByCanonical.keys()]
    .filter((id) => partyShare(id) >= PARTY_THRESHOLD)
    .sort((a, b) => partyShare(b) - partyShare(a));

  const ticketShare = (n: number) =>
    (to.totalByTicket.get(n) ?? 0) / Math.max(1, to.totalValid);
  // ⚠ A TICKET WITH NO NAME IS NOT A LANE. „№ 6 — 24%" names nobody a reader can check, the
  // same rule `build_neighborhoods` and `build_split_ticket` follow.
  const bigTickets = [...to.totalByTicket.keys()]
    .filter((n) => ticketShare(n) >= TICKET_THRESHOLD && tickets.has(n))
    .sort((a, b) => ticketShare(b) - ticketShare(a));

  // Pseudo-node presence is decided on the MATCHED sections only — the universe RAS balances.
  // A raw-total gate would use the wrong one and leave opposite-sign oblasts with no node.
  const parlFor = (s: PvrSection): ParlSection | undefined =>
    from.byCode.get(s.code) ??
    (s.obshtina
      ? from.byObshtina.get(s.obshtina)?.get(s.code.slice(2))
      : undefined);

  let useJoinedNode = false;
  let useExitedNode = false;
  {
    const reg = new Map<string, { f: number; t: number }>();
    for (const s of to.sections) {
      const twin = parlFor(s);
      if (!twin) continue;
      const e = reg.get(s.oblast) ?? { f: 0, t: 0 };
      // ⚠ THE SAME EFFECTIVE ROLL THE MARGINS ARE BUILT FROM. Probing on the raw registered
      // count would decide the JOINED/EXITED lanes against one roll and then balance the
      // margins against another — and the sections where the two differ are exactly the ones
      // that move a roll delta's sign.
      const parlVoted = twin.info.results.votes.reduce(
        (a, v) => a + (v.totalVotes ?? 0),
        0,
      );
      const pvrVoted =
        [...s.byTicket.values()].reduce((a, v) => a + v, 0) + s.noOne;
      e.f += effectiveRoll(twin.registered, parlVoted);
      e.t += effectiveRoll(s.registered, pvrVoted);
      reg.set(s.oblast, e);
    }
    for (const { f, t } of reg.values()) {
      if (t > f) useJoinedNode = true;
      if (f > t) useExitedNode = true;
    }
  }

  const ticketId = (n: number) => `pvr-${n}`;
  const fromIds: string[] = [...bigParties, PARL_OTHER_ID, ABSTAIN_ID];
  if (useJoinedNode) fromIds.push(JOINED_ID);
  const toIds: string[] = [...bigTickets.map(ticketId), PVR_OTHER_ID];
  // ⚠ ONLY WHERE THE BALLOT HAD THE OPTION. Before 2016 the form carried no „не подкрепям
  // никого", and an always-present lane would draw an empty node asserting a choice nobody
  // was offered.
  if (to.noOneTotal > 0) toIds.push(PVR_NONE_ID);
  toIds.push(ABSTAIN_ID);
  if (useExitedNode) toIds.push(EXITED_ID);

  const labels: ReconcileResult["labels"] = {};
  for (const id of bigParties) {
    const party = canonical.parties.find((p) => p.id === id);
    labels[id] = {
      bg: party?.displayName ?? id,
      en: party?.displayNameEn ?? party?.displayName ?? id,
      color: party?.color ?? "#888888",
    };
  }
  for (const n of bigTickets) {
    const t = tickets.get(n)!;
    // ⚠ THE BULGARIAN NAME IN BOTH LANGUAGES AND NEVER TRANSLITERATED — a reader is matching
    // it against a ballot. The presidential family's rule.
    labels[ticketId(n)] = {
      bg: t.president,
      en: t.president,
      color: t.color ?? "#888888",
    };
  }
  labels[PARL_OTHER_ID] = {
    bg: "Други партии (парламент)",
    en: "Other parties (parliament)",
    color: "#9ca3af",
  };
  labels[PVR_OTHER_ID] = {
    bg: "Други двойки",
    en: "Other pairs",
    color: "#94a3b8",
  };
  labels[PVR_NONE_ID] = {
    bg: "Не подкрепям никого",
    en: "I support no one",
    color: "#a8a29e",
  };
  labels[ABSTAIN_ID] = { ...ABSTAIN_LANE };
  labels[JOINED_ID] = {
    bg: "Нови в избирателните списъци",
    en: "Newly registered",
    color: "#86efac",
  };
  labels[EXITED_ID] = {
    bg: "Отпаднали от списъците",
    en: "Removed from rolls",
    color: "#fca5a5",
  };

  const idxFrom = new Map(fromIds.map((id, i) => [id, i]));
  const idxTo = new Map(toIds.map((id, i) => [id, i]));
  const bigTicketSet = new Set(bigTickets);
  const bigPartySet = new Set(bigParties);

  const parlVector = (sec: ParlSection) => {
    const abs = new Array<number>(fromIds.length).fill(0);
    let voted = 0;
    for (const v of sec.info.results.votes) {
      const can = canMap.get(v.partyNum);
      const target = can && bigPartySet.has(can) ? can : PARL_OTHER_ID;
      const i = idxFrom.get(target);
      const votes = v.totalVotes ?? 0;
      if (i !== undefined) abs[i] += votes;
      voted += votes;
    }
    const ia = idxFrom.get(ABSTAIN_ID);
    const roll = effectiveRoll(sec.registered, voted);
    if (ia !== undefined) abs[ia] = Math.max(0, roll - voted);
    return { vector: abs.map((x) => x / roll), absolute: abs, roll };
  };

  const pvrVector = (sec: PvrSection) => {
    const abs = new Array<number>(toIds.length).fill(0);
    let voted = 0;
    for (const [n, votes] of sec.byTicket) {
      const target = bigTicketSet.has(n) ? ticketId(n) : PVR_OTHER_ID;
      const i = idxTo.get(target);
      if (i !== undefined) abs[i] += votes;
      voted += votes;
    }
    const inone = idxTo.get(PVR_NONE_ID);
    if (inone !== undefined) abs[inone] += sec.noOne;
    voted += sec.noOne;
    const ia = idxTo.get(ABSTAIN_ID);
    const roll = effectiveRoll(sec.registered, voted);
    if (ia !== undefined) abs[ia] = Math.max(0, roll - voted);
    return { vector: abs.map((x) => x / roll), absolute: abs, roll };
  };

  const result: ReconcileResult = {
    fromIds,
    toIds,
    labels,
    byOblast: {},
    diagnostics: {
      sectionsMatched: 0,
      // ⚠ THE `_unplaced` SHARD COUNTS AS DROPPED. It is excluded from the estimate by
      // design, and a coverage figure that quietly omitted it would overstate the join.
      sectionsDropped: to.unplaced,
      totalRegisteredFrom: 0,
      totalRegisteredTo: 0,
    },
  };

  const byOblast = new Map<string, PvrSection[]>();
  for (const s of to.sections) {
    if (!byOblast.has(s.oblast)) byOblast.set(s.oblast, []);
    byOblast.get(s.oblast)!.push(s);
  }

  for (const [oblast, secs] of byOblast) {
    const sectionsOut: ReconcileResult["byOblast"][string]["sections"] = [];
    const fromTotals = new Array<number>(fromIds.length).fill(0);
    const toTotals = new Array<number>(toIds.length).fill(0);
    let regFrom = 0;
    let regTo = 0;
    let dropped = 0;

    for (const s of secs) {
      const twin = parlFor(s);
      if (!twin) {
        dropped += 1;
        continue;
      }
      const f = parlVector(twin);
      const t = pvrVector(s);
      sectionsOut.push({
        section: s.code,
        // ⚠ THE EFFECTIVE ROLL, the same denominator the share vectors were taken over — the
        // estimator weights each section by it, so a row divided by one number and weighted by
        // another is a row whose weight does not match its content.
        registeredFrom: f.roll,
        registeredTo: t.roll,
        from: f.vector,
        to: t.vector,
      });
      for (let i = 0; i < fromTotals.length; i += 1)
        fromTotals[i] += f.absolute[i];
      for (let i = 0; i < toTotals.length; i += 1) toTotals[i] += t.absolute[i];
      regFrom += f.roll;
      regTo += t.roll;
    }

    if (sectionsOut.length === 0) {
      result.diagnostics.sectionsDropped += dropped;
      continue;
    }

    // Rolls grew → JOINED on the from side, shrank → EXITED on the to side, from this
    // oblast's own matched-roll delta.
    const delta = regTo - regFrom;
    if (delta > 0) {
      const i = idxFrom.get(JOINED_ID);
      if (i !== undefined) fromTotals[i] += delta;
    } else if (delta < 0) {
      const i = idxTo.get(EXITED_ID);
      if (i !== undefined) toTotals[i] += -delta;
    }

    result.byOblast[oblast] = { sections: sectionsOut, fromTotals, toTotals };
    result.diagnostics.sectionsMatched += sectionsOut.length;
    result.diagnostics.sectionsDropped += dropped;
    result.diagnostics.totalRegisteredFrom += regFrom;
    result.diagnostics.totalRegisteredTo += regTo;
  }

  return result;
};
