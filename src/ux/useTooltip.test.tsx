// `useTooltip` positions with PAGE coordinates, so it must not resolve against a positioned
// ancestor.
//
// ⚠ THE BUG THIS PINS RENDERED A CORRECT TOOLTIP IN THE WRONG PLACE, which is worse than none.
// The node is `position: absolute` with `left`/`top` taken from `pageX`/`pageY`, and `absolute`
// resolves against the nearest POSITIONED ancestor rather than the document — so any caller
// inside a positioned box got the tooltip offset by that box's own distance down the page.
// Measured on `/presidential/:cycle/region/:oblast`, which mounts two maps each in a `relative`
// `MeasuredMapBox`: hovering the FIRST map put its tooltip on top of the SECOND one, reading
// „1-и тур" while the cursor was on the round-2 map, and the second map's tooltip landed below
// the fold and could not be seen at all. The first is an attribution error, not a cosmetic one.
//
// ⚠ IT LOOKED FINE IN ~55 OTHER CALLERS, so „it works on the pages I checked" proves nothing
// here: they render inside a `StatCard` whose box is not positioned, so the offset parent
// happened to be the body and the page coordinates happened to be right. The defect was latent
// everywhere and surfaced the first time a caller sat inside a positioned box.

import { beforeAll, describe, expect, it } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useTooltip } from "./useTooltip";

// ⚠ THE VIEWPORT IS PINNED, because jsdom reports `innerHeight` as 0 and every element at zero
// size. `calcCoordinates` clamps the tooltip into the viewport, so at height 0 the clamp fires
// on EVERY input and pins `top` to 0 — the arithmetic under test never runs, and an exact-offset
// assertion becomes a test of jsdom's defaults. A viewport taller than the coordinates used
// below puts the clamp out of the way, which is the case this file is about.
beforeAll(() => {
  Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 2000, writable: true });
});

/** ⚠ THE COORDINATES ARE PASSED EXPLICITLY, NOT READ OFF THE EVENT. `pageX`/`pageY` are
 *  read-only and derived — `MouseEvent`'s init dict ignores them — so `fireEvent.mouseEnter(el,
 *  { pageY: 900 })` delivers an event whose `pageY` is 0, and a harness that forwarded
 *  `e.pageY` would silently test the hook with (0, 0) and pass against any implementation.
 *  Every real caller passes the numbers the same way. */
const AT = { pageX: 100, pageY: 900 };

const Harness = () => {
  const { tooltip, ...events } = useTooltip();
  return (
    // ⚠ THE `relative` IS THE POINT OF THE FIXTURE — it is `MeasuredMapBox`, standing in for
    // every caller that has a positioned ancestor. Without it this test passes against the
    // broken implementation.
    <div className="relative" data-testid="positioned-box">
      <button
        onMouseEnter={() => events.onMouseEnter(AT, "hello")}
        onMouseLeave={events.onMouseLeave}
      >
        hover me
      </button>
      {tooltip}
    </div>
  );
};

describe("the map tooltip", () => {
  it("renders into document.body, not inside its caller's positioned box", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.mouseEnter(screen.getByText("hover me"));

    const tip = screen.getByText("hello").closest("div")!;
    // The claim: the offset parent is the document body, so `top: <pageY>` means what it says.
    expect(tip.parentElement).toBe(document.body);
    expect(getByTestId("positioned-box").contains(tip)).toBe(false);
  });

  it("places itself at the pointer, offset by the gap", () => {
    render(<Harness />);
    fireEvent.mouseEnter(screen.getByText("hover me"));
    const tip = screen.getByText("hello").closest("div") as HTMLElement;
    // ⚠ ASSERTED AS AN EXACT OFFSET, not „is positioned": `left`/`top` are the page coordinates
    // plus the 15px gap, with the viewport pinned above so the clamp stays out of it. A test
    // that only checked for a `top` at all would pass against the broken version too — that one
    // also set a top, just measured from the wrong box.
    expect(tip.style.top).toBe("915px");
    expect(tip.style.left).toBe("115px");
  });

  it("leaves nothing behind in the body when the pointer leaves", () => {
    // A portalled node that outlives its trigger is a tooltip stuck over the page.
    render(<Harness />);
    const trigger = screen.getByText("hover me");
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByText("hello")).not.toBeNull();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText("hello")).toBeNull();
  });
});
