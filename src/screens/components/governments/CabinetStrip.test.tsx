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
vi.mock("@/ux/useMediaQueryMatch", () => ({ useMediaQueryMatch: () => false }));
// The pill tooltip pulls in MP avatars and the parliament roster; it is only mounted once a
// pill is opened, which this layout guard never does.
vi.mock("@/data/parliament/useMps", () => ({ useMps: () => ({ data: [] }) }));

import { CabinetStrip } from "./GovernmentTimeline";
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
