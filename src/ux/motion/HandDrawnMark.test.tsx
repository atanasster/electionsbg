import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandDrawnMark } from "./HandDrawnMark";

/** IntersectionObserver stub whose callback the test fires by hand. */
const stubObserver = () => {
  let fire: (visible: boolean) => void = () => {};
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        fire = (visible) => cb([{ isIntersecting: visible }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  return (visible: boolean) => act(() => fire(visible));
};

describe("HandDrawnMark", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the figure as plain readable text, the mark hidden from assistive tech", () => {
    stubObserver();
    const { container } = render(
      <HandDrawnMark seed="deficit">€2,1 млрд.</HandDrawnMark>,
    );
    expect(screen.getByText("€2,1 млрд.")).toBeTruthy();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("is hidden until scrolled into view, then drawn on", () => {
    const show = stubObserver();
    const { container } = render(
      <HandDrawnMark seed="deficit">€2,1 млрд.</HandDrawnMark>,
    );
    const path = () => container.querySelector("path")!;
    expect(path().getAttribute("class")).toBe("opacity-0");
    show(true);
    expect(path().getAttribute("class")).toBe("motion-draw-on");
  });

  it("strokes in the figure's own colour", () => {
    stubObserver();
    const { container } = render(<HandDrawnMark seed="x">42%</HandDrawnMark>);
    expect(container.querySelector("path")!.getAttribute("stroke")).toBe(
      "currentColor",
    );
  });
});
