// Section + party reconciliation between two consecutive elections.
// Produces, for each section that exists in both cycles, the share vector
// of voter "destinations" relative to the registered-voter pool, on both
// the from-cycle and to-cycle sides. Shares always sum to 1.
//
// The destination categories are:
//   - one entry per canonical party that appears with non-trivial votes
//     in either cycle (plus a small-parties bucket — see grouping below)
//   - "abstain": registered voters who didn't vote (both sides)
//   - "joined" (from-side only): people who weren't on T's rolls but
//     appear on T+1's. Source-side placeholder for the new electorate.
//     Sized per изборен район from the matched-section roll delta, so it
//     carries mass in every район whose rolls grew.
//   - "exited" (to-side only): mirror image — people who were on T's
//     rolls but not on T+1's. Carries mass in every район whose rolls
//     shrank.
//
// Within one район only one of the two carries mass (the roll delta is
// net), but nationally both nodes can appear because райони move in
// different directions. With these pseudo-nodes both sides total
// max(regFrom, regTo) per район, so RAS scaling has a balanced
// row/column-sum target.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { PartyInfo, SectionInfo } from "@/data/dataTypes";

export const ABSTAIN_ID = "__abstain__";
/** From-side pseudo: people who'll join T+1's rolls but weren't on T's. */
export const JOINED_ID = "__joined__";
/** To-side pseudo: people who left T's rolls before T+1. */
export const EXITED_ID = "__exited__";
export const SMALL_ID_PREFIX = "__small_";

// Parties below this national share in *both* cycles get bucketed into the
// "small parties" lane. Keeps the matrix to ~10–14 columns per side.
const SMALL_PARTY_THRESHOLD = 0.01; // 1%

export type ReconcileResult = {
  /** Canonical-id node list for the from cycle (parties + abstain + removed
   * + small-bucket if needed). Order is stable across the file. */
  fromIds: string[];
  /** Canonical-id node list for the to cycle (parties + abstain + added
   * + small-bucket). */
  toIds: string[];
  /** Friendly labels (Bulgarian + English) keyed by node id. Both sides
   * share this map. */
  labels: Record<string, { bg: string; en: string; color: string }>;
  /** Per-oblast → array of section share rows. Each entry has parallel
   * `from` and `to` share vectors aligned to fromIds/toIds. */
  byOblast: Record<
    string,
    {
      sections: Array<{
        section: string;
        registeredFrom: number;
        registeredTo: number;
        from: number[]; // shares summing to 1 (over fromIds)
        to: number[]; // shares summing to 1 (over toIds)
      }>;
      /** Aggregate vote totals (in absolute votes, not shares) on both
       * cycles, used for the row/col sums in RAS scaling and for the
       * Sankey node sizes. Indexed by fromIds / toIds order. */
      fromTotals: number[];
      toTotals: number[];
    }
  >;
  diagnostics: {
    sectionsMatched: number;
    sectionsDropped: number;
    totalRegisteredFrom: number;
    totalRegisteredTo: number;
  };
};

export const buildPartyNumToCanonical = (
  canonical: CanonicalPartiesIndex,
  cikParties: PartyInfo[],
  election: string,
): Map<number, string> => {
  // Each canonical lineage stores its (election, partyNum) history, so the
  // direct lookup is canonical → (election → partyNum). Invert to a partyNum
  // → canonicalId map for the requested election. Falls back to nickName
  // lookup when the lineage history doesn't list this election (occasional
  // for tiny-vote parties skipped during canonical generation).
  const out = new Map<number, string>();
  for (const party of canonical.parties) {
    for (const h of party.history) {
      if (h.election === election) out.set(h.partyNum, party.id);
    }
  }
  for (const cik of cikParties) {
    if (out.has(cik.number)) continue;
    const id = canonical.byNickName[cik.nickName];
    if (id) out.set(cik.number, id);
  }
  return out;
};

