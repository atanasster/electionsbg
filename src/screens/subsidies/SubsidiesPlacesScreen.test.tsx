// /subsidies/places — the page the oblast choropleth moved to.
//
// Three of these assert the things the review found wrong the first time round, so
// they are gates rather than coverage: the scope must ride every in-page link, the
// „област на получателя" framing must survive, and the source line must not render
// its own i18n key.
//
// Assertions read the ENGLISH copy: i18next resolves to `en` under vitest, which is
// what the hub's own test does too. The framing gate below therefore checks the
// English half of the same sentence — the Bulgarian half is what ships, and the two
// are written together in the component, so a change that drops one drops both.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgriIndexFile } from "@/data/agri/types";

// The map draws through d3 + a fetched nation GeoJSON; neither is what this file is
// about, and the real component would need the network. The mock still renders the
// oblast names as buttons so the link/scope assertions below have something to read.
vi.mock("@/screens/components/subsidies/AgriOblastMap", () => ({
  AgriOblastMap: ({
    rows,
    onSelectOblast,
  }: {
    rows: { oblast: string }[];
    onSelectOblast?: (n: string) => void;
  }) => (
    <div data-testid="agri-map">
      {rows.map((r) => (
        <button key={r.oblast} onClick={() => onSelectOblast?.(r.oblast)}>
          {r.oblast}
        </button>
      ))}
    </div>
  ),
}));

const overview = (over: Partial<AgriIndexFile> = {}): AgriIndexFile =>
  ({
    generatedFrom: "data.egov.bg org 56 — ДФ „Земеделие“",
    bgnPerEur: 1.95583,
    scope: "2025",
    scopeYear: 2025,
    years: [2025, 2024],
    latestYear: 2025,
    headline: {
      totalEur: 1_000_000,
      entityEur: 600_000,
      individualEur: 400_000,
      entityCount: 10,
      individualCount: 20,
      topScheme: null,
    },
    totalsByYear: [],
    byScheme: [],
    byOblast: [
      { oblast: "Пловдив", totalEur: 500_000, share: 50 },
      { oblast: "София (столица)", totalEur: 300_000, share: 30 },
      { oblast: "Бургас", totalEur: 200_000, share: 20 },
    ],
    concentration: {
      year: 2025,
      scope: "2025",
      basis: "legal-entities",
      entityCount: 10,
      entityEur: 600_000,
      top1Share: 10,
      top10Share: 50,
      top100Share: 90,
      top1000Share: 100,
      lorenz: [],
    },
    topRecipients: [],
    ...over,
  }) as AgriIndexFile;

const fetchMock = vi.fn();
vi.mock("@/data/agri/fetchAgriPayload", () => ({
  fetchAgriPayload: (...a: unknown[]) => fetchMock(...a),
}));

const renderAt = async (url: string) => {
  const { SubsidiesPlacesScreen } = await import("./SubsidiesPlacesScreen");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/subsidies/places"
              element={<SubsidiesPlacesScreen />}
            />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

describe("SubsidiesPlacesScreen", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(overview());
  });

  it("ranks every oblast the payload carries", async () => {
    await renderAt("/subsidies/places");
    expect(await screen.findByTestId("agri-map")).toBeInTheDocument();
    // All three rows, not a truncated top-N: this page is the full ranking.
    for (const o of ["Пловдив", "София (столица)", "Бургас"])
      expect(screen.getAllByText(o).length).toBeGreaterThan(0);
  });

  it("carries ?pscope onto every browse link", async () => {
    // The defect this asserts against: a bare `/subsidies/browse?oblast=…` shows the
    // reader a 2016 ranking and lands them on the default year's payments.
    await renderAt("/subsidies/places?pscope=y:2023");
    // Match by the row's own text rather than by a URL-encoded Cyrillic needle: the
    // encoding is an implementation detail and asserting on it makes the test brittle
    // for a reason unrelated to what it is checking.
    // Wait for the RANKING, not merely for any link: findAllByRole resolves as soon
    // as the breadcrumb exists, which is before the payload lands.
    await screen.findByTestId("agri-map");
    const links = await screen.findAllByRole("link");
    const oblastLink = links.find((a) => a.textContent === "Пловдив");
    expect(oblastLink, "no ranking link for Пловдив").toBeTruthy();
    const href = oblastLink!.getAttribute("href") ?? "";
    expect(href).toContain("/subsidies/browse");
    expect(new URLSearchParams(href.split("?")[1]).get("pscope")).toBe(
      "y:2023",
    );
    expect(new URLSearchParams(href.split("?")[1]).get("oblast")).toBe(
      "Пловдив",
    );
  });

  it("names the recipient's province, never where the land is", async () => {
    await renderAt("/subsidies/places");
    // The framing plan §9 requires. „София (столица)" ranking high is a
    // registered-seat artefact, and the page has to say so rather than let the
    // reader infer that the capital farms.
    expect(
      await screen.findByText(/province of the RECIPIENT/),
    ).toBeInTheDocument();
  });
  it("has a data_source key in BOTH locale files", async () => {
    // Gated on the LOCALE FILES rather than on the render, deliberately. Under vitest
    // i18next resolves nothing — the breadcrumb renders the literal „nav_governance"
    // — so a rendered-text assertion here could never tell a missing key from the
    // test harness. The defect was real in the browser: `t("data_source")` printed
    // „data_source:" on this page and on the hub, because the key existed in neither
    // file, and since i18next returns the KEY (a truthy string) the
    // `t(...) || "Източник"` fallback every caller wrote was unreachable.
    const [bg, en] = await Promise.all([
      import("@/locales/bg/translation.json"),
      import("@/locales/en/translation.json"),
    ]);
    expect((bg.default as Record<string, string>).data_source).toBeTruthy();
    expect((en.default as Record<string, string>).data_source).toBeTruthy();
  });

  it("names the gap for a year the corpus does not cover", async () => {
    // agriScopeToKey returns null for 2019, so no query runs at all — the page must
    // say which years exist rather than spin or claim zero.
    await renderAt("/subsidies/places?pscope=y:2019");
    expect(
      await screen.findByText(/No subsidy data for 2019/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a retry when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await renderAt("/subsidies/places");
    expect(
      await screen.findByRole("button", { name: /Try again/ }),
    ).toBeInTheDocument();
  });

  it("says so when the period has no oblast breakdown at all", async () => {
    fetchMock.mockResolvedValue(overview({ byOblast: [] }));
    await renderAt("/subsidies/places");
    expect(
      await screen.findByText(/publishes no province breakdown/),
    ).toBeInTheDocument();
  });
});
