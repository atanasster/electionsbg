// The feed's rendering: the date-basis label, the read-time countdown, and the four states.
//
// The clause that matters most is the date basis. Two rows differing ONLY in how they are
// dated must read differently — „проведено на" against „намерено в данните на" — because
// that difference is the whole reason the artifact carries a basis instead of one
// pre-resolved date.

import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  HOME_EVENT_BACKFILL_FIXTURE,
  HOME_EVENT_FIRST_SEEN_FIXTURE,
  HOME_EVENT_OCCURRED_FIXTURE,
  HOME_FEED_FIXTURE,
} from "@/data/home/__fixtures__/home";
import type { HomeEventV1, HomeFeedV1 } from "@/data/home/homeTypes";
import { HomeChangeCard } from "./HomeChangeCard";
import { daysUntil } from "./daysUntil";
import { HomeChangeFeed, RENDERED } from "./HomeChangeFeed";

const stub = vi.hoisted(() => ({
  feed: undefined as HomeFeedV1 | undefined,
  settled: true,
}));
vi.mock("@/data/home/useHomeFeed", () => ({
  useHomeFeed: () => ({ feed: stub.feed, settled: stub.settled }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Key + args, so no assertion can pass on a coincidental piece of copy.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length
        ? `${key}(${Object.entries(opts)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",")})`
        : key,
    i18n: { language: "bg" },
  }),
}));

const renderCard = (event: HomeEventV1) =>
  render(
    <MemoryRouter>
      <ul>
        <HomeChangeCard event={event} />
      </ul>
    </MemoryRouter>,
  );

const renderFeed = (feed: HomeFeedV1 | undefined, settled = true) => {
  stub.feed = feed;
  stub.settled = settled;
  return render(
    <MemoryRouter>
      <HomeChangeFeed />
    </MemoryRouter>,
  );
};

describe("HomeChangeCard — the date basis", () => {
  it("labels an occurrence as something that HAPPENED", () => {
    const { container } = renderCard(HOME_EVENT_OCCURRED_FIXTURE);
    expect(container.textContent).toContain("home_date_basis_occurred");
  });

  it("labels a first-seen row as something we FOUND, never as an occurrence", () => {
    // ⚠️ The pair. The two fixtures are the same shape and differ only in how they are
    // dated, so a renderer that ignored the basis would pass one of these and fail the
    // other — which is exactly what makes them worth having.
    const { container } = renderCard(HOME_EVENT_FIRST_SEEN_FIXTURE);
    expect(container.textContent).toContain("home_date_basis_first_seen");
    expect(container.textContent).not.toContain("home_date_basis_occurred");
  });

  it("renders the fact from its key and arguments, not as prose", () => {
    const { container } = renderCard(HOME_EVENT_OCCURRED_FIXTURE);
    expect(container.textContent).toContain("home_fact_contract_awarded");
  });

  it("links to the event's own in-app route", () => {
    renderCard(HOME_EVENT_OCCURRED_FIXTURE);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      HOME_EVENT_OCCURRED_FIXTURE.route,
    );
  });

  it("labels a bulk load so it cannot read as news", () => {
    const { container } = renderCard(HOME_EVENT_BACKFILL_FIXTURE);
    expect(container.textContent).toContain("home_event_backfill");
  });

  it("shows a coverage note when the source is incomplete", () => {
    const { container } = renderCard({
      ...HOME_EVENT_OCCURRED_FIXTURE,
      coverage: { complete: false, noteKey: "home_coverage_council_partial" },
    });
    expect(container.textContent).toContain("home_coverage_council_partial");
  });

  it("says nothing about coverage when it is complete", () => {
    const { container } = renderCard(HOME_EVENT_OCCURRED_FIXTURE);
    expect(container.textContent).not.toContain("home_coverage");
  });
});

