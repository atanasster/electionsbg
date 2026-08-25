// PersonMpSections used to also open the person page's `#declarations` section (via
// MpAssetsSummary + a bare-mode PersonDeclarations). That branch is retired — declared
// assets now render once, for every tier including MPs, from PersonProfileScreen directly.
// This pins the invariant directly: the component composes the scorecard, the roll-call
// section and the no-rollcall note, and NOTHING ELSE — no `#declarations` node of its own.
//
// Hermetic: every child component and data hook is stubbed, so this is a render test over
// PersonMpSections's OWN composition, not a re-test of its children's internals (each has
// its own test file already).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
vi.mock("@/data/parliament/useMpEntry", () => ({
  useMpEntry: () => ({ entry: undefined, isLoading: false, isFetched: true }),
}));
vi.mock("@/screens/components/candidates/MpScorecardTile", () => ({
  MpScorecardTile: () => <div data-testid="scorecard" />,
}));
// Deliberately still mocked though this component no longer renders it: if a future change
// puts the roll-call section back in here it would show up as a `voting` testid, and the
// last case below fails. That is the point — the section belongs to the sequenced track
// (PersonMpVoting), so that the scorecard can sit ABOVE both tracks rather than between the
// local track's card and the national track's header.
vi.mock("@/screens/components/candidates/MpVotingSection", () => ({
  MpVotingSection: () => <div data-testid="voting" />,
}));

import { PersonMpSections } from "./PersonMpSections";

describe("PersonMpSections", () => {
  it("never renders a #declarations section", () => {
    const { container } = render(
      <PersonMpSections name="Иван Иванов" mpId={1} />,
    );
    expect(container.querySelector("#declarations")).toBeNull();
  });

  it("renders only the scorecard and the no-rollcall note", () => {
    render(<PersonMpSections name="Иван Иванов" mpId={1} />);
    expect(screen.getByTestId("scorecard")).toBeInTheDocument();
    // Nothing beyond those two: no stray heading, no "mp_section_assets" title, no
    // "mp_assets_title" — the strings the retired declarations branch would have printed.
    expect(screen.queryByText("mp_section_assets")).not.toBeInTheDocument();
    expect(screen.queryByText("mp_assets_title")).not.toBeInTheDocument();
  });

  it("does NOT render the roll-call section — that is a sequenced track now", () => {
    // While it lived here the scorecard rendered between the local track's card and the
    // national track's header, putting parliamentary KPIs under the „МЕСТНА ВЛАСТ" pill
    // for anyone who sat on a council first.
    render(<PersonMpSections name="Иван Иванов" mpId={1} />);
    expect(screen.queryByTestId("voting")).not.toBeInTheDocument();
  });
});
