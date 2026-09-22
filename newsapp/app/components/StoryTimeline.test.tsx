import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { StoryMember } from "../data";
import type { TimelineOutlet } from "./StoryTimeline";

// ⚠️ Pinned to UTC so the publication-timezone assertions DISCRIMINATE: a
// browser-local implementation would pass on a Sofia runner and fail here.
// Static imports are hoisted above this line and `labels.ts` builds its
// formatters at module load, so the module under test is imported AFTER.
process.env.TZ = "UTC";
const { StoryTimeline, groupByDay } = await import("./StoryTimeline");

const member = (
  domain: string,
  published: string | null,
  extra: Partial<StoryMember> = {},
): StoryMember => ({
  domain,
  article_id: `${domain}-id`,
  url: `https://${domain}/a`,
  title: `Заглавие ${domain}`,
  published,
  leaning: "neutral",
  russia_stance: "not_applicable",
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
  ...extra,
});

const outlets = new Map<string, TimelineOutlet>([
  ["a.bg", { outlet: "Медия А" }],
  ["b.bg", { outlet: "Втора медия" }],
  ["c.bg", { outlet: "Трета" }],
]);

describe("StoryTimeline", () => {
  afterEach(cleanup);

  it("groups by calendar day in the order given, and puts undated members last", () => {
    const days = groupByDay(
      [
        member("a.bg", "2026-09-20T10:00:00+03:00"),
        member("b.bg", "2026-09-20T12:00:00+03:00"),
        member("c.bg", null),
        member("a.bg", "2026-09-21T09:00:00+03:00"),
      ],
      "bg",
    );
    // ⚠️ THE MUTATION THIS CATCHES: one flat list (no day headers), or the
    // undated member sorted into a day it never had.
    expect(days.map((d) => [d.label, d.members.length])).toEqual([
      ["20 септември 2026 г.", 2],
      ["21 септември 2026 г.", 1],
      [null, 1],
    ]);
    expect(days[2].members[0].domain).toBe("c.bg");
    expect(groupByDay([], "bg")).toEqual([]);
  });

  it("keeps a 00:30 Sofia article on its Sofia day, at its Sofia time", () => {
    // ⚠️ THE MUTATION THIS CATCHES: grouping by the reader's local day — under
    // TZ=UTC this is 21:30 the day BEFORE.
    const days = groupByDay(
      [member("a.bg", "2026-09-21T00:30:00+03:00")],
      "bg",
    );
    expect(days[0].label).toBe("21 септември 2026 г.");
    expect(days[0].key).toBe("2026-09-21");
    render(
      <MemoryRouter>
        <StoryTimeline
          members={[member("a.bg", "2026-09-21T00:30:00+03:00")]}
          outlets={outlets}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("timeline-item").querySelector("time"),
    ).toHaveTextContent("00:30");
  });

  it("is order-independent: one group per day however the input is ordered", () => {
    // ⚠️ THE MUTATION THIS CATCHES: folding only ADJACENT same-day members,
    // which splits a day around another and mints duplicate React keys.
    const days = groupByDay(
      [
        member("a.bg", "2026-09-21T09:00:00+03:00"),
        member("b.bg", "2026-09-20T10:00:00+03:00"),
        member("c.bg", "2026-09-21T11:00:00+03:00"),
      ],
      "bg",
    );
    expect(days.map((d) => [d.key, d.members.map((m) => m.domain)])).toEqual([
      ["2026-09-21", ["a.bg", "c.bg"]],
      ["2026-09-20", ["b.bg"]],
    ]);
  });

  it("never claims „първи тук“ when the scoop is not decidable, and falls back headline-wise", () => {
    render(
      <MemoryRouter>
        <StoryTimeline
          members={[
            member("a.bg", "2026-09-20T10:00:00+03:00", {
              first_here: true,
              scoop_decidable: false,
            }),
            member("b.bg", "2026-09-20T11:00:00+03:00", { article_id: null }),
            member("c.bg", "2026-09-20T12:00:00+03:00", {
              article_id: null,
              url: null,
            }),
          ]}
          outlets={outlets}
        />
      </MemoryRouter>,
    );
    // ⚠️ THE MUTATION THIS CATCHES: the chip keyed on first_here alone.
    expect(screen.queryByText("първи тук")).toBeNull();
    const items = screen.getAllByTestId("timeline-item");
    // url only → the headline itself is the external link, announced as such; no separate link-out.
    const external = within(items[1]).getByRole("link", {
      name: /Заглавие b.bg — прочети оригинала в Втора медия \(отваря се в нов раздел\)/,
    });
    expect(external).toHaveAttribute("href", "https://b.bg/a");
    expect(
      within(items[1]).queryByRole("link", { name: /Прочети оригинала/ }),
    ).toBeNull();
    // neither → plain text, only the outlet link remains.
    expect(within(items[2]).getAllByRole("link")).toHaveLength(1);
    expect(within(items[2]).getByText("Заглавие c.bg").tagName).toBe("SPAN");
  });

  it("renders a dated rail with clock time, outlet mark and name, headline, framing chips and the original link", () => {
    render(
      <MemoryRouter>
        <StoryTimeline
          members={[
            member("a.bg", "2026-09-20T10:05:00+03:00", {
              first_here: true,
              scoop_decidable: true,
            }),
            member("b.bg", "2026-09-20T12:30:00+03:00"),
            member("c.bg", null, { leaning: "conservative" }),
          ]}
          outlets={outlets}
        />
      </MemoryRouter>,
    );
    const dayHeads = screen.getAllByTestId("timeline-day");
    expect(dayHeads.map((h) => h.textContent)).toEqual([
      "20 септември 2026 г.",
      "Без дата на публикуване",
    ]);
    const items = screen.getAllByTestId("timeline-item");
    expect(items).toHaveLength(3);
    // Item 1: monogram mark (never a hotlinked logo — see imageCredit.test.ts),
    // first-here chip, time from the item's own timestamp.
    expect(
      within(items[0]).getByTestId("outlet-mark-monogram"),
    ).toHaveTextContent("МА");
    expect(items[0].querySelector("img")).toBeNull();
    expect(within(items[0]).getByText("първи тук")).toBeVisible();
    expect(
      within(items[0]).getByRole("link", { name: "Медия А" }),
    ).toHaveAttribute("href", "/outlet/a.bg");
    expect(
      within(items[0]).getByRole("link", { name: "Заглавие a.bg" }),
    ).toHaveAttribute("href", "/article/a.bg/a.bg-id");
    expect(
      within(items[0]).getByRole("link", { name: /Прочети оригинала/ }),
    ).toHaveAttribute("href", "https://a.bg/a");
    expect(items[0].querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-20T10:05:00+03:00",
    );
    expect(items[0].querySelector("time")).toHaveTextContent("10:05");
    // Day headings are headings, not nested landmarks.
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    // Item 2: two-word outlet → two-letter monogram, the name itself is the link.
    expect(
      within(items[1]).getByTestId("outlet-mark-monogram"),
    ).toHaveTextContent("ВМ");
    expect(within(items[1]).queryByText("първи тук")).toBeNull();
    // Item 3: undated; the framing chip still rides.
    expect(
      within(items[2]).getByTestId("outlet-mark-monogram"),
    ).toHaveTextContent("ТР");
    expect(items[2].querySelector("time")).toBeNull();
    expect(items[2]).toHaveTextContent("—");
    expect(
      items[2].querySelectorAll(".news-analysis-badge").length,
    ).toBeGreaterThan(0);
  });

  it("says so when the filter leaves nothing", () => {
    render(
      <MemoryRouter>
        <StoryTimeline members={[]} outlets={outlets} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Няма източници в избрания сегмент."),
    ).toBeVisible();
    expect(screen.queryByTestId("story-timeline")).toBeNull();
  });
});
