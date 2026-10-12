// The competition card compares like with like or not at all: the national rate
// must be the ex-member pair (same basis as the engine's rows), and a function
// that predates those keys yields NO baseline rather than a mismatched one.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildRoadsModel } from "@/lib/roadAttributes";
import type { ProcurementContract } from "@/data/dataTypes";

import { nationalSingleBidExMembers } from "@/data/procurement/useNationalCompetition";
import { RoadCompetitionCard } from "./RoadCompetitionCard";

const row = (p: Partial<ProcurementContract>) =>
  ({
    key: String(Math.random()),
    tag: "contract",
    date: "2024-01-01",
    contractorEik: "1",
    contractorName: "Фирма",
    amountEur: 100,
    title: "Ремонт",
    ...p,
  }) as ProcurementContract;

const model = buildRoadsModel([
  row({
    numberOfTenderers: 1,
    procurementMethod: "Вътрешен конкурентен избор по РС",
    amountEur: 300,
  }),
  row({
    numberOfTenderers: 1,
    procurementMethod: "Договаряне без предварително обявление",
    amountEur: 200,
  }),
  row({ numberOfTenderers: 3, procurementMethod: "Открита процедура" }),
  row({ numberOfTenderers: 2, procurementMethod: "Открита процедура" }),
]);

describe("RoadCompetitionCard", () => {
  it("compares against the ex-member national pair", () => {
    const rate = nationalSingleBidExMembers({
      singleBid: 50,
      bidKnown: 100,
      contracts: 120,
      singleBidExMembers: 40,
      bidKnownExMembers: 100,
    });
    render(<RoadCompetitionCard model={model} nationalRate={rate} />);
    expect(screen.getByText(/50%/)).toBeTruthy();
    // jsdom's i18n default is English.
    expect(document.body.textContent).toContain("against 40%");
    expect(document.body.textContent).not.toContain("against 50%");
  });

  it("shows no baseline when the function predates the ex-member keys", () => {
    const rate = nationalSingleBidExMembers({
      singleBid: 50,
      bidKnown: 100,
      contracts: 120,
    });
    expect(rate).toBeNull();
    render(<RoadCompetitionCard model={model} nationalRate={rate} />);
    expect(document.body.textContent).not.toMatch(
      /all buyers in the same window/,
    );
  });

  it("names the framework and no-notice share of the single-bid money", () => {
    render(<RoadCompetitionCard model={model} nationalRate={null} />);
    const t = document.body.textContent ?? "";
    expect(t).toMatch(/€300 was a mini-competition under a framework/);
    expect(t).toMatch(/€200 a negotiation without prior notice/);
  });
});
