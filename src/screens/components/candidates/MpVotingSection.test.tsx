// The voting-track header must live INSIDE this section's success path.
//
// This is the one line the whole dual-track sequencing rests on, and its absence shipped
// once: rendered by the PARENT instead, the "Народно събрание" pill appeared above nothing
// for a former MP the roll-call corpus does not reach — a header labelling a record that is
// not on the page. Observed live on /person/mp-101 before the fix. Move `{header}` above the
// early return and the first case here fails, which is the property worth pinning: an
// assertion that only checks the happy path is satisfied by the broken implementation too.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loyaltyHook = vi.fn();
const similarityHook = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/parliament/votes/useMpLoyalty", () => ({
  useMpLoyalty: () => loyaltyHook(),
}));
vi.mock("@/data/parliament/votes/useMpSimilarity", () => ({
  useMpSimilarity: () => similarityHook(),
}));
// The two child tiles have their own test files; this is a test of THIS component's
// composition, not a re-test of their internals.
vi.mock("./MpVotingTile", () => ({
  MpVotingTile: () => <div data-testid="voting-tile" />,
}));
vi.mock("./MpTwinsTile", () => ({
  MpTwinsTile: () => <div data-testid="twins-tile" />,
}));

import { MpVotingSection } from "./MpVotingSection";

const header = <div data-testid="track-header" />;

const show = () =>
  render(<MpVotingSection name="X" linkSlug="mp-1" mpId={1} header={header} />);

beforeEach(() => {
  loyaltyHook.mockReset();
  similarityHook.mockReset();
});

describe("MpVotingSection — the track header never outlives its section", () => {
  it("renders NOTHING, header included, when the MP has no roll-call record", () => {
    loyaltyHook.mockReturnValue({ entry: null, isLoading: false });
    similarityHook.mockReturnValue({ entry: null, isLoading: false });
    const { container } = show();
    // The mutation check: with `{header}` above the early return this is not empty.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("track-header")).not.toBeInTheDocument();
  });

  it("renders the header together with the section when there IS a record", () => {
    loyaltyHook.mockReturnValue({
      entry: { votesCast: 120 },
      isLoading: false,
    });
    similarityHook.mockReturnValue({ entry: null, isLoading: false });
    show();
    expect(screen.getByTestId("track-header")).toBeInTheDocument();
    expect(document.querySelector("#parliament")).toBeInTheDocument();
  });

  it("withholds the header while loading, matching PersonCouncilVoting", () => {
    // `null` is the common outcome for a former MP outside the corpus, so a pill that
    // appears and then vanishes with its section is the MORE common shift. The section
    // itself still mounts so its tiles' skeletons reserve space.
    loyaltyHook.mockReturnValue({ entry: null, isLoading: true });
    similarityHook.mockReturnValue({ entry: null, isLoading: true });
    show();
    expect(screen.queryByTestId("track-header")).not.toBeInTheDocument();
    expect(document.querySelector("#parliament")).toBeInTheDocument();
  });

  it("renders on similarity data alone, and carries the header with it", () => {
    loyaltyHook.mockReturnValue({ entry: null, isLoading: false });
    similarityHook.mockReturnValue({
      entry: { topK: [{ mpId: 2 }] },
      isLoading: false,
    });
    show();
    expect(screen.getByTestId("track-header")).toBeInTheDocument();
  });
});
