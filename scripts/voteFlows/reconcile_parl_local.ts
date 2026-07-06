// Cross-type reconciliation: the most recent PARLIAMENTARY vote before a local
// cycle (the "from") → that cycle's LOCAL COUNCIL vote (the "to"). Local
// elections almost always have a parliamentary vote between them, so this is
// the "where did the national-election voters go in the local council ballot"
// view requested for the pre-vote flow.
//
// Produces the same `ReconcileResult` shape as reconcile.ts / reconcile_local.ts
// so the estimator (estimateOblast: NNLS + RAS) and serializer
// (buildVoteFlowScopeFiles) are reused verbatim. Only the inputs differ:
//
//   from: parliamentary <date>/sections/by-oblast/<MIR>.json (SectionInfo map),
//         partyNum → canonical via that election's lineage (buildPartyNumToCanonical)
//   to:   local <cycle> council votes, read from the per-section DETAIL files
//         (full party vector, not the trimmed light index)
//
// SECTION JOIN. Parliamentary and local elections use DIFFERENT 9-digit
// section-code schemes in some regions (Sofia is split into МИР 23/24/25 in
// parliamentary but coded as one area locally; Plovdiv-city likewise), so a
// raw full-code join only covers ~54%. But both datasets agree on the
// município code (parl `SectionInfo.obshtina` == the local light-shard name —
// "S2401", "PDV22", "BGS01") and on the section code's last 7 digits (the
// station id). Joining on (obshtina, last-7) recovers 98.5% with zero
// collisions — the residual is genuinely new/removed stations, which drop and
// get RAS-rescaled, same as the same-type flows.
//
// The oblast grouping is the LOCAL 3-letter scope (BGS, SOF, PDV…), matching
// the local region dashboard, so the scope files line up with what the tile
// fetches. Sub-threshold / non-canonical lanes fold into a side-specific
// "other" pseudo node (__parl_other / __local_other), excluded from persistence.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { PartyInfo, SectionInfo } from "@/data/dataTypes";
import {
  ABSTAIN_ID,
  EXITED_ID,
  JOINED_ID,
  ReconcileResult,
  buildPartyNumToCanonical,
} from "./reconcile";
import { LOCAL_OTHER_ID } from "./reconcile_local";
import type {
  LocalSectionDetail,
  LocalSectionShard,
} from "../parsers_local/types";

/** From-side pseudo: national parties below the lane threshold (or with no
 *  canonical lineage). Distinct from __local_other so each side's "other" keeps
 *  its own label. */
export const PARL_OTHER_ID = "__parl_other";

const SMALL_PARTY_THRESHOLD = 0.01; // 1%
const SOFIA_RAYON_RE = /^S2\d{3}$/;

type ParlSection = { info: SectionInfo; registered: number };

/** Parliamentary sections indexed by (obshtina → last-7-digits → section), the
 *  scheme-independent join key, plus per-canonical totals for the threshold. */
const loadParliamentary = (
  publicFolder: string,
  date: string,
  canMap: Map<number, string>,
): {
  byObshtina: Map<string, Map<string, ParlSection>>;
  totalByCanonical: Map<string, number>;
  totalVotes: number;
  totalRegistered: number;
} => {
  const byObshtina = new Map<string, Map<string, ParlSection>>();
  const totalByCanonical = new Map<string, number>();
  let totalVotes = 0;
  let totalRegistered = 0;
  const dir = path.join(publicFolder, date, "sections", "by-oblast");
  if (!fs.existsSync(dir))
    return { byObshtina, totalByCanonical, totalVotes, totalRegistered };
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const obj: Record<string, SectionInfo> = JSON.parse(
      fs.readFileSync(path.join(dir, file), "utf-8"),
    );
    for (const [code, info] of Object.entries(obj)) {
      const ob = info.obshtina;
      if (!ob) continue; // abroad sections carry no obshtina — never match local
      const rest7 = code.slice(2);
      const registered = info.results.protocol?.numRegisteredVoters ?? 0;
      if (!byObshtina.has(ob)) byObshtina.set(ob, new Map());
      byObshtina.get(ob)!.set(rest7, { info, registered });
      totalRegistered += registered;
      for (const v of info.results.votes) {
        const votes = v.totalVotes ?? 0;
        totalVotes += votes;
        const can = canMap.get(v.partyNum);
        if (can)
          totalByCanonical.set(can, (totalByCanonical.get(can) ?? 0) + votes);
      }
    }
  }
  return { byObshtina, totalByCanonical, totalVotes, totalRegistered };
};

type LocalSection = {
  /** Município code = the light-shard name (matches parl SectionInfo.obshtina). */
  obshtina: string;
  /** 3-letter scope key (SOF, PDV, BGS…) for the flow's per-oblast files. */
  oblast: string;
  /** Section code last 7 digits — the join key within an obshtina. */
  rest7: string;
  /** Council votes by canonical id or LOCAL_OTHER_ID. */
  votesById: Map<string, number>;
  registered: number;
};

