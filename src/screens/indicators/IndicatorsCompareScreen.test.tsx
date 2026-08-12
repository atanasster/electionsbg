// The largest term of this page's CLS fix lives at the CALL SITE, not in a
// component: the cabinet-strip section renders unconditionally, with the strip's
// band held open as a slot until governments.json lands. Rendering the section
// itself conditionally — which is what this page used to do — inserted 149px
// above an already-laid-out body and was 0.1267 of the page's 0.1531 CLS, the
// one term present in every measured run.
//
// Nothing else covers that. CabinetStrip.test.tsx proves the slot renders the
// same band as the loaded strip; it never renders this screen, so re-wrapping
// the section in a conditional would regress the largest part of the fix with
// every other test green.
//
// The repo's Playwright CLS gate cannot cover it either, and that is measured,
// not assumed: tests/perf.spec.ts serves dist from the firebase emulator at
// 127.0.0.1, and the data bucket sends no access-control-allow-origin for a
// localhost origin. Every payload fails CORS there, so the page never leaves
// its placeholder state and the growth a gate would need to see cannot happen —
// such a gate passes with the fix reverted. Re-run the real measurement with
// `npm run perf:cls -- /indicators/compare`, which serves dist at the
// electionsbg.com origin.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
// The strip's own layout is covered by CabinetStrip.test.tsx; here only its
// presence and height matter, and the real one pulls in the MP roster.
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({ colorFor: () => "#123456" }),
}));
vi.mock("@/data/parliament/useMps", () => ({ useMps: () => ({ data: [] }) }));
vi.mock("@/ux/useMediaQueryMatch", () => ({ useMediaQueryMatch: () => false }));

import { IndicatorsCompareScreen } from "./IndicatorsCompareScreen";

const renderScreen = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <IndicatorsCompareScreen />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  // Never settles: the window between first paint and governments.json landing.
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise<Response>(() => {}),
  );
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("IndicatorsCompareScreen — the cabinet strip's slot", () => {
  it("renders the strip's section from first paint, before governments.json lands", () => {
    const { container } = renderScreen();
    // The caption is a translation key with no data behind it, so its presence
    // is the cheapest proof the section itself rendered rather than the page
    // having skipped it until the payload arrived.
    expect(container.textContent).toContain("eu_compare_cabinet_anchor_label");
  });

  it("holds the band open at the height the loaded strip will occupy", () => {
    const { container } = renderScreen();
    // Same band the loaded CabinetStrip renders — h-14 above sm, per the mocked
    // media query. An empty section that merely EXISTS would satisfy the test
    // above while still shifting by the band's height on arrival.
    const band = container.querySelector("div.flex.mb-1.rounded");
    expect(band, "the strip's band is not being reserved").not.toBeNull();
    expect(band!.className).toContain("h-14");
  });
});
