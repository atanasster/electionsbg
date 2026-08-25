// The council-voting card must self-hide (no empty section header) when a person has
// no council votes attributed to them, and must never invent a "loyalty" percentage —
// this corpus carries no party affiliation, so any headline figure has to be measured
// against the council's OWN majority (ofScoredVotes), never the raw vote count.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CouncilCouncillor } from "@/data/council/useCouncilHub";

const councillorHook = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/council/useCouncilHub", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/data/council/useCouncilHub")>();
  return { ...actual, useCouncilCouncillor: () => councillorHook() };
});

import { PersonCouncilVoting } from "./PersonCouncilVoting";

const councillor = (
  over: Partial<CouncilCouncillor> = {},
): CouncilCouncillor => ({
  personId: 1,
  councilCode: "SOF",
  councilName: "Столична община",
  name: "Антон Бранков",
  votes: 180,
  for: 168,
  against: 5,
  abstain: 7,
  ofNamedVoteResolutions: 313,
  againstMajority: 4,
  abstainedFromMajority: 7,
  ofScoredVotes: 180,
  noMajorityResolutions: 0,
  recent: [
    {
      id: "SOF-2026-prot63-r426",
      decidedOn: "2026-06-11",
      title: "Решение А",
      vote: "for",
    },
    {
      id: "SOF-2026-prot63-r427",
      decidedOn: "2026-06-11",
      title: "Решение Б",
      vote: "against",
    },
  ],
  attendanceBasis: "attendance basis text",
  dissentBasis: "dissent basis text",
  ...over,
});

const renderTile = () =>
  render(
    <MemoryRouter>
      <PersonCouncilVoting slug="anton-brankov" />
    </MemoryRouter>,
  );

beforeEach(() => councillorHook.mockReset());

describe("PersonCouncilVoting", () => {
  it("renders a hidden loading placeholder, no section header, while pending", () => {
    councillorHook.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderTile();
    expect(container.querySelector("section")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("self-hides entirely when the person has no council votes", () => {
    councillorHook.mockReturnValue({ data: null, isLoading: false });
    const { container } = renderTile();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the council name, vote counts, and both basis captions", () => {
    councillorHook.mockReturnValue({ data: councillor(), isLoading: false });
    renderTile();
    expect(screen.getByText(/Столична община/)).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
    expect(screen.getByText("168")).toBeInTheDocument();
    expect(screen.getByText("attendance basis text")).toBeInTheDocument();
    expect(screen.getByText("dissent basis text")).toBeInTheDocument();
  });

  it("computes the with-majority share from ofScoredVotes, never the raw vote count", () => {
    // 180 scored, 4 against majority, 7 abstained from majority -> (180-4-7)/180 = 93.9%
    councillorHook.mockReturnValue({ data: councillor(), isLoading: false });
    renderTile();
    expect(screen.getByText("93,9%")).toBeInTheDocument();
  });

  it("omits the with-majority share when no resolution had a scoreable majority", () => {
    councillorHook.mockReturnValue({
      data: councillor({
        ofScoredVotes: 0,
        againstMajority: 0,
        abstainedFromMajority: 0,
      }),
      isLoading: false,
    });
    renderTile();
    expect(
      screen.queryByText("pp_council_voting_with_majority"),
    ).not.toBeInTheDocument();
  });

  it("lists recent resolutions linking to /council/resolution/:id", () => {
    councillorHook.mockReturnValue({ data: councillor(), isLoading: false });
    renderTile();
    const link = screen.getByRole("link", { name: /Решение А/ });
    expect(link).toHaveAttribute(
      "href",
      "/council/resolution/SOF-2026-prot63-r426",
    );
  });
});
