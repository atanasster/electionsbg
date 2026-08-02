// `/municipality/:id` is the OBLAST dashboard despite its name, and an obshtina code shares
// the oblast's prefix (SHU = Шумен област, SHU11 = община Хитрино). Every failure here is
// SILENT — the screen used to render a titleless region dashboard at a 200, whose only trace
// was a console 404 for `/regions/SHU11_stats.json` and a soft-404 for crawlers. So the two
// properties worth pinning are the two branches that must NOT reach RegionDashboardCards:
//
//   1. an obshtina code redirects to the município page that can actually serve it;
//   2. a code that is neither oblast nor obshtina renders the app's 404 — and only ONCE
//      municipalities.json has arrived, since regions.json is bundled but that one is fetched
//      and a premature 404 would flash on every valid page load.
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

// The region dashboard and its header are heavy (maps, charts, a dozen fetches) and are not
// what this test is about — it only cares WHETHER they mount.
vi.mock("./dashboard/RegionDashboardCards", () => ({
  RegionDashboardCards: ({ regionCode }: { regionCode: string }) => (
    <div>region-dashboard:{regionCode}</div>
  ),
}));
vi.mock("@/screens/components/PlaceHeader", () => ({
  PlaceHeader: () => null,
}));
vi.mock("@/ux/SEO", () => ({ SEO: () => null }));

import { MunicipalitiesScreen } from "./MunicipalitiesScreen";

const MUNICIPALITIES = [
  { ekatte: "14516", name: "Хитрино", obshtina: "SHU11", oblast: "SHU" },
  { ekatte: "83510", name: "Шумен", obshtina: "SHU30", oblast: "SHU" },
];

// Resolves only when the test calls it — lets one case assert the pre-arrival render.
let releaseMunicipalities: () => void;
let municipalitiesArrived: Promise<void>;

beforeEach(() => {
  municipalitiesArrived = new Promise<void>((r) => (releaseMunicipalities = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("municipalities.json")) {
        await municipalitiesArrived;
        return new Response(JSON.stringify(MUNICIPALITIES), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const draw = (id: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/municipality/${id}?elections=x`]}>
        <Routes>
          <Route path="/municipality/:id" element={<MunicipalitiesScreen />} />
          <Route path="/settlement/:id" element={<div>settlement-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("MunicipalitiesScreen", () => {
  it("renders the region dashboard for a real oblast code", async () => {
    draw("SHU");
    releaseMunicipalities();
    await waitFor(() =>
      expect(screen.getByText("region-dashboard:SHU")).toBeInTheDocument(),
    );
  });

  it("redirects an obshtina code to its /settlement page", async () => {
    draw("SHU11");
    releaseMunicipalities();
    await waitFor(() =>
      expect(screen.getByText("settlement-page")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/region-dashboard/)).not.toBeInTheDocument();
  });

  it("404s an id that is neither oblast nor obshtina — but not before the municipalities land", async () => {
    draw("NOPE99");
    // municipalities.json is still in flight: nothing is rendered, and in particular the 404
    // is NOT shown yet.
    expect(screen.queryByText("page_not_found")).not.toBeInTheDocument();
    expect(screen.queryByText(/region-dashboard/)).not.toBeInTheDocument();

    releaseMunicipalities();
    await waitFor(() =>
      expect(screen.getByText("page_not_found")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/region-dashboard/)).not.toBeInTheDocument();
  });
});
