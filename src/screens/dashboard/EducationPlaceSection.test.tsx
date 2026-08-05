// The section is where the disclosure lives: three of the 28 region pages show
// Sofia city's numbers and one shows Plovdiv province's, and a reader has to be
// told. It is also the last gate before a place with no data renders an empty
// card — hence the self-hide cases.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initTestI18n } from "./testI18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EducationPlaceSection } from "./EducationPlaceSection";
import type { EducationPlace } from "@/data/schools/useEducationPlace";

beforeAll(() => initTestI18n());

const blob = (over: Partial<EducationPlace> = {}): EducationPlace => ({
  grain: "region",
  code: "SML",
  latestYear: 2026,
  avg: 4.55,
  examinees: 743,
  schools: 22,
  rank: 2,
  rankOf: 28,
  nationalAvg: 4.33,
  series: [
    { year: 2022, avg: 4.12, examinees: 800, schools: 22 },
    { year: 2026, avg: 4.55, examinees: 743, schools: 22 },
  ],
  shareInFailingSchools: 0,
  rankable: 20,
  byObshtina: [],
  top: [],
  bottom: [],
  above: [],
  meanResidual: 0.12,
  va: { covered: 0, meanResidual: null, rows: [] },
  ...over,
});

const renderSection = (code: string, body: EducationPlace | null) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <EducationPlaceSection code={code} />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("EducationPlaceSection", () => {
  it("renders the education block for an ordinary oblast, with no alias note", async () => {
    renderSection("SML", blob());
    await waitFor(() =>
      expect(screen.getByText("Образование")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Столична община общо/)).not.toBeInTheDocument();
    expect(screen.queryByText(/област Пловдив общо/)).not.toBeInTheDocument();
  });

  it.each(["S23", "S24", "S25"])(
    "says whose numbers these are on the %s page",
    async (mir) => {
      // S23 needs it as much as the other two: the page is headed "София 23
      // МИР" while the numbers are Столична община's, and the МИР code merely
      // happens to equal the key the corpus stores the city under.
      renderSection(mir, blob({ code: "S23" }));
      await waitFor(() =>
        expect(screen.getByText(/Столична община общо/)).toBeInTheDocument(),
      );
    },
  );

  it("says the same for the Plovdiv city constituency", async () => {
    renderSection("PDV-00", blob({ code: "PDV" }));
    await waitFor(() =>
      expect(screen.getByText(/област Пловдив общо/)).toBeInTheDocument(),
    );
  });

  it("renders nothing when the place has no blob", async () => {
    const { container } = renderSection("BLG99", null);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("still renders the headline when the second tile self-hides", async () => {
    // 28 município blobs have no residual at all; the expected tile returns
    // null for them and the section must not collapse with it.
    renderSection("BLG40", blob({ meanResidual: null, rankable: 0 }));
    await waitFor(() =>
      expect(screen.getByText("Образование")).toBeInTheDocument(),
    );
    expect(screen.getByText("4,55")).toBeInTheDocument();
    expect(screen.queryByText("Над очакваното")).not.toBeInTheDocument();
  });

  it("renders nothing when the request fails, but says so in the console", async () => {
    // A cloud database mid-rollout must look like a page without an education
    // section, not like a broken card — and must not be silent about it, or a
    // skipped db:load:schools:pg:cloud deletes the feature from 28 pages at a
    // 200 with nothing red anywhere.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <EducationPlaceSection code="SML" />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("education:place-read-failed"),
      ),
    );
  });
});