/** Load every local council section from the DETAIL files (full party vector),
 *  carrying the true obshtina (from the light shard) so the cross-type join can
 *  key on it. Sofia detail pools under SOF/, so detail dir ≠ obshtina there. */
const loadLocalCouncil = (
  publicFolder: string,
  cycle: string,
): {
  sections: LocalSection[];
  totalByCanonical: Map<string, number>;
  totalCouncilVotes: number;
  totalRegistered: number;
} => {
  const sections: LocalSection[] = [];
  const totalByCanonical = new Map<string, number>();
  let totalCouncilVotes = 0;
  let totalRegistered = 0;
  const sectionsDir = path.join(publicFolder, cycle, "sections");
  if (!fs.existsSync(sectionsDir))
    return { sections, totalByCanonical, totalCouncilVotes, totalRegistered };
  // Each top-level *.json is one obshtina's light shard (incl. the Sofia
  // per-район S2xxx shards). Skip the pooled SOF shard — its stations are
  // covered through the per-район shards (and carry no район identity).
  for (const file of fs.readdirSync(sectionsDir)) {
    if (!file.endsWith(".json")) continue;
    const obshtina = file.slice(0, -5);
    if (obshtina === "SOF") continue;
    const shard: LocalSectionShard = JSON.parse(
      fs.readFileSync(path.join(sectionsDir, file), "utf-8"),
    );
    const isSofia = SOFIA_RAYON_RE.test(obshtina);
    const detailDir = path.join(sectionsDir, isSofia ? "SOF" : obshtina);
    const oblast = isSofia ? "SOF" : obshtina.slice(0, 3);
    for (const lite of shard.sections) {
      const dp = path.join(detailDir, `${lite.sectionCode}.json`);
      if (!fs.existsSync(dp)) continue;
      const detail: LocalSectionDetail = JSON.parse(
        fs.readFileSync(dp, "utf-8"),
      );
      const legend = new Map<number, string>();
      for (const p of detail.parties)
        legend.set(p.localPartyNum, p.primaryCanonicalId ?? LOCAL_OTHER_ID);
      const votesById = new Map<string, number>();
      for (const pv of detail.section.partyVotes) {
        const dest = legend.get(pv.localPartyNum) ?? LOCAL_OTHER_ID;
        votesById.set(dest, (votesById.get(dest) ?? 0) + pv.votes);
        totalCouncilVotes += pv.votes;
        if (dest !== LOCAL_OTHER_ID)
          totalByCanonical.set(
            dest,
            (totalByCanonical.get(dest) ?? 0) + pv.votes,
          );
      }
      const registered = lite.numRegisteredVoters ?? 0;
      totalRegistered += registered;
      sections.push({
        obshtina,
        oblast,
        rest7: lite.sectionCode.slice(2),
        votesById,
        registered,
      });
    }
  }
  return { sections, totalByCanonical, totalCouncilVotes, totalRegistered };
};

