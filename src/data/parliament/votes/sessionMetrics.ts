import type {
  SessionFile,
  SessionItem,
  VoteValue,
} from "@/data/parliament/votes/types";
import { majorityFor } from "@/data/parliament/votes/majority";
import { foldedParties, groupLabeller } from "@/data/parliament/votes/groups";

export interface PartyTally {
  party: string;
  yes: number;
  no: number;
  abstain: number;
  absent: number;
}

export interface ItemMetrics {
  item: SessionItem;
  // Sorted by total members desc.
  partyTallies: PartyTally[];
  majorityByParty: Map<string, VoteValue | null>;
  dissenters: {
    mpId: number;
    party: string;
    vote: Exclude<VoteValue, "absent">;
    majority: VoteValue;
  }[];
  // |yes - (no + abstain)| in absolute MP-count units. Smaller = closer.
  marginAbs: number;
  // Weighted mean cohesion across parties with ≥3 voting members on this item.
  // null when no party qualifies (third-party splinters with 1-2 voting MPs).
  cohesion: number | null;
}

export interface SessionMetrics {
  perItem: ItemMetrics[];
  // Session-wide aggregates over cast items only.
  cohesion: number | null;
  dissentCount: number;
  closestItem: { itemNo: number; marginAbs: number } | null;
  // Turnout = average across items of (yes + no + abstain) / (yes + no + abstain + absent).
  turnoutPct: number;
}

const COHESION_MIN_PARTY_SIZE = 3;

const castCount = (item: SessionItem): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

export const computeSessionMetrics = (session: SessionFile): SessionMetrics => {
  const mpParty = session.mpParty ?? {};
  // Bucket by canonical group key, publish the day's own spelling. `party` on every field
  // this returns — PartyTally, the majorityByParty keys, each dissenter — is the LABEL, so
  // a consumer only ever handles one form. Only majorityFor sees the key.
  const parties = foldedParties(mpParty);
  const labelOf = groupLabeller(mpParty);
  const castItems = session.sessions.filter((it) => castCount(it) > 0);
  const perItem: ItemMetrics[] = [];

  let cohesionSum = 0;
  let cohesionWeight = 0;
  let dissentCount = 0;
  let closestItem: { itemNo: number; marginAbs: number } | null = null;
  let turnoutSum = 0;

  for (const item of castItems) {
    const byParty = new Map<string, PartyTally>();
    for (const v of item.votes) {
      const key = parties[String(v.mpId)] ?? "—";
      const row =
        byParty.get(key) ??
        ({
          party: labelOf(key),
          yes: 0,
          no: 0,
          abstain: 0,
          absent: 0,
        } as PartyTally);
      row[v.vote]++;
      byParty.set(key, row);
    }
    const partyTallies = [...byParty.values()].sort(
      (a, b) =>
        b.yes +
        b.no +
        b.abstain +
        b.absent -
        (a.yes + a.no + a.abstain + a.absent),
    );

    const majorityByParty = new Map<string, VoteValue | null>();
    for (const [key, t] of byParty) {
      majorityByParty.set(t.party, majorityFor(item, key, parties));
    }

    const dissenters: ItemMetrics["dissenters"] = [];
    for (const v of item.votes) {
      if (v.vote === "absent") continue;
      const key = parties[String(v.mpId)];
      if (!key) continue;
      const party = labelOf(key);
      const maj = majorityByParty.get(party);
      if (!maj) continue;
      if (v.vote !== maj) {
        dissenters.push({
          mpId: v.mpId,
          party,
          vote: v.vote as Exclude<VoteValue, "absent">,
          majority: maj,
        });
      }
    }
    dissentCount += dissenters.length;

    const cast = item.tallies.yes + item.tallies.no + item.tallies.abstain;
    const losingSide = item.tallies.no + item.tallies.abstain;
    const marginAbs = Math.abs(item.tallies.yes - losingSide);
    if (closestItem == null || marginAbs < closestItem.marginAbs) {
      closestItem = { itemNo: item.item, marginAbs };
    }

    let itemCohesionSum = 0;
    let itemCohesionWeight = 0;
    for (const t of partyTallies) {
      const partyCast = t.yes + t.no + t.abstain;
      if (partyCast < COHESION_MIN_PARTY_SIZE) continue;
      const top = Math.max(t.yes, t.no, t.abstain);
      const c = top / partyCast;
      itemCohesionSum += c * partyCast;
      itemCohesionWeight += partyCast;
    }
    const cohesion =
      itemCohesionWeight > 0 ? itemCohesionSum / itemCohesionWeight : null;
    if (cohesion != null) {
      cohesionSum += cohesion * itemCohesionWeight;
      cohesionWeight += itemCohesionWeight;
    }

    const total = cast + item.tallies.absent;
    turnoutSum += total === 0 ? 0 : cast / total;

    perItem.push({
      item,
      partyTallies,
      majorityByParty,
      dissenters,
      marginAbs,
      cohesion,
    });
  }

  return {
    perItem,
    cohesion: cohesionWeight > 0 ? cohesionSum / cohesionWeight : null,
    dissentCount,
    closestItem,
    turnoutPct: castItems.length > 0 ? turnoutSum / castItems.length : 0,
  };
};
