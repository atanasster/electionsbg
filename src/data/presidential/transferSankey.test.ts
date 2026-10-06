// The runoff Sankey's grouping rule: candidates under 1% of round 1's valid votes collapse into one
// node, with nothing lost — every column must still total what the estimate published.

import { describe, expect, it } from "vitest";
import { OTHER_TICKETS_ID, transferSankeyMatrix } from "./transferSankey";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";
import type { PresidentialTicket } from "./useTickets";

const node = (id: string, votes: number, pseudo = false) => ({
  id,
  label: id,
  labelEn: id,
  color: "#888888",
  votes,
  ...(pseudo ? { pseudo } : {}),
});

// Two big candidates, three under 1% of the 10,000 valid votes, and the pseudo nodes.
const MATRIX: VoteFlowMatrix = {
  fromNodes: [
    node("t6", 6000),
    node("t15", 3700),
    node("t1", 50),
    node("t2", 40),
    node("t3", 30),
    node("__none__", 180, true),
    node("__abstain__", 50000, true),
  ],
  toNodes: [
    node("t6", 7000),
    node("t15", 3000),
    node("__abstain__", 50000, true),
  ],
  flows: [
    { from: "t6", to: "t6", votes: 6000 },
    { from: "t15", to: "t15", votes: 3000 },
    { from: "t15", to: "__abstain__", votes: 700 },
    { from: "t1", to: "t6", votes: 30 },
    { from: "t1", to: "t15", votes: 20 },
    { from: "t2", to: "t6", votes: 40 },
    { from: "t3", to: "__abstain__", votes: 30 },
    { from: "__none__", to: "t6", votes: 180 },
    { from: "__abstain__", to: "__abstain__", votes: 50000 },
  ],
};

const TICKETS = new Map<number, PresidentialTicket>([
  [
    6,
    {
      number: 6,
      president: "A",
      vicePresident: "",
      nominatedBy: { name: "", kind: "committee" },
      color: "rgb(1, 2, 3)",
    },
  ],
]);

const LABEL = { bg: "Други двойки", en: "Other pairs" };
const sumFrom = (m: VoteFlowMatrix, id: string) =>
  m.flows.filter((f) => f.from === id).reduce((a, f) => a + f.votes, 0);
const sumTo = (m: VoteFlowMatrix, id: string) =>
  m.flows.filter((f) => f.to === id).reduce((a, f) => a + f.votes, 0);

describe("transferSankeyMatrix", () => {
  const out = transferSankeyMatrix(MATRIX, TICKETS, LABEL);

  it("groups the candidates under 1% into one node, before the pseudo nodes", () => {
    expect(out.fromNodes.map((n) => n.id)).toEqual([
      "t6",
      "t15",
      OTHER_TICKETS_ID,
      "__none__",
      "__abstain__",
    ]);
    const other = out.fromNodes.find((n) => n.id === OTHER_TICKETS_ID)!;
    expect(other.votes).toBe(120);
    expect(other.label).toBe("Други двойки");
  });

  it("loses no vote: the group's ribbons are its members' ribbons summed, and every target keeps its total", () => {
    expect(sumFrom(out, OTHER_TICKETS_ID)).toBe(120);
    for (const n of MATRIX.toNodes)
      expect(sumTo(out, n.id)).toBe(sumTo(MATRIX, n.id));
  });

  it("colours a candidate from tickets.json and leaves the rest as published", () => {
    expect(out.fromNodes[0].color).toBe("rgb(1, 2, 3)");
    expect(out.toNodes[0].color).toBe("rgb(1, 2, 3)");
    expect(out.fromNodes[1].color).toBe("#888888");
  });

  it("does not group a single small candidate — a group of one is only a rename", () => {
    const one = {
      ...MATRIX,
      fromNodes: MATRIX.fromNodes.filter((n) => n.id !== "t2" && n.id !== "t3"),
      flows: MATRIX.flows.filter((f) => f.from !== "t2" && f.from !== "t3"),
    };
    expect(
      transferSankeyMatrix(one, TICKETS, LABEL).fromNodes.map((n) => n.id),
    ).toContain("t1");
  });
  it("measures the 1% against VALID votes — invalid ballots are not in the denominator", () => {
    // t1 holds 120 of 10,000 valid votes (1.2%): a named lane, as in the flow chart. Counting
    // 4,000 invalid ballots too would drop it to 0.86% and group it.
    const m: VoteFlowMatrix = {
      ...MATRIX,
      fromNodes: [
        node("t6", 6000),
        node("t15", 3700),
        node("t1", 120),
        node("t2", 50),
        node("t3", 30),
        node("__none__", 100, true),
        node("__invalid__", 4000, true),
        node("__abstain__", 50000, true),
      ],
    };
    const ids = transferSankeyMatrix(m, TICKETS, LABEL).fromNodes.map(
      (n) => n.id,
    );
    expect(ids).toContain("t1");
    expect(ids).not.toContain("t2");
  });
});
