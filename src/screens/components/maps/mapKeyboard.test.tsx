// The election maps' keyboard access — the defect this closes, and the opt-in that bounds it.
//
// ⚠ `FeatureMap` DERIVES ACCESS AS `!!ariaLabel && !!onClick`, and `tabIndex`, `role`,
// `aria-label`, `onKeyDown` and the focus ring are ALL gated on that one boolean. So a region
// wired for navigation with no label is silently MOUSE-ONLY: nothing renders half-done and
// nothing looks wrong. `MapElement` — every election map's feature renderer — passed `onClick`
// and never a label, so country, region, município, settlement and section maps were all in
// that state, which is §6's named defect on the busiest pages on the site.

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeatureMap } from "./FeatureMap";
import type { GeoPath } from "d3-geo";
import type { GeoFeature } from "./mapTypes";

vi.mock("@/ux/TouchProvider", () => ({ useTouch: () => false }));

const geoPath = (() => "M0 0 L1 1 Z") as unknown as GeoPath;
const feature = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [] },
} as unknown as GeoFeature;

const draw = (props: Partial<React.ComponentProps<typeof FeatureMap>>) =>
  render(
    <svg>
      <FeatureMap geoPath={geoPath} feature={feature} {...props} />
    </svg>,
  ).container.querySelector("path")!;

describe("a navigable region is operable by keyboard", () => {
  it("is focusable, named and activated by Enter and Space", () => {
    const onClick = vi.fn();
    const path = draw({ onClick, ariaLabel: "Пловдив — води ПрБ" });
    expect(path).toHaveAttribute("tabindex", "0");
    expect(path).toHaveAttribute("role", "button");
    expect(path).toHaveAttribute("aria-label", "Пловдив — води ПрБ");
    // The visible focus ring is half the contract — a focusable control nobody can see focused
    // is not reachable in practice.
    expect(path.getAttribute("class")).toContain("kbd-focus-ring");
  });

  it("is NOT focusable without a label, which is the state to catch", () => {
    // ⚠ THE WHOLE POINT. This is what every election map rendered before: an `onClick` and no
    // label, so the derivation is false and the path is a mouse target with no keyboard, no
    // role and no name. It still navigates perfectly.
    const path = draw({ onClick: vi.fn() });
    expect(path).not.toHaveAttribute("tabindex");
    expect(path).not.toHaveAttribute("role");
    expect(path).not.toHaveAttribute("aria-label");
  });

  it("is NOT focusable without an onClick either", () => {
    // A named region that goes nowhere must not be a button — announcing it as one promises an
    // activation that does nothing.
    const path = draw({ ariaLabel: "Пловдив" });
    expect(path).not.toHaveAttribute("tabindex");
    expect(path).not.toHaveAttribute("role");
  });
});

describe("the election maps opt in through MapElement", () => {
  it("MapElement forwards a label to FeatureMap, and useMapElements builds one", async () => {
    // A source scan, because the two halves are in different files and neither mentions the
    // other: `MapElement` has to ACCEPT the label and `useMapElements` has to SUPPLY it. Either
    // half alone leaves every election map exactly as it was.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (p: string) =>
      fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const el = read("src/screens/components/maps/MapElement.tsx");
    expect(el).toContain("ariaLabel?: string;");
    expect(el).toContain("ariaLabel={ariaLabel}");
    const hook = read("src/screens/components/maps/useMapElements.tsx");
    expect(hook).toContain("featureLabel");
    expect(hook).toContain("featureLabel(feature.properties, info, v)");
    // …and the country map is the first caller to take the option up.
    const map = read("src/screens/components/regions/RegionsMap.tsx");
    expect(map).toContain("featureLabel:");
    // ⚠ THE LABEL RESOLVES THE PARTY THROUGH THE CANONICAL CORPUS (§5.3). `cik_parties.json`
    // carries `nickName` and — measured, 0 of 25 rows for the 2026 cycle — no English form at
    // all, so reading the ballot record directly renders „Blagoevgrad — ПрБ leads" on the
    // English page. `canonical_parties.json` is the only corpus with both languages.
    expect(map).toContain("displayNameFor(lead.nickName)");
    expect(map).not.toContain("nickName_en");
  });
});
