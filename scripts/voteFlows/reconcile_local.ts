// Section + party reconciliation between two consecutive LOCAL-election
// cycles (общински избори). Local analogue of reconcile.ts — it produces the
// exact same `ReconcileResult` shape so the parliamentary estimator
// (estimateOblast) and serializer (buildVoteFlowScopeFiles) can be reused
// verbatim. Only the *input* differs:
//
//   parliamentary: <date>/sections/by-oblast/<oblast>.json  (SectionInfo map)
//   local:         <cycle>/sections/<obshtinaCode>.json     (LocalSectionShard)
//
// Two things make the local input fundamentally different from parliamentary:
//
//  1. Party numbering is PER-MUNICÍPIO. `localPartyNum` 7 is ГЕРБ in one
//     obshtina and something else in the next, so the canonical id MUST be
//     resolved through each shard's own `parties[]` legend — never a global
//     partyNum→canonical map. This is the #1 correctness trap.
//
//  2. Many ballot lines are genuinely-local formations with no parliamentary
//     canonical id (`primaryCanonicalId: null`). Per the product decision we
//     fold every non-canonical line — plus canonical parties below the
//     national threshold — into a single `__local_other` bucket so the
//     Sankey conserves the electorate. It's heterogeneous, so it's a pseudo
//     node (double-underscore) and is excluded from the loyalty/persistence
//     stats, same as the parliamentary __small_all bucket.
//
// We estimate flows at national + oblast scope only. The oblast key is the
// 3-letter prefix of the município's obshtinaCode (BGS, SOF, …) so the scope
// files line up 1:1 with the region rollups (data/<cycle>/region/<oblast>.json)
// the region dashboard already fetches. A município has only 30–50 sections —
// too few for stable ecological inference — so per-município flows are
// intentionally NOT produced; the per-município page shows raw before/after
// deltas instead. See VoteFlowMethodologyScreen.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { LocalSectionShard } from "../parsers_local/types";
import { ABSTAIN_ID, EXITED_ID, JOINED_ID, ReconcileResult } from "./reconcile";

/** Heterogeneous bucket: every ballot line with no parliamentary canonical
 * id, plus canonical parties below the national share threshold. Pseudo
 * (double-underscore) so it's excluded from persistence/loyalty. */
export const LOCAL_OTHER_ID = "__local_other";

// A canonical party gets its own Sankey lane only when it clears this share
// of national council votes in either cycle. Local elections have a very
// long tail of single-município lists; without this the matrix would have
// hundreds of columns.
const SMALL_PARTY_THRESHOLD = 0.01; // 1%

type LocalSection = {
  /** Council votes by destination id (canonical id or LOCAL_OTHER_ID). */
  votesById: Map<string, number>;
  registered: number;
  /** 3-letter oblast code (obshtinaCode prefix) — the scope grouping key. */
  oblast: string;
};

/** Load every município section shard for a cycle and flatten to a single
 * map keyed by 9-digit section code, resolving each ballot line to a
 * destination id via that shard's own legend. */
const loadCycleSections = (
  publicFolder: string,
  cycle: string,
): {
  sections: Map<string, LocalSection>;
  totalByCanonical: Map<string, number>; // excludes LOCAL_OTHER
  totalCouncilVotes: number; // includes LOCAL_OTHER
  totalRegistered: number;
} => {
  const dir = path.join(publicFolder, cycle, "sections");
  const sections = new Map<string, LocalSection>();
  const totalByCanonical = new Map<string, number>();
  let totalCouncilVotes = 0;
  let totalRegistered = 0;
  if (!fs.existsSync(dir)) {
    return { sections, totalByCanonical, totalCouncilVotes, totalRegistered };
  }
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const shard: LocalSectionShard = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf-8"),
    );
    // Per-shard legend: localPartyNum → canonical id (null → local_other).
    const legend = new Map<number, string>();
    for (const p of shard.parties) {
      legend.set(p.localPartyNum, p.primaryCanonicalId ?? LOCAL_OTHER_ID);
    }
    const oblast = shard.obshtinaCode.slice(0, 3);
    for (const sec of shard.sections) {
      // Section codes are unique across shards within a cycle; район shards
      // carry no sections (SOF holds Sofia's), so there's nothing to dedup,
      // but Map.set keeps us safe if that ever changes.
      const votesById = new Map<string, number>();
      for (const pv of sec.partyVotes) {
        const dest = legend.get(pv.localPartyNum) ?? LOCAL_OTHER_ID;
        votesById.set(dest, (votesById.get(dest) ?? 0) + pv.votes);
        if (dest !== LOCAL_OTHER_ID) {
          totalByCanonical.set(
            dest,
            (totalByCanonical.get(dest) ?? 0) + pv.votes,
          );
        }
        totalCouncilVotes += pv.votes;
      }
      const registered = sec.numRegisteredVoters ?? 0;
      totalRegistered += registered;
      sections.set(sec.sectionCode, { votesById, registered, oblast });
    }
  }
  return { sections, totalByCanonical, totalCouncilVotes, totalRegistered };
};

