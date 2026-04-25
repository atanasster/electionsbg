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

// Largest-remainder (Hare quota) allocation across a single national constituency.
// Bulgaria's actual allocation is per-MMR (31 districts), so this is an approximation
// useful for threshold what-if exploration, not for reproducing CEC numbers exactly.
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
  const qualifyingTotal = qualifying.reduce((s, r) => s + r.totalVotes, 0);
  if (!qualifyingTotal) return rows.sort((a, b) => b.totalVotes - a.totalVotes);

  const quota = qualifyingTotal / totalSeats;
  const remainders: { row: SeatRow; remainder: number }[] = [];
  let assigned = 0;
  qualifying.forEach((r) => {
    const exact = r.totalVotes / quota;
    const whole = Math.floor(exact);
    r.seats = whole;
    assigned += whole;
    remainders.push({ row: r, remainder: exact - whole });
  });

  const remaining = totalSeats - assigned;
  remainders
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining)
    .forEach(({ row }) => {
      row.seats += 1;
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