describe("daysUntil — the countdown is computed, never stored", () => {
  it("counts whole days ahead", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(daysUntil("2026-09-04T00:00:00.000Z", now)).toBe(3);
    expect(daysUntil("2026-09-01T00:00:00.000Z", now)).toBe(0);
  });

  it("returns null once the deadline is past, rather than a negative", () => {
    // ⚠️ THE REASON IT IS NOT STORED. A „3 days left" frozen into the artifact is wrong the
    // day after generation, and an expired call would keep advertising a countdown — the
    // `open_calls` (142) defect. Computed here, an expired deadline simply stops rendering.
    const now = Date.parse("2026-09-05T00:00:00.000Z");
    expect(daysUntil("2026-09-04T00:00:00.000Z", now)).toBeNull();
  });

  it("returns null on an unparseable input instead of NaN", () => {
    expect(daysUntil("whenever")).toBeNull();
  });

  it("renders the countdown only for a row that carries a deadline", () => {
    const withDeadline = renderCard({
      ...HOME_EVENT_OCCURRED_FIXTURE,
      deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    expect(withDeadline.container.textContent).toContain(
      "home_event_days_left",
    );
    const without = renderCard(HOME_EVENT_OCCURRED_FIXTURE);
    expect(without.container.textContent).not.toContain("home_event_days_left");
  });
});

describe("HomeChangeFeed", () => {
  it("renders at most the prefix the artifact was ranked for", () => {
    const many: HomeFeedV1 = {
      ...HOME_FEED_FIXTURE,
      events: Array.from({ length: 20 }, (_, i) => ({
        ...HOME_EVENT_OCCURRED_FIXTURE,
        id: `e-${i}`,
      })),
    };
    renderFeed(many);
    expect(screen.getAllByRole("link").length).toBeLessThanOrEqual(
      RENDERED + 1, // + the section's own "see all"
    );
  });

  it("takes the artifact's order and does not re-rank", () => {
    // Re-sorting here would silently produce a different feed from the one the generator's
    // diversity and ranking gates checked.
    renderFeed({
      ...HOME_FEED_FIXTURE,
      events: [
        { ...HOME_EVENT_OCCURRED_FIXTURE, id: "b", route: "/b" },
        { ...HOME_EVENT_OCCURRED_FIXTURE, id: "a", route: "/a" },
      ],
    });
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h) => h === "/a" || h === "/b");
    expect(hrefs).toEqual(["/b", "/a"]);
  });

  it("links back to /data/updates, which answers the other question", () => {
    // §6.7: two „what changed" surfaces that do not distinguish themselves read as a
    // contradiction, so each links the other.
    renderFeed(HOME_FEED_FIXTURE);
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === "/data/updates"),
    ).toBe(true);
  });

  it("states the window and the vintage rather than implying them", () => {
    const { container } = renderFeed(HOME_FEED_FIXTURE);
    expect(container.textContent).toContain("home_changed_window");
    expect(container.textContent).toContain("days=30");
  });

  it("discloses an unavailable feed once settled, and keeps the way out", () => {
    const { container } = renderFeed(undefined, true);
    expect(container.textContent).toContain("home_changed_unavailable");
    // The degraded state is exactly when a reader most needs the page that says when each
    // source was last refreshed.
    expect(
      screen
        .getAllByRole("link")
        .some((a) => a.getAttribute("href") === "/data/updates"),
    ).toBe(true);
  });

  it("renders no date label for a row whose declared date is missing", () => {
    // „проведено на " with nothing after it is worse than saying nothing, and falling back
    // to firstSeenAt would relabel a missing occurrence as one we found.
    const { container } = renderCard({
      ...HOME_EVENT_OCCURRED_FIXTURE,
      occurredAt: undefined,
    });
    expect(container.textContent).not.toContain("home_date_basis_occurred");
    expect(container.textContent).toContain("home_fact_contract_awarded");
  });

  it("renders the same prefix the generator diversified for", () => {
    // ⚠️ The two constants live apart — a browser module cannot import a Node generator —
    // so this reads the generator's source and asserts they agree. A component slicing a
    // different number would render a prefix whose category diversity nobody checked.
    const gen = readFileSync(
      path.join(__dirname, "../../../scripts/db/gen_home/feed.ts"),
      "utf-8",
    );
    const declared = /export const RENDERED = (\d+);/.exec(gen);
    expect(declared, "RENDERED not found in the generator").toBeTruthy();
    expect(Number(declared![1])).toBe(RENDERED);
  });

  it("renders NOTHING while the request is still in flight", () => {
    // The pair that makes the clause above non-vacuous: shown during loading, the note tells
    // every first-time visitor the feed is broken.
    const { container } = renderFeed(undefined, false);
    expect(container).toBeEmptyDOMElement();
  });
});