export const reconcileParliamentaryToLocal = ({
  publicFolder,
  fromDate,
  toCycle,
  canonical,
}: {
  publicFolder: string;
  /** Parliamentary election folder, e.g. "2023_04_02". */
  fromDate: string;
  /** Local cycle folder, e.g. "2023_10_29_mi". */
  toCycle: string;
  canonical: CanonicalPartiesIndex;
}): ReconcileResult => {
  const cikPath = path.join(publicFolder, fromDate, "cik_parties.json");
  const cik: PartyInfo[] = JSON.parse(fs.readFileSync(cikPath, "utf-8"));
  const canMap = buildPartyNumToCanonical(canonical, cik, fromDate);
  const from = loadParliamentary(publicFolder, fromDate, canMap);
  const to = loadLocalCouncil(publicFolder, toCycle);

  // A canonical lane is its own node when it clears the threshold in either
  // side (parliamentary vote share OR local council share). Everyone else folds
  // into that side's "other" bucket.
  const allCanonicals = new Set<string>([
    ...from.totalByCanonical.keys(),
    ...to.totalByCanonical.keys(),
  ]);
  const fromShare = (id: string): number =>
    (from.totalByCanonical.get(id) ?? 0) / Math.max(1, from.totalVotes);
  const toShare = (id: string): number =>
    (to.totalByCanonical.get(id) ?? 0) / Math.max(1, to.totalCouncilVotes);
  const bigCanonicals = new Set<string>();
  for (const id of allCanonicals)
    if (
      fromShare(id) >= SMALL_PARTY_THRESHOLD ||
      toShare(id) >= SMALL_PARTY_THRESHOLD
    )
      bigCanonicals.add(id);
  const orderedBig = Array.from(bigCanonicals).sort(
    (a, b) => fromShare(b) + toShare(b) - (fromShare(a) + toShare(a)),
  );

  // Which pseudo-nodes are needed? Decided per oblast on the matched
  // sections only — the same universe RAS balances (see reconcile.ts).
  // A raw-total gate would use the wrong universe (unmatched sections)
  // and leave opposite-sign oblasts with no pseudo-node at all.
  let useJoinedNode = false;
  let useExitedNode = false;
  {
    const regByOblast = new Map<string, { f: number; t: number }>();
    for (const localSec of to.sections) {
      const parlSec = from.byObshtina
        .get(localSec.obshtina)
        ?.get(localSec.rest7);
      if (!parlSec) continue;
      const e = regByOblast.get(localSec.oblast) ?? { f: 0, t: 0 };
      e.f += parlSec.registered;
      e.t += localSec.registered;
      regByOblast.set(localSec.oblast, e);
    }
    for (const { f, t } of regByOblast.values()) {
      if (t > f) useJoinedNode = true;
      if (f > t) useExitedNode = true;
    }
  }

  const fromIds: string[] = [...orderedBig, PARL_OTHER_ID, ABSTAIN_ID];
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
  labels[PARL_OTHER_ID] = {
    bg: "Други партии (парламент)",
    en: "Other parties (parliament)",
    color: "#9ca3af", // gray-400
  };
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

  // From-side section share over its registered pool. Each parliamentary vote
  // lands in its big canonical lane, else __parl_other; abstain = reg − voted.
  const parlSectionShare = (
    sec: ParlSection,
  ): { vector: number[]; registered: number; absolute: number[] } => {
    const reg = sec.registered;
    const abs = new Array<number>(fromIds.length).fill(0);
    let voted = 0;
    for (const v of sec.info.results.votes) {
      const can = canMap.get(v.partyNum);
      const target = can && bigCanonicals.has(can) ? can : PARL_OTHER_ID;
      const idx = idIndexFrom.get(target);
      const votes = v.totalVotes ?? 0;
      if (idx !== undefined) abs[idx] += votes;
      voted += votes;
    }
    const idxAbs = idIndexFrom.get(ABSTAIN_ID);
    if (idxAbs !== undefined) abs[idxAbs] = Math.max(0, reg - voted);
    const total = Math.max(1, reg);
    return {
      vector: abs.map((x) => x / total),
      registered: reg,
      absolute: abs,
    };
  };

  // To-side section share. Council votes for a non-big canonical (or null) land
  // in __local_other; abstain = registered − valid council votes.
  const localSectionShare = (
    sec: LocalSection,
  ): { vector: number[]; registered: number; absolute: number[] } => {
    const reg = sec.registered;
    const abs = new Array<number>(toIds.length).fill(0);
    let voted = 0;
    for (const [dest, votes] of sec.votesById) {
      const target =
        dest === LOCAL_OTHER_ID || bigCanonicals.has(dest)
          ? dest
          : LOCAL_OTHER_ID;
      const idx = idIndexTo.get(target);
      if (idx !== undefined) abs[idx] += votes;
      voted += votes;
    }
    const idxAbs = idIndexTo.get(ABSTAIN_ID);
    if (idxAbs !== undefined) abs[idxAbs] = Math.max(0, reg - voted);
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

  // Group local sections by their 3-letter scope; match each to the
  // parliamentary section with the same (obshtina, last-7) key.
  const byOblast = new Map<string, LocalSection[]>();
  for (const s of to.sections) {
    if (!byOblast.has(s.oblast)) byOblast.set(s.oblast, []);
    byOblast.get(s.oblast)!.push(s);
  }

  for (const [oblast, localSecs] of byOblast) {
    const sectionsOut: ReconcileResult["byOblast"][string]["sections"] = [];
    const fromTotals = new Array<number>(fromIds.length).fill(0);
    const toTotals = new Array<number>(toIds.length).fill(0);
    let oblastRegFrom = 0;
    let oblastRegTo = 0;
    let dropped = 0;

    for (const localSec of localSecs) {
      const parlSec = from.byObshtina
        .get(localSec.obshtina)
        ?.get(localSec.rest7);
      if (!parlSec) {
        dropped += 1;
        continue;
      }
      const fromS = parlSectionShare(parlSec);
      const toS = localSectionShare(localSec);
      sectionsOut.push({
        section: `${localSec.obshtina}-${localSec.rest7}`,
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

    if (sectionsOut.length === 0) {
      result.diagnostics.sectionsDropped += dropped;
      continue;
    }

    // Rolls grew → JOINED on the from side, shrank → EXITED on the to
    // side, from this oblast's own matched-roll delta.
    const regDelta = oblastRegTo - oblastRegFrom;
    if (regDelta > 0) {
      const idx = idIndexFrom.get(JOINED_ID);
      if (idx !== undefined) fromTotals[idx] += regDelta;
    } else if (regDelta < 0) {
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