export const reconcileLocalCycles = ({
  publicFolder,
  fromCycle,
  toCycle,
  canonical,
}: {
  publicFolder: string;
  fromCycle: string;
  toCycle: string;
  canonical: CanonicalPartiesIndex;
}): ReconcileResult => {
  const from = loadCycleSections(publicFolder, fromCycle);
  const to = loadCycleSections(publicFolder, toCycle);

  // Decide which canonical ids clear the national threshold in either cycle
  // and so earn their own Sankey lane. Everything else collapses into
  // __local_other alongside the genuinely-local lists.
  const allCanonicals = new Set<string>([
    ...from.totalByCanonical.keys(),
    ...to.totalByCanonical.keys(),
  ]);
  const combinedShare = (id: string): number =>
    (from.totalByCanonical.get(id) ?? 0) / Math.max(1, from.totalCouncilVotes) +
    (to.totalByCanonical.get(id) ?? 0) / Math.max(1, to.totalCouncilVotes);
  const bigCanonicals = new Set<string>();
  for (const id of allCanonicals) {
    const fromShare =
      (from.totalByCanonical.get(id) ?? 0) /
      Math.max(1, from.totalCouncilVotes);
    const toShare =
      (to.totalByCanonical.get(id) ?? 0) / Math.max(1, to.totalCouncilVotes);
    if (
      fromShare >= SMALL_PARTY_THRESHOLD ||
      toShare >= SMALL_PARTY_THRESHOLD
    ) {
      bigCanonicals.add(id);
    }
  }
  // Order big parties by decreasing combined share so the Sankey lays out the
  // biggest first.
  const orderedBig = Array.from(bigCanonicals).sort(
    (a, b) => combinedShare(b) - combinedShare(a),
  );

  // Rolls grew → from-side needs a JOINED placeholder; shrank → to-side needs
  // EXITED. Either way both sides total max(regFrom, regTo).
  const useJoinedNode = to.totalRegistered > from.totalRegistered;
  const useExitedNode = from.totalRegistered > to.totalRegistered;

  const fromIds: string[] = [...orderedBig, LOCAL_OTHER_ID, ABSTAIN_ID];
  if (useJoinedNode) fromIds.push(JOINED_ID);
  const toIds: string[] = [...orderedBig, LOCAL_OTHER_ID, ABSTAIN_ID];
  if (useExitedNode) toIds.push(EXITED_ID);

  const labels: ReconcileResult["labels"] = {};
  for (const id of orderedBig) {
    const party = canonical.parties.find((p) => p.id === id);
    labels[id] = {
      bg: party?.displayName ?? id,
      en: party?.displayNameEn ?? party?.displayName ?? id,
      color: party?.color ?? "#888888",
    };
  }
  labels[LOCAL_OTHER_ID] = {
    bg: "Местни и други партии",
    en: "Local & other parties",
    color: "#94a3b8", // slate-400
  };
  labels[ABSTAIN_ID] = {
    bg: "Не гласували",
    en: "Did not vote",
    color: "#cbd5e1", // slate-300
  };
  labels[JOINED_ID] = {
    bg: "Нови в избирателните списъци",
    en: "Newly registered",
    color: "#86efac", // green-300
  };
  labels[EXITED_ID] = {
    bg: "Отпаднали от списъците",
    en: "Removed from rolls",
    color: "#fca5a5", // red-300
  };

  const idIndexFrom = new Map<string, number>();
  fromIds.forEach((id, i) => idIndexFrom.set(id, i));
  const idIndexTo = new Map<string, number>();
  toIds.forEach((id, i) => idIndexTo.set(id, i));

  // Share vector for one section over its registered-voter pool. Council
  // votes for a non-big canonical id (or null) land in __local_other.
  // abstain = registered − valid council votes (folds invalid + mayor-only
  // ballots into abstain, keeping mass conservation tight for RAS).
  const sectionShare = (
    sec: LocalSection,
    ids: string[],
    idIndex: Map<string, number>,
  ): { vector: number[]; registered: number; absolute: number[] } => {
    const reg = sec.registered;
    const abs = new Array<number>(ids.length).fill(0);
    let voted = 0;
    for (const [dest, votes] of sec.votesById) {
      const target =
        dest === LOCAL_OTHER_ID || bigCanonicals.has(dest)
          ? dest
          : LOCAL_OTHER_ID;
      const idx = idIndex.get(target);
      if (idx !== undefined) abs[idx] += votes;
      voted += votes;
    }
    const abstain = Math.max(0, reg - voted);
    const idxAbs = idIndex.get(ABSTAIN_ID);
    if (idxAbs !== undefined) abs[idxAbs] = abstain;
    const total = Math.max(1, reg);
    return {
      vector: abs.map((x) => x / total),
      registered: reg,
      absolute: abs,
    };
  };

  const result: ReconcileResult = {
    fromIds,
    toIds,
    labels,
    byOblast: {},
    diagnostics: {
      sectionsMatched: 0,
      sectionsDropped: 0,
      totalRegisteredFrom: 0,
      totalRegisteredTo: 0,
    },
  };

  // Oblast = 3-letter obshtinaCode prefix (BGS, SOF, …).
  const oblasts = new Set<string>();
  for (const s of from.sections.values()) oblasts.add(s.oblast);
  for (const s of to.sections.values()) oblasts.add(s.oblast);

  for (const oblast of oblasts) {
    const sectionsOut: ReconcileResult["byOblast"][string]["sections"] = [];
    const fromTotals = new Array<number>(fromIds.length).fill(0);
    const toTotals = new Array<number>(toIds.length).fill(0);
    let oblastRegFrom = 0;
    let oblastRegTo = 0;
    let dropped = 0;

    for (const [sid, fromSec] of from.sections) {
      if (fromSec.oblast !== oblast) continue;
      const toSec = to.sections.get(sid);
      if (!toSec) {
        dropped += 1;
        continue;
      }
      const fromS = sectionShare(fromSec, fromIds, idIndexFrom);
      const toS = sectionShare(toSec, toIds, idIndexTo);
      sectionsOut.push({
        section: sid,
        registeredFrom: fromS.registered,
        registeredTo: toS.registered,
        from: fromS.vector,
        to: toS.vector,
      });
      for (let i = 0; i < fromTotals.length; i += 1)
        fromTotals[i] += fromS.absolute[i];
      for (let i = 0; i < toTotals.length; i += 1)
        toTotals[i] += toS.absolute[i];
      oblastRegFrom += fromS.registered;
      oblastRegTo += toS.registered;
    }
    // Sections that vanished from the from cycle also count as dropped.
    for (const [sid, toSec] of to.sections) {
      if (toSec.oblast !== oblast) continue;
      if (!from.sections.has(sid)) dropped += 1;
    }

    if (sectionsOut.length === 0) {
      result.diagnostics.sectionsDropped += dropped;
      continue;
    }

    // Inject the JOINED / EXITED pseudo mass from the registered-voter delta
    // so both sides total max(regFrom, regTo) per oblast.
    const regDelta = oblastRegTo - oblastRegFrom;
    if (regDelta > 0 && useJoinedNode) {
      const idx = idIndexFrom.get(JOINED_ID);
      if (idx !== undefined) fromTotals[idx] += regDelta;
    } else if (regDelta < 0 && useExitedNode) {
      const idx = idIndexTo.get(EXITED_ID);
      if (idx !== undefined) toTotals[idx] += -regDelta;
    }

    result.byOblast[oblast] = { sections: sectionsOut, fromTotals, toTotals };
    result.diagnostics.sectionsMatched += sectionsOut.length;
    result.diagnostics.sectionsDropped += dropped;
    result.diagnostics.totalRegisteredFrom += oblastRegFrom;
    result.diagnostics.totalRegisteredTo += oblastRegTo;
  }

  return result;
};
