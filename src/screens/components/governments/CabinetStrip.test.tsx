// Layout guard for the aligned CabinetStrip — the variant that sits under a date-axis chart
// and whose ONLY job is that band N lines up with what the chart draws above band N.
//
// The invariant: each pill's tenure share is an inline percentage on a DIRECT CHILD of the
// flex strip, and those shares tile the whole window. It is asserted TWICE, once per pointer
// mode, because the shared Tooltip renders a different tree on touch: it inserts a wrapper
// <span> around its child, and a percentage width sitting on the child then resolves against
// that span's content width instead of the strip's — every pill collapses to the width of its
// own label, the strip stops tiling, and the bands stop meaning anything. On phones only, at
// a 200, with nothing else on the page to indicate it.
//
// The pixel label threshold is the same story from the other side: at 8% of the span a label
// was 64px under a full-width chart and 23px inside a phone-width card, where every Bulgarian
// surname rendered as "Б…".

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Government } from "@/data/governments/useGovernments";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({ colorFor: () => "#123456" }),
}));
// Mutable so the slot cases below can exercise BOTH band heights (the strip is
// h-24 on a phone, h-14 above it). Defaults to false, which is what the
// alignment cases above assume.
const media = vi.hoisted(() => ({ isSmall: false }));
vi.mock("@/ux/useMediaQueryMatch", () => ({
  useMediaQueryMatch: () => media.isSmall,
}));
// The pill tooltip pulls in MP avatars and the parliament roster; it is only mounted once a
// pill is opened, which this layout guard never does.
vi.mock("@/data/parliament/useMps", () => ({ useMps: () => ({ data: [] }) }));

import { CabinetStrip, CabinetStripSlot } from "./GovernmentTimeline";
import { TouchProvider } from "@/ux/TouchProvider";
import { TooltipProvider } from "@/components/ui/tooltip";

const gov = (id: string, start: string, end: string | null): Government => ({
  id,
  pmBg: `ПМ ${id}`,
  pmEn: `PM ${id}`,
  startDate: start,
  endDate: end,
  type: "regular",
  parties: ["gerb"],
  partiesEn: ["GERB"],
  endReason: "election",
  endReasonBg: "",
  endReasonEn: "",
  source: "",
});

// A long cabinet, a short caretaker-length one, and a long tail — the mix that made the
// collapse obvious: the middle pill has almost no label to be sized by.
const GOVS = [
  gov("a", "2009-07-27", "2013-03-13"),
  gov("b", "2013-03-13", "2013-05-29"),
  gov("c", "2013-05-29", "2017-05-04"),
];
const DOMAIN: [number, number] = [2009.57, 2017.34];

const widths = (container: HTMLElement): number[] => {
  const strip = container.querySelector("div.flex.mb-1.rounded");
  expect(strip, "the aligned strip did not render").not.toBeNull();
  return [...strip!.children].map((c) => {
    const w = (c as HTMLElement).style.width;
    expect(
      w,
      "a pill's tenure share is not on a direct child of the strip",
    ).toMatch(/%$/);
    return parseFloat(w);
  });
};

const renderStrip = (isTouch: boolean) => {
  // jsdom has neither of these; the strip measures itself, and TouchProvider resolves
  // (pointer: coarse) on mount.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: isTouch,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  const r = render(
    <TouchProvider>
      <TooltipProvider>
        <CabinetStrip
          governments={GOVS}
          xDomain={DOMAIN}
          lang="bg"
          compact
          fullWidth
        />
      </TooltipProvider>
    </TouchProvider>,
  );
  vi.unstubAllGlobals();
  return r;
};

describe("CabinetStrip (aligned)", () => {
  it.each([
    ["a fine pointer", false],
    ["a coarse pointer", true],
  ])(
    "tiles the whole window with per-cabinet shares on %s",
    (_label, touch) => {
      const { container } = renderStrip(touch as boolean);
      const w = widths(container);
      expect(w).toHaveLength(GOVS.length);
      // Every cabinet keeps a share proportional to its tenure, and together they cover the
      // window. Without this the touch tree silently sizes each pill by its own text.
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
      expect(w[0]).toBeGreaterThan(w[1]);
      expect(w[2]).toBeGreaterThan(w[1]);
    },
  );

  it("suppresses compact labels until the strip has been measured", () => {
    // jsdom reports offsetWidth 0, so nothing is measured and no label may render — the
    // deliberate no-fallback-guess behaviour. A latched guess is what printed "Б…" rows.
    const { container } = renderStrip(false);
    expect(container.textContent?.trim()).toBe("");
  });
});

// /indicators/compare renders the strip only once governments.json has landed. Rendering
// the whole SECTION conditionally meant that arrival inserted 149px above a page that was
// already laid out and moved all of it down — 0.1267 of that page's 0.1531 CLS, in every
// run of the measurement (built dist, Pixel 5, 150ms RTT, 1.6Mbps, 4x CPU, served at the
// electionsbg.com origin). The slot holds the band open from first paint instead.
//
// What is asserted is not a pixel count but that the two agree: the slot renders the same
// band the loaded strip does, at both viewport sizes. A height copied into the call site
// would pass a fixed-number test and still drift the day the strip's own class changes.
const bandClasses = (container: HTMLElement): string[] => {
  const band = container.querySelector("div.flex.mb-1.rounded");
  expect(band, "no strip band rendered").not.toBeNull();
  return (
    [...band!.classList]
      // The loaded strip sizes its band to its pills (w-max inside the scroll container);
      // the empty slot has none to size to. Width is not what reserves vertical space.
      .filter((c) => !c.startsWith("w-"))
      .sort()
  );
};

describe("CabinetStripSlot", () => {
  it.each([
    ["above sm — the h-14 band", false, false],
    ["phone width — the h-24 scrolling band", true, false],
    // No screen passes both flags today. Asserted anyway because the height
    // rule resolves them in a set order, and the slot has to resolve it the
    // same way or the first screen that does gets a shift back.
    ["compact, above sm", false, true],
    ["compact, phone width", true, true],
  ])(
    "reserves the same band the loaded strip renders, %s",
    (_label, small, compact) => {
      media.isSmall = small as boolean;
      // Same jsdom gaps renderStrip papers over: the strip measures itself, and
      // TouchProvider resolves (pointer: coarse) on mount.
      if (!window.ResizeObserver) {
        window.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        } as unknown as typeof ResizeObserver;
      }
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        })),
      );
      try {
        const loaded = render(
          <TouchProvider>
            <TooltipProvider>
              <CabinetStrip
                governments={GOVS}
                xDomain={DOMAIN}
                lang="bg"
                mobileScrollable
                compact={compact as boolean}
                fullWidth
              />
            </TooltipProvider>
          </TouchProvider>,
        );
        const slot = render(
          <CabinetStripSlot mobileScrollable compact={compact as boolean} />,
        );
        expect(bandClasses(slot.container)).toEqual(
          bandClasses(loaded.container),
        );
        // The phone variant's band sits inside a scroll container that adds its own
        // padding to the reserved height, so the slot has to reproduce that too.
        expect(!!slot.container.querySelector("div.overflow-x-auto.pb-1")).toBe(
          !!loaded.container.querySelector("div.overflow-x-auto.pb-1"),
        );
      } finally {
        media.isSmall = false;
        vi.unstubAllGlobals();
      }
    },
  );
});
