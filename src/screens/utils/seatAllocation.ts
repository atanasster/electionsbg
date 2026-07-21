import { PartySeats, StatsVote } from "@/data/dataTypes";

export const TOTAL_SEATS = 240;
export const MAJORITY_SEATS = 121;

export type SeatRow = {
  partyNum: number;
  nickName?: string;
  totalVotes: number;
  pct: number;
  seats: number;
  passedThreshold: boolean;
};

// Pure Hare (largest-remainder / Hare-Niemeyer) apportionment: distribute
// `seats` among `weights` in proportion to each weight, as whole numbers,
// then hand the leftover seats to the largest fractional remainders. Ties
// break by larger weight, then lower index, so the output is deterministic.
// Returns a seat count per input index (same length/order as `weights`).
//
// This is the arithmetic core of Bulgaria's seat allocation, exported on its
// own so the national allocator below, any per-district distribution, and
// offline scripts can all share one implementation.
export const hareQuota = (weights: number[], seats: number): number[] => {
  const out: number[] = new Array(weights.length).fill(0);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || seats <= 0) return out;
  const quota = total / seats;
  let assigned = 0;
  const remainders = weights.map((w, i) => {
    const exact = w / quota;
    const whole = Math.floor(exact);
    out[i] = whole;
    assigned += whole;
    return { i, remainder: exact - whole, weight: w };
  });
  remainders
    .sort(
      (a, b) => b.remainder - a.remainder || b.weight - a.weight || a.i - b.i,
    )
    .slice(0, seats - assigned)
    .forEach(({ i }) => {
      out[i] += 1;
    });
  return out;
};

// National largest-remainder (Hare-Niemeyer) allocation across a single
// constituency. Bulgaria fixes each party's *national* seat total exactly this
// way (then spreads those totals across the 31 districts, which does not change
// the national counts) — so this reproduces the official CEC totals for every
// election since 2013, and is also the right engine for threshold what-ifs.
export const allocateSeats = (
  votes: { partyNum: number; nickName?: string; totalVotes: number }[],
  thresholdPct: number,
  totalSeats: number = TOTAL_SEATS,
): SeatRow[] => {
  const totalAll = votes.reduce((s, v) => s + v.totalVotes, 0);
  const rows: SeatRow[] = votes.map((v) => {
    const pct = totalAll ? (100 * v.totalVotes) / totalAll : 0;
    return {
      partyNum: v.partyNum,
      nickName: v.nickName,
      totalVotes: v.totalVotes,
      pct,
      seats: 0,
      passedThreshold: pct >= thresholdPct,
    };
  });

  const qualifying = rows.filter((r) => r.passedThreshold);
  const seats = hareQuota(
    qualifying.map((r) => r.totalVotes),
    totalSeats,
  );
  qualifying.forEach((r, i) => {
    r.seats = seats[i];
  });

  return rows.sort((a, b) => b.totalVotes - a.totalVotes);
};

// Build SeatRow[] from official PartySeats, joined with vote counts so the table
// can show vote share alongside real seats.
export const buildOfficialRows = (
  seats: PartySeats[],
  votes: StatsVote[],
): SeatRow[] => {
  const totalAll = votes.reduce((s, v) => s + v.totalVotes, 0);
  const seatByPartyNum = new Map(seats.map((s) => [s.partyNum, s.seats]));
  const rows: SeatRow[] = votes.map((v) => {
    const pct = totalAll ? (100 * v.totalVotes) / totalAll : 0;
    const realSeats = seatByPartyNum.get(v.partyNum) ?? 0;
    return {
      partyNum: v.partyNum,
      nickName: v.nickName,
      totalVotes: v.totalVotes,
      pct,
      seats: realSeats,
      passedThreshold: realSeats > 0,
    };
  });
  return rows.sort((a, b) => b.seats - a.seats || b.totalVotes - a.totalVotes);
};

export type Coalition = {
  partyNums: number[];
  seats: number;
};

// Minimal winning coalitions: subsets that reach majority but where no proper
// subset already does. Bounded by maxSize so combinatorics stay tractable.
export const findMinimalCoalitions = (
  rows: SeatRow[],
  majority: number = MAJORITY_SEATS,
  maxSize: number = 4,
): Coalition[] => {
  const qualifying = rows
    .filter((r) => r.seats > 0)
    .sort((a, b) => b.seats - a.seats);
  const found: Coalition[] = [];

  const recurse = (start: number, current: number[], currentSeats: number) => {
    if (currentSeats >= majority) {
      if (current.length >= 1) {
        found.push({ partyNums: [...current], seats: currentSeats });
      }
      return;
    }
    if (current.length >= maxSize) return;
    for (let i = start; i < qualifying.length; i++) {
      current.push(qualifying[i].partyNum);
      recurse(i + 1, current, currentSeats + qualifying[i].seats);
      current.pop();
    }
  };
  recurse(0, [], 0);

  return found
    .sort(
      (a, b) => a.partyNums.length - b.partyNums.length || b.seats - a.seats,
    )
    .slice(0, 12);
};
