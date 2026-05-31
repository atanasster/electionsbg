// Cycle-level catalogue + national rollups.
//
// Two rollups per the locked-in design decisions:
//   1. councilVoteShare — sum of council R1 votes per canonical party,
//      using primary-party credit for coalitions. Mayoral votes are
//      excluded (per the decision: voters pick the person, not the party,
//      in mayor races).
//   2. mayorsByCanonical — count of elected município mayors per canonical
//      party (or the `independent` bucket).

import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { INDEPENDENT_CANONICAL_ID } from "./local_coalitions";
import { LocalElectionIndex, LocalMunicipalityBundle } from "./types";

const independentDisplayName = (
  canonical: CanonicalPartiesIndex | undefined,
): {
  displayName: string;
  color: string;
} => {
  const ind = canonical?.parties.find((p) => p.id === INDEPENDENT_CANONICAL_ID);
  return {
    displayName: ind?.displayName ?? "Независим",
    color: ind?.color ?? "#9CA3AF",
  };
};

export const displayMeta = (
  canonicalId: string | null,
  canonical: CanonicalPartiesIndex | undefined,
): { displayName: string; color: string } => {
  if (!canonicalId) {
    return { displayName: "Неразпознато", color: "#6B7280" };
  }
  if (canonicalId === INDEPENDENT_CANONICAL_ID) {
    return independentDisplayName(canonical);
  }
  const party = canonical?.parties.find((p) => p.id === canonicalId);
  return {
    displayName: party?.displayName ?? canonicalId,
    color: party?.color ?? "#9CA3AF",
  };
};

export const buildIndex = (opts: {
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  bundles: LocalMunicipalityBundle[];
  canonical: CanonicalPartiesIndex | undefined;
}): LocalElectionIndex => {
  const { cycle, round1Date, round2Date, bundles, canonical } = opts;

  const municipalities = bundles.map((b) => ({
    oikCode: b.oikCode,
    obshtinaCode: b.obshtinaCode,
    name: b.obshtinaName,
    oblast: b.oblastName,
    hadRound2: !!b.mayor.round2 && b.mayor.round2.length > 0,
  }));

  // Council vote share (R1 only, primary-party credit).
  // Bucketing rule:
  //   - If the party resolved to a canonical lineage → bucket by that id.
  //   - If it's an Инициативен комитет (isIndependent=true) → bucket as
  //     the catch-all `independent` (per the design decision).
  //   - Otherwise the party is a "local-only" party with no canonical
  //     lineage (e.g. ПП ДВИЖЕНИЕ ГЕРГЬОВДЕН, Граждани за Х) — bucket by
  //     a synthesised id derived from the local party name so it gets its
  //     own line in the rollup rather than being conflated with real
  //     independents.
  const localOnlyDisplay = new Map<string, string>();
  const totalsByCanonical = new Map<string, number>();
  let grandTotal = 0;
  for (const b of bundles) {
    // Skip Sofia район shards in the council rollup — they replicate the
    // city-wide council from SOF and would otherwise be counted 25×.
    if (/^S2\d{3}$/.test(b.obshtinaCode)) continue;
    for (const party of b.council) {
      let id: string;
      if (party.primaryCanonicalId) {
        id = party.primaryCanonicalId;
      } else if (party.isIndependent) {
        id = INDEPENDENT_CANONICAL_ID;
      } else {
        id = `local:${party.localPartyName.toLocaleLowerCase("bg")}`;
        if (!localOnlyDisplay.has(id))
          localOnlyDisplay.set(id, party.localPartyName);
      }
      totalsByCanonical.set(
        id,
        (totalsByCanonical.get(id) ?? 0) + party.totalVotes,
      );
      grandTotal += party.totalVotes;
    }
  }
  const councilVoteShare = Array.from(totalsByCanonical.entries())
    .map(([id, totalVotes]) => {
      const localName = localOnlyDisplay.get(id);
      const meta = localName
        ? { displayName: localName, color: "#9CA3AF" }
        : displayMeta(id, canonical);
      return {
        canonicalId: id,
        displayName: meta.displayName,
        color: meta.color,
        totalVotes,
        pctOfValid: grandTotal > 0 ? (totalVotes / grandTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalVotes - a.totalVotes);

  // Mayors won by canonical party (same local-bucket rule as council).
  const mayorLocalOnlyDisplay = new Map<string, string>();
  const mayorsByCanonical = new Map<string, number>();
  for (const b of bundles) {
    const elected = b.mayor.elected;
    if (!elected) continue;
    let id: string;
    if (elected.isIndependent) {
      id = INDEPENDENT_CANONICAL_ID;
    } else if (elected.primaryCanonicalId) {
      id = elected.primaryCanonicalId;
    } else {
      id = `local:${elected.localPartyName.toLocaleLowerCase("bg")}`;
      if (!mayorLocalOnlyDisplay.has(id))
        mayorLocalOnlyDisplay.set(id, elected.localPartyName);
    }
    mayorsByCanonical.set(id, (mayorsByCanonical.get(id) ?? 0) + 1);
  }
  const mayorsRollup = Array.from(mayorsByCanonical.entries())
    .map(([id, count]) => {
      const localName = mayorLocalOnlyDisplay.get(id);
      const meta = localName
        ? { displayName: localName, color: "#9CA3AF" }
        : displayMeta(id, canonical);
      return {
        canonicalId: id,
        displayName: meta.displayName,
        color: meta.color,
        count,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    cycle,
    round1Date,
    round2Date,
    municipalities,
    councilVoteShare,
    mayorsByCanonical: mayorsRollup,
  };
};
