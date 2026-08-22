// The defect this component was fixed for lived in its HEADING, and the heading logic is
// here rather than in the hook: which string a basis maps to, and the refusal to caption a
// window with no anchor. useContestedVotes.test.tsx covers the tier selection; nothing
// covered the rendering of it, so a change putting „тази седмица" back into the title key —
// or dropping the `anchor &&` guard — passed everything green.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";
import type { TopicEntry } from "@/data/parliament/votes/types";
import type { ContestedVotes } from "@/data/parliament/votes/useContestedVotes";

const state = vi.hoisted(() => ({ value: {} as ContestedVotes }));
vi.mock("@/data/parliament/votes/useContestedVotes", () => ({
  useContestedVotes: () => state.value,
}));

// i18next is a real singleton in this app; stubbing `t` to echo the key + params keeps the
// assertions about WHICH string was chosen rather than about a translation's wording.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: "bg" },
  }),
}));

vi.mock("@/ux/Link", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const { ContestedVotesFeed } = await import("./ContestedVotesFeed");

const row = (): TopicEntry =>
  ({
    date: "2026-07-24",
    item: 1,
    slug: "1",
    title: "Закон за държавния бюджет",
    topic: "бюджет",
    contestScore: 0.4,
    outcome: "passed",
    tally: { yes: 114, no: 85, abstain: 7 },
  }) as unknown as TopicEntry;

beforeEach(() => {
  state.value = {
    items: [row()],
    isLoading: false,
    basis: "window",
    anchor: "2026-07-24",
  };
});
afterEach(() => vi.clearAllMocks());

describe("ContestedVotesFeed caption", () => {
  it("names the sitting the window ran back from", () => {
    render(<ContestedVotesFeed />);
    const caption = screen.getByText(/votes_landing_breaks_window/);
    // The anchor reaches the string, so the reader sees 24 July rather than a wall-clock
    // period — the whole point of the fix.
    expect(caption.textContent).toContain("2026");
    expect(caption.textContent).toContain('"days":7');
  });

  it("says whole-term when the fallback tier was served", () => {
    state.value = { ...state.value, basis: "allTime" };
    render(<ContestedVotesFeed />);
    expect(
      screen.getByText("votes_landing_breaks_alltime"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/votes_landing_breaks_window/)).toBeNull();
  });

  it("renders NO caption rather than a wrong one when the anchor is missing", () => {
    state.value = { ...state.value, basis: "window", anchor: null };
    render(<ContestedVotesFeed />);
    // Falling through to the all-time string here would be the same defect from the other
    // side: a whole-term label over a windowed set of rows.
    expect(screen.queryByText("votes_landing_breaks_alltime")).toBeNull();
    expect(screen.queryByText(/votes_landing_breaks_window/)).toBeNull();
  });

  it("renders nothing at all while loading or with no items", () => {
    state.value = { ...state.value, isLoading: true };
    const { container: loading } = render(<ContestedVotesFeed />);
    expect(loading.firstChild).toBeNull();

    state.value = { ...state.value, isLoading: false, items: [] };
    const { container: empty } = render(<ContestedVotesFeed />);
    expect(empty.firstChild).toBeNull();
  });
});

describe("the title itself", () => {
  // The original defect, pinned in both languages: the heading may not name a period,
  // because neither tier is a wall-clock one.
  it("names no period", () => {
    expect(en.votes_landing_breaks_title).not.toMatch(
      /week|month|today|recent/i,
    );
    expect(bg.votes_landing_breaks_title).not.toMatch(
      /седмиц|месец|днес|скоро/i,
    );
  });

  // FINDING-001: both paths compute CALENDAR days back from the anchor — the route with
  // `s.date >= anchor - $2`, the fallback with setUTCDate. Neither counts sitting days, so
  // the caption may not claim it does.
  it("does not claim a basis of active/sitting days", () => {
    expect(bg.votes_landing_breaks_window).not.toMatch(/активн|заседателн/i);
    expect(en.votes_landing_breaks_window).not.toMatch(/active|sitting days/i);
  });
});
