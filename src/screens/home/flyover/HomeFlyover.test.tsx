// The band's four states, and the two contracts that make it safe to put on `/`.
//
// What matters here is not that it draws — the engine's own suite covers that with a recording
// context — but that it does NOT draw, and does not fetch, until every arming condition holds.
// The poster is the default state; the canvas is the exception.

import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_WORLD } from "@/lib/flyover/testWorld";
import type { FlyoverWorld } from "@/lib/flyover/types";

const stub = vi.hoisted(() => ({
  armed: false,
  running: false,
  reducedMotion: false,
  world: undefined as FlyoverWorld | undefined,
  fetches: 0,
}));

vi.mock("./useArm", () => ({
  useArm: () => ({
    ref: { current: null },
    armed: stub.armed,
    running: stub.running,
    reducedMotion: stub.reducedMotion,
  }),
}));

vi.mock("./useFlyoverArtifact", () => ({
  useFlyoverArtifact: (armed: boolean) => {
    // The real hook passes `armed` to react-query's `enabled`; counting calls with it true is
    // how this file asserts „no request before the band arms" without a network layer.
    if (armed) stub.fetches += 1;
    return { world: armed ? stub.world : undefined, settled: armed };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Key + args, so no assertion can pass on a coincidental piece of copy.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length
        ? `${key}(${Object.keys(opts).sort().join(",")})`
        : key,
    i18n: { language: "bg" },
  }),
}));

const { HomeFlyover } = await import("./HomeFlyover");

const renderBand = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <HomeFlyover />
    </MemoryRouter>,
  );

beforeEach(() => {
  stub.armed = false;
  stub.running = false;
  stub.reducedMotion = false;
  stub.world = TEST_WORLD;
  stub.fetches = 0;
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the flyover band", () => {
  it("renders a poster in a reserved box before anything arms", () => {
    renderBand();
    const img = screen.getByRole("presentation", { hidden: true });
    expect(img.getAttribute("src")).toMatch(
      /^\/flyover\/(columns|arcs|tour)\.webp$/,
    );
    // ⚠️ The intrinsic size is what reserves the box. Without both attributes the browser
    // lays the image out at zero height and then reflows — on a band that sits ABOVE the
    // eight destination tiles, which is the worst place on the site to spend CLS.
    expect(img.getAttribute("width")).toBe("1000");
    expect(img.getAttribute("height")).toBe("625");
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("does not fetch the artifact until the band arms", () => {
    // `/`'s first paint is budgeted at exactly two GCS requests. This object is the third.
    renderBand();
    expect(stub.fetches).toBe(0);
    // ⚠️ Unmount first. Two `render()` calls leave TWO trees in one document, after which
    // `querySelector` answers about whichever mounted first and `getAllByRole` sees six
    // buttons — a test that measures the wrong tree while looking like it measures a change.
    cleanup();
    stub.armed = true;
    renderBand();
    expect(stub.fetches).toBeGreaterThan(0);
  });

  it("mounts the canvas only once armed AND the artifact has arrived", () => {
    stub.armed = true;
    stub.world = undefined;
    renderBand();
    expect(document.querySelector("canvas")).toBeNull();
    cleanup();
    stub.world = TEST_WORLD;
    renderBand();
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  it("schedules no animation frame in the state a reduced-motion reader is in", () => {
    // ⚠️ THE REDUCED-MOTION GUARANTEE IS MEASURED IN `useArm.test.ts`, NOT HERE. `useArm` is
    // mocked in this file, so setting `reducedMotion: true` alongside `armed: true` would be
    // a triple the real hook cannot return — a test that passes whether or not the production
    // gate exists. What the real hook returns under reduced motion is „not armed", and this
    // is what the band does with that: no canvas, no frame.
    const raf = vi.spyOn(window, "requestAnimationFrame");
    stub.armed = false;
    stub.running = false;
    stub.reducedMotion = true;
    renderBand();
    expect(raf).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("schedules one when motion is allowed", () => {
    // The mirror of the assertion above — without it, a band that had stopped animating
    // entirely would satisfy the reduced-motion test perfectly.
    const raf = vi.spyOn(window, "requestAnimationFrame");
    stub.armed = true;
    stub.running = true;
    renderBand();
    expect(raf).toHaveBeenCalled();
  });

  it("stops animating when the document is hidden, without unmounting", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    stub.armed = true;
    stub.running = false;
    renderBand();
    expect(raf).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  it("changes the poster when the reader picks another scene", () => {
    // The switch must work in EVERY state, reduced motion included — it is how a reader who
    // will never see the animation reaches the other two pictures.
    stub.reducedMotion = true;
    renderBand();
    const before = screen
      .getByRole("presentation", { hidden: true })
      .getAttribute("src");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    const other = buttons.find(
      (b) => b.getAttribute("aria-pressed") === "false",
    )!;
    act(() => other.click());
    expect(
      screen.getByRole("presentation", { hidden: true }).getAttribute("src"),
    ).not.toBe(before);
  });

  it("marks exactly one switch button as pressed", () => {
    renderBand();
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("honours ?scene= over the rotation, for capture and tests", () => {
    renderBand("?scene=arcs");
    expect(
      screen.getByRole("presentation", { hidden: true }).getAttribute("src"),
    ).toBe("/flyover/arcs.webp");
  });

  it("falls back to the rotation for a ?scene= it does not know", () => {
    // The value comes straight out of a URL; the failure must be „the usual scene", never an
    // empty band.
    renderBand("?scene=satellite");
    expect(
      screen.getByRole("presentation", { hidden: true }).getAttribute("src"),
    ).toMatch(/^\/flyover\/(columns|arcs|tour)\.webp$/);
  });

  it("renders the caption as DOM text through t(), never on the canvas", () => {
    stub.armed = true;
    renderBand();
    const caption = document.querySelector("[data-flyover-caption]")!;
    expect(caption.getAttribute("data-flyover-caption")).toMatch(
      /^flyover_caption_/,
    );
    // The mocked `t` returns key + arg names, so this asserts the params reached it.
    expect(caption.textContent).toContain("flyover_caption_");
    expect(caption.getAttribute("aria-live")).toBe("polite");
  });

  it("labels the picture with the caption a reader can also read", () => {
    stub.armed = true;
    renderBand();
    const band = screen.getByRole("img");
    const caption = document.querySelector("[data-flyover-caption]")!;
    expect(band.getAttribute("aria-label")).toBe(caption.textContent);
  });

  it("says something even with no artifact at all", () => {
    // A checkout that never ran the generator, or an unpublished bucket object: the band
    // stays on its poster and the label falls back to a description of the picture.
    stub.armed = true;
    stub.world = undefined;
    renderBand();
    // Per SCENE: the copy describes a specific picture, and the switch works in every state,
    // so one string for all three is wrong for two of them — for the reader who cannot check.
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /^flyover_alt_(columns|arcs|tour)$/,
    );
    const band = screen.getByRole("img").getAttribute("aria-label");
    const shown = document
      .querySelector("[data-flyover-band]")!
      .getAttribute("data-flyover-band");
    expect(band).toBe(`flyover_alt_${shown}`);
  });
});
