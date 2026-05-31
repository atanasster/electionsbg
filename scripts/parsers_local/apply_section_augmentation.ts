// Apply the section aggregation to the HTML-built município bundles.
//
// Two effects per bundle (when the CSV bundle covers its OIK):
//   1. Council backfill — set each council party's `totalVotes`/`pctOfValid`
//      from the summed section votes, and append parties that won votes but no
//      seats (the 2015 HTML summary lists only mandate-winners, so this both
//      fixes the all-zero `totalVotes` AND completes the vote-share picture).
//   2. Protocol override — replace the council-ballot turnout with the real
//      summed registered/actual/valid from protocols.txt + votes.txt.
//
// Plus a per-município section shard for data/<cycle>/sections/<obshtina>.json.

import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { displayMeta } from "./build_index_json";
import { SectionAggregation } from "./augment_sections";
import {
  LocalCouncilParty,
  LocalMunicipalityBundle,
  LocalSectionShard,
} from "./types";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Mutates `bundle.council` + `bundle.protocol` in place using the OIK's
 * section aggregation. No-op (returns false) when the aggregation doesn't
 * cover this OIK — so HTML-only cycles/municípios are left untouched.
 */
export const applyCouncilVotes = (
  bundle: LocalMunicipalityBundle,
  agg: SectionAggregation,
): boolean => {
  const oik = bundle.oikCode;
  const votesByParty = agg.councilVotesByOik.get(oik);
  if (!votesByParty || votesByParty.size === 0) return false;
  const validTotal = agg.validTotalByOik.get(oik) ?? 0;
  const legend = agg.partyLegendByOik.get(oik);
  const pct = (v: number) =>
    validTotal > 0 ? round2((v / validTotal) * 100) : 0;

  const seen = new Set<number>();
  for (const party of bundle.council) {
    const v = votesByParty.get(party.localPartyNum);
    if (v != null) {
      party.totalVotes = v;
      party.pctOfValid = pct(v);
    }
    seen.add(party.localPartyNum);
  }
  // Append vote-winning parties that the HTML didn't list (no seats won).
  for (const [num, v] of votesByParty.entries()) {
    if (seen.has(num)) continue;
    const leg = legend?.get(num);
    const extra: LocalCouncilParty = {
      localPartyNum: num,
      localPartyName: leg?.localPartyName ?? `№ ${num}`,
      primaryCanonicalId: leg?.primaryCanonicalId ?? null,
      memberCanonicalIds: leg?.memberCanonicalIds ?? [],
      isIndependent: leg?.isIndependent ?? false,
      totalVotes: v,
      pctOfValid: pct(v),
      mandatesWon: 0,
      candidates: [],
    };
    bundle.council.push(extra);
  }
  // Highest vote-getters first (mandate-winners naturally rise; the Мандати
  // column still distinguishes seat-holders from also-rans).
  bundle.council.sort((a, b) => b.totalVotes - a.totalVotes);

  const proto = agg.protocolByOik.get(oik);
  if (proto) {
    bundle.protocol = {
      numRegisteredVoters: proto.numRegisteredVoters,
      totalActualVoters: proto.totalActualVoters,
      numValidVotes: validTotal,
    };
  }
  return true;
};

/**
 * Build the per-município section shard from the OIK's section rows. Returns
 * null when the aggregation has no sections for this OIK.
 */
export const buildSectionShard = (
  bundle: LocalMunicipalityBundle,
  agg: SectionAggregation,
  canonical: CanonicalPartiesIndex | undefined,
): LocalSectionShard | null => {
  const oik = bundle.oikCode;
  const sections = agg.sectionsByOik.get(oik);
  if (!sections || sections.length === 0) return null;
  const legend = agg.partyLegendByOik.get(oik);
  // Only emit legend rows for parties that actually appear in a section.
  const partyNums = new Set<number>();
  for (const s of sections)
    for (const pv of s.partyVotes) partyNums.add(pv.localPartyNum);
  const parties = Array.from(partyNums)
    .sort((a, b) => a - b)
    .map((num) => {
      const leg = legend?.get(num);
      const meta = displayMeta(leg?.primaryCanonicalId ?? null, canonical);
      return {
        localPartyNum: num,
        localPartyName: leg?.localPartyName ?? `№ ${num}`,
        primaryCanonicalId: leg?.primaryCanonicalId ?? null,
        color: leg?.primaryCanonicalId ? meta.color : "#9CA3AF",
      };
    });
  return {
    cycle: bundle.cycle,
    obshtinaCode: bundle.obshtinaCode,
    oikCode: bundle.oikCode,
    obshtinaName: bundle.obshtinaName,
    parties,
    sections,
  };
};
