// Shape a runoff-transfer matrix for the Sankey: candidates below 1% of round 1's ballots are
// grouped into one „Други двойки" node, and each candidate gets their own colour.
//
// ⚠ WHY GROUPING AND NOT A TABLE. 2011, 2016 and 2021 carry 20-26 round-1 nodes, past what a
// Sankey can label, so the chart used to fall back to a 23-row table of percentages. The
// parliamentary→presidential flow chart on the same page already answers that density by
// grouping candidates under 1% of the valid vote; this applies the same rule, so the two Sankeys
// beside each other read the same way. Nothing is dropped: the group's ribbons are the exact sum
// of its members' ribbons, so every column still totals what the estimate published.
//
// ⚠ THE COLOUR COMES FROM `tickets.json`. The producer writes a neutral grey on every ticket
// node; a candidate who is orange on the map and the ranking beside it must not be grey here.
// Pseudo nodes (не гласували, недействителни, не подкрепям никого) keep the producer's colour.

import type {
  VoteFlowEdge,
  VoteFlowMatrix,
  VoteFlowNode,
} from "@/data/voteFlows/voteFlowTypes";
import type { PresidentialTicket } from "./useTickets";

export const OTHER_TICKETS_ID = "__other_tickets__";

/** The share of round 1's ballots below which a candidate is grouped. */
export const MIN_TICKET_SHARE = 0.01;

const OTHER_COLOR = "#9ca3af";

/** `t17` → 17. The producer keys ticket nodes by ballot number. */
const ticketNumber = (id: string): number | undefined => {
  const m = /^t(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
};

const recolor = (
  n: VoteFlowNode,
  tickets: Map<number, PresidentialTicket>,
): VoteFlowNode => {
  const num = ticketNumber(n.id);
  const color = num !== undefined ? tickets.get(num)?.color : undefined;
  return color ? { ...n, color } : n;
};

/**
 * @param matrix - The estimate as published.
 * @param tickets - The cycle's tickets, for colours.
 * @param otherLabel - „Други двойки" in both languages.
 * @returns A matrix with at most one grouped round-1 node; unchanged when nothing falls below
 *   the threshold or only one candidate would be grouped (a group of one is just a rename).
 */
export const transferSankeyMatrix = (
  matrix: VoteFlowMatrix,
  tickets: Map<number, PresidentialTicket>,
  otherLabel: { bg: string; en: string },
): VoteFlowMatrix => {
  // The denominator is round 1's BALLOTS — every from-node except those who did not vote.
  const ballots = matrix.fromNodes
    .filter((n) => n.id !== "__abstain__")
    .reduce((a, n) => a + n.votes, 0);
  const small = new Set(
    matrix.fromNodes
      .filter(
        (n) =>
          !n.pseudo &&
          ticketNumber(n.id) !== undefined &&
          ballots > 0 &&
          n.votes / ballots < MIN_TICKET_SHARE,
      )
      .map((n) => n.id),
  );
  const toNodes = matrix.toNodes.map((n) => recolor(n, tickets));
  if (small.size < 2)
    return {
      ...matrix,
      fromNodes: matrix.fromNodes.map((n) => recolor(n, tickets)),
      toNodes,
    };

  const other: VoteFlowNode = {
    id: OTHER_TICKETS_ID,
    label: otherLabel.bg,
    labelEn: otherLabel.en,
    color: OTHER_COLOR,
    votes: matrix.fromNodes
      .filter((n) => small.has(n.id))
      .reduce((a, n) => a + n.votes, 0),
  };
  // The group sits after the named candidates and before the pseudo nodes.
  const kept = matrix.fromNodes
    .filter((n) => !small.has(n.id))
    .map((n) => recolor(n, tickets));
  const firstPseudo = kept.findIndex((n) => n.pseudo);
  const fromNodes =
    firstPseudo < 0
      ? [...kept, other]
      : [...kept.slice(0, firstPseudo), other, ...kept.slice(firstPseudo)];

  const merged = new Map<string, number>();
  const flows: VoteFlowEdge[] = [];
  for (const f of matrix.flows) {
    if (!small.has(f.from)) {
      flows.push(f);
      continue;
    }
    merged.set(f.to, (merged.get(f.to) ?? 0) + f.votes);
  }
  for (const [to, votes] of merged)
    flows.push({ from: OTHER_TICKETS_ID, to, votes });

  return { fromNodes, toNodes, flows };
};