export const reconcileCycles = ({
  publicFolder,
  fromDate,
  toDate,
  canonical,
}: {
  publicFolder: string;
  fromDate: string;
  toDate: string;
  canonical: CanonicalPartiesIndex;
}): ReconcileResult => {
  const fromCikPath = path.join(publicFolder, fromDate, "cik_parties.json");
  const toCikPath = path.join(publicFolder, toDate, "cik_parties.json");
  const fromCik: PartyInfo[] = JSON.parse(
    fs.readFileSync(fromCikPath, "utf-8"),
  );
  const toCik: PartyInfo[] = JSON.parse(fs.readFileSync(toCikPath, "utf-8"));
  const fromMap = buildPartyNumToCanonical(canonical, fromCik, fromDate);
  const toMap = buildPartyNumToCanonical(canonical, toCik, toDate);

  // First pass: load every section file from both cycles, accumulate per-
  // canonical totals, decide which canonical ids cross the small-party
  // threshold (and so get their own node).
  const fromTotalByCan = new Map<string, number>();
  const toTotalByCan = new Map<string, number>();
  const fromSections = new Map<string, SectionInfo>(); // by section id
  const toSections = new Map<string, SectionInfo>();
  const oblastsFrom = new Set<string>();
  const oblastsTo = new Set<string>();

  const loadCycleSections = (
    date: string,
    sectionMap: Map<string, SectionInfo>,
    totalMap: Map<string, number>,
    canMap: Map<number, string>,
    oblastSet: Set<string>,
  ) => {
    const dir = path.join(publicFolder, date, "sections", "by-oblast");
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const oblast = file.replace(/\.json$/, "");
      oblastSet.add(oblast);
      const obj: Record<string, SectionInfo> = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf-8"),
      );
      for (const [sid, info] of Object.entries(obj)) {
        sectionMap.set(sid, info);
        for (const v of info.results.votes) {
          const can = canMap.get(v.partyNum);
          if (!can) continue;
          totalMap.set(can, (totalMap.get(can) ?? 0) + (v.totalVotes ?? 0));
        }
      }
    }
  };

  loadCycleSections(
    fromDate,
    fromSections,
    fromTotalByCan,
    fromMap,
    oblastsFrom,
  );
  loadCycleSections(toDate, toSections, toTotalByCan, toMap, oblastsTo);
  // Abroad sections (oblast 32) are excluded: their section IDs are
  // re-issued every cycle (mobile diplomatic posts, ad-hoc venues), so
  // section-level joining is meaningless here and the resulting matrix is
  // dominated by RAS scaling artefacts. The methodology page calls this
  // out — abroad voters appear in the per-oblast UI as "no estimate".
  oblastsFrom.delete("32");
  oblastsTo.delete("32");

  const totalFromVotes = Array.from(fromTotalByCan.values()).reduce(
    (s, n) => s + n,
    0,
  );
  const totalToVotes = Array.from(toTotalByCan.values()).reduce(
    (s, n) => s + n,
    0,
  );

  // A canonical id gets its own node when it clears the threshold in either
  // cycle. Everything else collapses into the "small" bucket — single bucket
  // shared by both sides.
  const allCanonicals = new Set<string>([
    ...fromTotalByCan.keys(),
    ...toTotalByCan.keys(),
  ]);
  const bigCanonicals = new Set<string>();
  for (const id of allCanonicals) {
    const fromShare =
      (fromTotalByCan.get(id) ?? 0) / Math.max(1, totalFromVotes);
    const toShare = (toTotalByCan.get(id) ?? 0) / Math.max(1, totalToVotes);
    if (
      fromShare >= SMALL_PARTY_THRESHOLD ||
      toShare >= SMALL_PARTY_THRESHOLD
    ) {
      bigCanonicals.add(id);
    }
  }
  // Order: by decreasing combined share so the Sankey lays out the biggest
  // parties first.
  const orderedBig = Array.from(bigCanonicals).sort((a, b) => {
    const sa =
      (fromTotalByCan.get(a) ?? 0) / Math.max(1, totalFromVotes) +
      (toTotalByCan.get(a) ?? 0) / Math.max(1, totalToVotes);
    const sb =
      (fromTotalByCan.get(b) ?? 0) / Math.max(1, totalFromVotes) +
      (toTotalByCan.get(b) ?? 0) / Math.max(1, totalToVotes);
    return sb - sa;
  });

  // Which pseudo-nodes are needed? Decided per изборен район on the
  // matched sections only — the same universe RAS balances. A район whose
  // rolls grew needs JOINED mass on the from side; one whose rolls shrank
  // needs EXITED mass on the to side. The previous national either/or gate
  // on raw roll totals used the wrong universe (abroad + unmatched
  // sections flipped its direction on 5 of 12 cycle pairs) and left
  // opposite-sign райони with no pseudo-node at all, silently smearing
  // their roll change across all parties in the RAS pre-scale.
  let useJoinedNode = false;
  let useExitedNode = false;
  {
    const regByOblast = new Map<string, { f: number; t: number }>();
    for (const [sid, fromInfo] of fromSections) {
      const oblast = sid.slice(0, 2);
      if (oblast === "32") continue;
      const toInfo = toSections.get(sid);
      if (!toInfo) continue;
      const e = regByOblast.get(oblast) ?? { f: 0, t: 0 };
      e.f += fromInfo.results.protocol?.numRegisteredVoters ?? 0;
      e.t += toInfo.results.protocol?.numRegisteredVoters ?? 0;
      regByOblast.set(oblast, e);
    }
    for (const { f, t } of regByOblast.values()) {
      if (t > f) useJoinedNode = true;
      if (f > t) useExitedNode = true;
    }
  }

  const SMALL_ID = SMALL_ID_PREFIX + "all";
  const fromIds: string[] = [...orderedBig, SMALL_ID, ABSTAIN_ID];
  if (useJoinedNode) fromIds.push(JOINED_ID);
  const toIds: string[] = [...orderedBig, SMALL_ID, ABSTAIN_ID];
  if (useExitedNode) toIds.push(EXITED_ID);

  // Build label/color map.
  const labels: Record<string, { bg: string; en: string; color: string }> = {};
  for (const id of orderedBig) {
    const party = canonical.parties.find((p) => p.id === id);
    labels[id] = {
      bg: party?.displayName ?? id,
      en: party?.displayNameEn ?? party?.displayName ?? id,
      color: party?.color ?? "#888888",
    };
  }
  labels[SMALL_ID] = {
    bg: "Други партии",
    en: "Other parties",
    color: "#9ca3af", // gray-400
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

  // Helper: vote share vector for a section relative to its registered
  // voters. Includes abstain, small-bucket, and (per side) the appropriate
  // pseudo-node — last one is always 0 at section level since it's only
  // populated as an oblast-aggregate virtual section below.
  const idIndexFrom = new Map<string, number>();
  fromIds.forEach((id, i) => idIndexFrom.set(id, i));
  const idIndexTo = new Map<string, number>();
  toIds.forEach((id, i) => idIndexTo.set(id, i));

  const sectionShare = (
    info: SectionInfo,
    canMap: Map<number, string>,
    ids: string[],
    idIndex: Map<string, number>,
  ): { vector: number[]; registered: number; absolute: number[] } => {
    const reg = info.results.protocol?.numRegisteredVoters ?? 0;
    const abs = new Array<number>(ids.length).fill(0);
    let voted = 0;
    for (const v of info.results.votes) {
      const can = canMap.get(v.partyNum);
      const target = can && bigCanonicals.has(can) ? can : SMALL_ID;
      const idx = idIndex.get(target);
      if (idx !== undefined) abs[idx] += v.totalVotes ?? 0;
      voted += v.totalVotes ?? 0;
    }
    // Define abstain = registered − party-vote sum, so the section vector
    // sums to registered exactly. This folds invalid + "no one" ballots
    // into abstain alongside non-voters — defensible because none of them
    // cast a valid party preference, and it keeps mass conservation tight
    // (RAS converges to within 1e-8 instead of stalling at the
    // invalid-ballot leak rate of ~1-3% of turnout).
    const abstain = Math.max(0, reg - voted);
    const idxAbs = idIndex.get(ABSTAIN_ID);
    if (idxAbs !== undefined) abs[idxAbs] = abstain;
    const total = Math.max(1, reg);
    const vector = abs.map((x) => x / total);
    return { vector, registered: reg, absolute: abs };
  };

  // Per-oblast assembly. Section IDs that don't appear in both cycles are
  // dropped (and counted in diagnostics). Once we have the matched set we
  // compute the oblast totals — including the synthetic added/removed
  // pseudo-row from the registered-voter delta.
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

  const oblasts = new Set<string>([...oblastsFrom, ...oblastsTo]);
  for (const oblast of oblasts) {
    const sectionsOut: ReconcileResult["byOblast"][string]["sections"] = [];
    const fromTotals = new Array<number>(fromIds.length).fill(0);
    const toTotals = new Array<number>(toIds.length).fill(0);
    let oblastRegFrom = 0;
    let oblastRegTo = 0;
    let dropped = 0;

    for (const [sid, fromInfo] of fromSections) {
      if (sid.slice(0, 2) !== oblast) continue;
      const toInfo = toSections.get(sid);
      if (!toInfo) {
        dropped += 1;
        continue;
      }
      const fromS = sectionShare(fromInfo, fromMap, fromIds, idIndexFrom);
      const toS = sectionShare(toInfo, toMap, toIds, idIndexTo);
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
    // Also count to-sections that vanished from the from cycle.
    for (const [sid] of toSections) {
      if (sid.slice(0, 2) !== oblast) continue;
      if (!fromSections.has(sid)) dropped += 1;
    }

    if (sectionsOut.length === 0) {
      result.diagnostics.sectionsDropped += dropped;
      continue;
    }

    // Inject the JOINED / EXITED pseudo-node mass from this район's own
    // matched-roll delta: rolls grew → JOINED on the from side, rolls
    // shrank → EXITED on the to side. Either way both sides total
    // max(regFrom, regTo) for the район, so RAS gets balanced margins.
    const regDelta = oblastRegTo - oblastRegFrom;
    if (regDelta > 0) {
      const idx = idIndexFrom.get(JOINED_ID);
      if (idx !== undefined) fromTotals[idx] += regDelta;
    } else if (regDelta < 0) {
      const idx = idIndexTo.get(EXITED_ID);
      if (idx !== undefined) toTotals[idx] += -regDelta;
    }

    result.byOblast[oblast] = {
      sections: sectionsOut,
      fromTotals,
      toTotals,
    };
    result.diagnostics.sectionsMatched += sectionsOut.length;
    result.diagnostics.sectionsDropped += dropped;
    result.diagnostics.totalRegisteredFrom += oblastRegFrom;
    result.diagnostics.totalRegisteredTo += oblastRegTo;
  }

  return result;
};
