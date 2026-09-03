// The switcher's section behaviour (§Phase 6 item 6): from a polling station every pill leads
// somewhere else, and the reader has to be told.
//
// ⚠ THE FALLBACK ALREADY WORKED AND WAS SILENT, which is why this is worth a file of its own.
// `placeViews.ts` has dropped a section to its parent settlement since it was written; nothing
// on screen said so. A reader on station №132900019 tapped „Местни" and arrived at с.Виноградец
// with the station gone and no error — the page they asked for and the page they got differ,
// both render at a 200, and no assertion anywhere compared them.
//
// ⚠ AND THE REASON MATTERS AS MUCH AS THE NOTE. §6 phrases it as "section codes do not map
// reliably between election kinds/cycles". Measured, it is the KIND boundary alone — across
// cycles of one kind the numbering is 97%+ stable — so copy blaming cycles would be wrong about
// a fact a reader could check. `scripts/elections/sectionCodeCrossKind.data.test.ts` holds the
// measurement; this file holds the rendering.
//
//   npm run test:unit

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PlaceViewNav } from "./PlaceViewNav";
import bg from "@/locales/bg/translation.json";

vi.mock("@/data/local/useLatestLocalCycle", () => ({
  useLatestLocalCycle: () => "2023_10_29_mi",
}));
vi.mock("@/data/local/useLocalElectionIndex", () => ({
  useLocalElectionIndex: () => ({
    data: { municipalities: [{ obshtinaCode: "PAZ19", oblast: "PAZ" }] },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => (bg as Record<string, string>)[k] ?? k,
  }),
}));

const NOTE = bg.place_view_nav_section_note;

const mount = (props: Parameters<typeof PlaceViewNav>[0]) =>
  render(
    <MemoryRouter>
      <PlaceViewNav {...props} />
    </MemoryRouter>,
  );

describe("kind switching from a polling section", () => {
  it("announces that the links open the settlement, not the same station", () => {
    mount({
      active: "parliamentary",
      level: "section",
      ekatte: "55155",
      obshtina: "PAZ19",
      oblast: "PAZ",
    });
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("says KINDS, not cycles — the measured reason", () => {
    // ⚠ NOT DECORATION. Across cycles of one kind the numbering is 97%+ stable, so „между
    // изборите" or „между циклите" would be a claim the corpus contradicts. The two kinds are
    // named because the collapse is theirs.
    expect(NOTE).toMatch(/парламентарни/);
    expect(NOTE).toMatch(/местни/);
    expect(NOTE).toMatch(/населеното място/);
  });

  it("wires the note to the nav so a screen reader meets it BEFORE the pills", () => {
    // A `title` attribute would satisfy a naive "is it announced?" check and reach neither a
    // touch reader nor a keyboard one.
    mount({
      active: "parliamentary",
      level: "section",
      ekatte: "55155",
      obshtina: "PAZ19",
      oblast: "PAZ",
    });
    const nav = screen.getByRole("navigation");
    const id = nav.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(NOTE);
  });

  it("says NOTHING at the settlement tier, where the pills go where they say", () => {
    // The discriminating half: a note that rendered everywhere would pass the first test while
    // telling every reader on every place page that their links go somewhere else.
    mount({
      active: "parliamentary",
      level: "settlement",
      ekatte: "55155",
      obshtina: "PAZ19",
      oblast: "PAZ",
    });
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(
      screen.getByRole("navigation").getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("still offers both election kinds from a section — the note explains, it does not remove", () => {
    // ⚠ THE FAILURE THE NOTE MUST NOT CAUSE. „These links go elsewhere" is an argument for
    // hiding them, and hiding them strands a reader on a station page with no way out. Both
    // pills stay; only Governance and Consumption drop, because they have no station tier.
    mount({
      active: "parliamentary",
      level: "section",
      ekatte: "55155",
      obshtina: "PAZ19",
      oblast: "PAZ",
    });
    expect(screen.getByText(bg.cross_to_local)).toBeTruthy();
    expect(screen.getByText(bg.cross_to_parliamentary)).toBeTruthy();
  });
});
