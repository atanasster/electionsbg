// Phase 4b: the entity seat line (settlement · obshtina · oblast) shared by the awarder /
// company page, resolved from place_dim via awarder_seat_place. Links each segment when its
// code is present; degrades to plain text (and a null render) otherwise.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mutable language so a single module-level mock can exercise both BG and EN branches.
const i18nState = vi.hoisted(() => ({ lang: "bg" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: {
      get language() {
        return i18nState.lang;
      },
    },
  }),
}));

beforeEach(() => {
  i18nState.lang = "bg";
});

import { PlaceSeatLine, type SeatPlace } from "./PlaceSeatLine";

const varna = (over: Partial<SeatPlace> = {}): SeatPlace => ({
  ekatte: "10135",
  settlement: "Варна",
  settlementEn: "Varna",
  settlementType: "гр.",
  obshtinaCode: "VAR06",
  obshtina: "Варна",
  obshtinaEn: "Varna",
  oblastCode: "VAR",
  oblast: "Варна",
  oblastEn: "Varna",
  ...over,
});

const draw = (place: SeatPlace) =>
  render(
    <MemoryRouter>
      <PlaceSeatLine place={place} />
    </MemoryRouter>,
  );

describe("PlaceSeatLine", () => {
  it("renders typed settlement · obshtina · oblast with each segment linked", () => {
    const { container } = draw(varna());
    expect(container.textContent).toContain("гр. Варна");
    // Settlement links to its procurement page; obshtina/oblast to governance.
    expect(
      container.querySelector('a[href="/procurement/settlement/10135"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[href="/governance/VAR06"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[href="/governance/region/VAR"]'),
    ).not.toBeNull();
    // Two dot separators between three segments.
    expect(container.textContent).toContain(" · ");
  });

  it("strips the tautological 'област' suffix (Sofia province)", () => {
    const { container } = draw(
      varna({ oblastCode: "SFO", oblast: "Софийска област", oblastEn: null }),
    );
    expect(container.textContent).toContain("Софийска");
    expect(container.textContent).not.toContain("Софийска област");
  });

  it("renders unlinked plain text for a name-parsed seat (no codes)", () => {
    const { container } = draw(
      varna({
        ekatte: null,
        settlementType: null,
        obshtinaCode: null,
        obshtinaEn: null,
        oblastCode: null,
        oblastEn: null,
      }),
    );
    expect(container.textContent).toContain("Варна");
    // No codes → no links at all.
    expect(container.querySelector("a")).toBeNull();
  });

  it("returns null when there is no place at all", () => {
    const { container } = draw(
      varna({
        settlement: null,
        settlementEn: null,
        obshtina: null,
        obshtinaEn: null,
        oblast: null,
        oblastEn: null,
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("EN: uses EN names, no т.в.м. prefix, strips the 'region' suffix", () => {
    i18nState.lang = "en";
    const { container } = draw(
      varna({ oblast: "Sofia region", oblastEn: "Sofia region" }),
    );
    // English drops the гр./с. marker.
    expect(container.textContent).toContain("Varna");
    expect(container.textContent).not.toContain("гр.");
    expect(container.textContent).toContain("Sofia");
    expect(container.textContent).not.toContain("Sofia region");
  });

  it("EN: falls back to the BG name when the EN name is null", () => {
    i18nState.lang = "en";
    const { container } = draw(varna({ settlementEn: null }));
    expect(container.textContent).toContain("Варна");
  });

  it("Sofia city: governance-crosswalked obshtina links to /governance/SOF00, oblast plain text", () => {
    // The SQL emits the governance code (SOF00) for Sofia's obshtina and NULLs the oblast
    // code (SOFIA_CITY has no /governance/region page). PlaceSeatLine must link the obshtina
    // and render the oblast unlinked.
    const { container } = draw(
      varna({
        ekatte: "68134",
        settlement: "София",
        settlementEn: "Sofia",
        obshtinaCode: "SOF00",
        obshtina: "Столична община",
        oblastCode: null,
        oblast: "София (столица)",
      }),
    );
    expect(
      container.querySelector('a[href="/governance/SOF00"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("София (столица)");
    // No region link (oblastCode is null).
    expect(
      container.querySelector('a[href^="/governance/region/"]'),
    ).toBeNull();
  });
});
