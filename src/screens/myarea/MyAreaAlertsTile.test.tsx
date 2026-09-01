// The visible half of the alert-kind repair. `open_call` rendering with its own icon and
// accessible name is the row that shipped broken, so it is asserted by name rather than left
// to a sweep — and the sweep is here too, so a silently deleted `ICON_BY_TOKEN` entry fails.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ALERT_KINDS, ALERT_KIND_META } from "@/data/alerts/alertKinds";
import type {
  MyAreaAlertEvent,
  MyAreaAlertsFile,
} from "@/data/myarea/useMyAreaAlerts";
import { MyAreaAlertsTile } from "./MyAreaAlertsTile";

const alerts = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/data/myarea/useMyAreaAlerts", () => ({
  useMyAreaAlerts: () => ({ data: alerts.data }),
}));
vi.mock("@/data/municipalities/useMunicipalities", () => ({
  useMunicipalities: () => ({ findMunicipality: () => undefined }),
}));
// The follow button reaches the watchlist store and a route; neither is under test here.
vi.mock("@/screens/components/procurement/FollowButton", () => ({
  FollowButton: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Return the KEY, so an assertion cannot pass on a coincidental piece of copy — and the
    // interpolated {{date}} still shows up so the vintage line is checkable.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.date ? `${key}:${String(opts.date)}` : key,
    i18n: { language: "bg" },
  }),
}));

const event = (over: Partial<MyAreaAlertEvent> = {}): MyAreaAlertEvent => ({
  date: "2026-08-20",
  kind: "council_resolution",
  headline_bg: "Решение на съвета",
  headline_en: "Council resolution",
  ...over,
});

const renderTile = (
  events: MyAreaAlertEvent[],
  over: Partial<MyAreaAlertsFile> = {},
): void => {
  alerts.data = {
    obshtina: "SFO",
    generatedAt: "2026-09-01T21:14:00.000Z",
    events,
    droppedKinds: [],
    ...over,
  } satisfies MyAreaAlertsFile;
  render(<MyAreaAlertsTile obshtina="SFO" />);
};

describe("MyAreaAlertsTile", () => {
  it("renders an open_call row with its own label, not a fallback", () => {
    // THE ROW THAT SHIPPED BROKEN. Before the registry it fell through
    // `ICONS[e.kind] ?? Activity` / `COLOR[e.kind] ?? "#888"` to an anonymous grey line.
    renderTile([
      event({ kind: "open_call", headline_bg: "Отворена процедура" }),
    ]);
    expect(
      screen.getByRole("img", { name: "alert_kind_open_call" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Отворена процедура")).toBeInTheDocument();
  });

  it("gives every registered kind an icon and an accessible name", () => {
    // Mutation-proof: removing an ICON_BY_TOKEN entry is a compile error, but removing the
    // `role="img"`/`aria-label` pair is not — this is what catches that.
    renderTile(ALERT_KINDS.map((kind) => event({ kind })));
    for (const kind of ALERT_KINDS) {
      expect(
        screen.getByRole("img", { name: ALERT_KIND_META[kind].labelKey }),
        `${kind} has no accessible name`,
      ).toBeInTheDocument();
    }
  });

  it("does not colour the glyph with the kind hue", () => {
    // The WCAG 1.4.11 repair: the hue is the TINT and the glyph takes the theme foreground
    // token. Drawn at the hue on a 13% tint of itself, all eight kinds measured under 3:1 in
    // light mode — see the contrast gate in alertKinds.test.ts.
    renderTile([event({ kind: "eu_funds" })]);
    const chip = screen.getByRole("img", { name: "alert_kind_eu_funds" });
    expect(chip.className).toContain("text-foreground/80");
    expect(chip.getAttribute("style")).toContain("background-color");
    expect(chip.style.color).toBe("");
  });

  it("renders the feed vintage from generatedAt", () => {
    renderTile([event()], { generatedAt: "2026-09-01T21:14:00.000Z" });
    expect(screen.getByText(/^my_area_alerts_refreshed:/)).toBeInTheDocument();
  });

  it("omits the vintage line — and does not throw — when the payload carries none", () => {
    // Guards the unguarded `.slice(0, 10)` this file used to do on an `as`-asserted field.
    // The app mounts one error boundary and it is unrelated to this tree, so a throw here is
    // a white screen on /my-area/*.
    expect(() =>
      renderTile([event()], { generatedAt: undefined }),
    ).not.toThrow();
    expect(
      screen.queryByText(/^my_area_alerts_refreshed/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Решение на съвета")).toBeInTheDocument();
  });

  it("renders a programme period in place of a date when the row has one", () => {
    // EU-funds in-progress rows carry a programme-period midpoint rather than a day, which
    // is why the registry marks the kind `syntheticDate`.
    renderTile([event({ kind: "eu_funds", programPeriod: "2014-2020" })]);
    expect(screen.getByText("2014-2020")).toBeInTheDocument();
  });

  it("renders nothing when the feed is empty", () => {
    const { container } = (() => {
      alerts.data = {
        obshtina: "SFO",
        generatedAt: "2026-09-01T21:14:00.000Z",
        events: [],
        droppedKinds: [],
      } satisfies MyAreaAlertsFile;
      return render(<MyAreaAlertsTile obshtina="SFO" />);
    })();
    expect(container).toBeEmptyDOMElement();
  });
});
