// The section is where the disclosure lives: three of the 28 region pages show
// Sofia city's numbers and one shows Plovdiv province's, and a reader has to be
// told. It is also the last gate before a place with no data renders an empty
// card — hence the self-hide cases.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
  provisional: false,
  rankable: 20,
  byObshtina: [],
  top: [],
  bottom: [],
  above: [],
  meanResidual: 0.12,
  va: { covered: 0, meanResidual: null, rows: [] },
  ...over,
});

const renderSection = (
  code: string,
  body: EducationPlace | null,
  chrome?: "section" | "none",
) => {
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
          <EducationPlaceSection code={code} chrome={chrome} />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("the section is actually mounted on the place nodes", () => {
  // Source-level, like the shard-merge guard in stale_base_keys.test.ts: a full
  // MyAreaScreen mount would need stubs for ~25 sibling tiles, and what can
  // silently regress here is the wiring, not the rendering. Both call sites are
  // pinned — including the props, since passing the wrong code or dropping
  // `chrome` would look right in a diff.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("names the fallback place, so a village says whose figures it shows", () => {
    const src = read("../myarea/MyAreaScreen.tsx");
    expect(src).toMatch(/fallbackLabel=\{muniLabel\}/);
  });

  it("is on the place node, settlement-first with the município behind it", () => {
    const src = read("../myarea/MyAreaScreen.tsx");
    expect(src).toMatch(
      /code=\{area\.kind === "settlement" \? area\.ekatte : area\.obshtina\}/,
    );
    expect(src).toMatch(/fallbackCode=\{area\.obshtina\}/);
    expect(src).toMatch(/chrome="none"/);
  });

  it("is on the region node, oblast-scoped and inside its section", () => {
    const src = read("./RegionGovernanceCards.tsx");
    expect(src).toMatch(/<EducationPlaceSection code=\{regionCode\} \/>/);
  });
});

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

  it("drops the section kicker where the page has none", async () => {
    // The município node is a flat run of cards; an "ОБРАЗОВАНИЕ" header would
    // be the only one on the page.
    renderSection("SML10", blob({ grain: "muni" }), "none");
    await waitFor(() => expect(screen.getByText("4,55")).toBeInTheDocument());
    expect(screen.queryByText("Образование")).not.toBeInTheDocument();
  });

  it("reads Столична община on a Sofia район page, and says so", async () => {
    // The 24 районы are obshtina codes with their own place pages, and МОН
    // publishes none of them separately.
    renderSection("S2309", blob({ grain: "muni", code: "SOF00" }), "none");
    await waitFor(() =>
      expect(screen.getByText(/не за този район/)).toBeInTheDocument(),
    );
    // The МИР wording belongs to the region pages, not here.
    expect(screen.queryByText(/не за този МИР/)).not.toBeInTheDocument();
  });

  it("fetches the city aggregate for a Sofia район, not the район code", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => blob({ grain: "muni", code: "SOF00" }),
    } as Response);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <EducationPlaceSection code="S2317" chrome="none" />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0][0])).toContain("key=SOF00");
  });

  it("falls back to the município when a settlement has no school", async () => {
    // ~4,700 of ~5,000 settlements. The second request only fires once the
    // first comes back empty, and the disclosure is what keeps a village page
    // from stating the município's average as its own.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(input).includes("key=00028")
            ? null
            : blob({ grain: "muni", code: "LOV18" }),
      } as Response),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <EducationPlaceSection
              code="00028"
              fallbackCode="LOV18"
              fallbackLabel="община Ловеч"
              chrome="none"
            />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/числата са за община Ловеч/),
      ).toBeInTheDocument(),
    );
    const keys = spy.mock.calls.map((c) => String(c[0]));
    expect(keys.some((k) => k.includes("key=00028"))).toBe(true);
    expect(keys.some((k) => k.includes("key=LOV18"))).toBe(true);
  });

  it("does not ask the município when the settlement has its own", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => blob({ grain: "settlement", code: "02676" }),
    } as Response);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <EducationPlaceSection
              code="02676"
              fallbackCode="BLG01"
              chrome="none"
            />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("4,55")).toBeInTheDocument());
    expect(screen.queryByText(/няма училище с матура/)).not.toBeInTheDocument();
    expect(
      spy.mock.calls.map((c) => String(c[0])).some((k) => k.includes("BLG01")),
    ).toBe(false);
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
