import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartGhost } from "./ChartGhost";

describe("ChartGhost", () => {
  it("keeps the replaced placeholder's shell and height class", () => {
    const { container } = render(<ChartGhost className="h-[280px]" />);
    const root = container.firstElementChild!;
    for (const cls of ["h-[280px]", "rounded-xl", "border", "bg-card"])
      expect(root.classList).toContain(cls);
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws bars by default and dots for a scatter", () => {
    const bars = render(<ChartGhost />).container;
    expect(bars.querySelectorAll("rect").length).toBeGreaterThan(0);
    expect(bars.querySelectorAll("circle")).toHaveLength(0);
    const dots = render(<ChartGhost shape="dots" />).container;
    expect(dots.querySelectorAll("circle").length).toBeGreaterThan(0);
    // Unscaled: a pixel radius and percentage centres, so dots stay round on any card.
    const c = dots.querySelector("circle")!;
    expect(c.getAttribute("cx")).toMatch(/%$/);
    expect(c.closest("svg")!.getAttribute("viewBox")).toBeNull();
    expect(dots.querySelectorAll("rect")).toHaveLength(0);
  });

  it("is identical on every render — no random marks to mismatch on hydration", () => {
    const a = render(<ChartGhost />).container.innerHTML;
    const b = render(<ChartGhost />).container.innerHTML;
    expect(a).toBe(b);
  });
});
