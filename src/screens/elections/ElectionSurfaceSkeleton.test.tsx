// The skeleton's only job is that the page does not move — and that the swap is not silent.
//
// ⚠ jsdom HAS NO LAYOUT, so nothing here can measure a shift. What it CAN hold is the property
// that makes the visual claim true: the skeleton and the real canvas declare the SAME grid and
// the SAME slot placement, from one definition, so they cannot drift apart. The pixel check
// belongs to the browser suite (§10.0), and saying so here is what stops these gates being read
// as more than they are.

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ElectionSurfaceSkeleton } from "./ElectionSurfaceSkeleton";
import {
  CANVAS_GRID_CLASS,
  CANVAS_MAP_SLOT_CLASS,
  CANVAS_RANKED_SLOT_CLASS,
} from "./electionSurfaceLayout";
import { MAX_BALLOT_PREVIEW } from "@/data/elections/surfaceTypes";

describe("it reserves the shape the content will take", () => {
  it("declares the canvas's own grid, from the shared definition", () => {
    const { container } = render(<ElectionSurfaceSkeleton />);
    const canvas = container.querySelector(
      '[data-skeleton-region="canvas"]',
    ) as HTMLElement;
    for (const cls of CANVAS_GRID_CLASS.split(" "))
      expect(canvas.className, cls).toContain(cls);
    expect(
      container.querySelector('[data-skeleton-slot="ranked"]')!.className,
    ).toContain(CANVAS_RANKED_SLOT_CLASS);
    expect(
      container.querySelector('[data-skeleton-slot="map"]')!.className,
    ).toContain(CANVAS_MAP_SLOT_CLASS);
  });

  it("puts the ranked slot BEFORE the map, exactly as the canvas does", () => {
    // If the two disagreed the page would reflow on arrival even with identical classes.
    const { container } = render(<ElectionSurfaceSkeleton />);
    expect(
      [...container.querySelectorAll("[data-skeleton-slot]")].map((n) =>
        n.getAttribute("data-skeleton-slot"),
      ),
    ).toEqual(["ranked", "map"]);
  });

  it("reserves the producer's own number of rows, not a guess", () => {
    const { container } = render(<ElectionSurfaceSkeleton />);
    expect(
      container.querySelectorAll('[data-skeleton-slot="ranked"] > div'),
    ).toHaveLength(MAX_BALLOT_PREVIEW);
  });

  it("reserves NO map box on a level that draws no map", () => {
    // ⚠ THE SHIFT IN THE OTHER DIRECTION. A section draws no map, so a reserved 320px box there
    // is a hole the arriving content never fills.
    const { container } = render(<ElectionSurfaceSkeleton withMap={false} />);
    expect(container.querySelector('[data-skeleton-slot="map"]')).toBeNull();
    expect(
      container.querySelector('[data-skeleton-slot="ranked"]'),
    ).toBeTruthy();
  });

  it("reserves exactly the number of fact cards it is told to", () => {
    const { container } = render(<ElectionSurfaceSkeleton facts={2} />);
    expect(
      container.querySelectorAll('[data-skeleton-region="facts"] > div'),
    ).toHaveLength(2);
  });
});

describe("it announces nothing of its own", () => {
  it("is aria-hidden and declares no landmark or heading", () => {
    // ⚠ THE BOUNDARY OWNS THE ANNOUNCEMENT. It wraps this in `aria-busy` + `aria-live` with a
    // label; a named region or a heading here would announce a section that does not exist yet
    // and then disappear, which is worse than silence.
    const { container } = render(<ElectionSurfaceSkeleton />);
    const root = container.querySelector("[data-surface-skeleton]")!;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(root.querySelector("[aria-labelledby],[role],section")).toBeNull();
  });
});
