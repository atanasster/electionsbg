// Which levels ask for a transfer shard, and what happens when there is none.
//
// ⚠ THE FETCH IS THE ASSERTION, not the rendered output. Every state but `ready` renders null,
// so „nothing on screen" is satisfied by a component that fetched all five levels and got five
// 404s — which is 4 wasted requests per page view against a bucket, on a level the producer has
// no arm for at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresidentialPlaceTransfer } from "./PresidentialPlaceTransfer";
import { TRANSFER_LEVELS } from "./transferLevels";
import { __resetOblastTransferWarnings } from "@/data/presidential/useOblastTransfer";
import type { PresidentialPlaceLevel } from "./PresidentialPlaceScreen";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const MATRIX = {
  fromNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 10 }],
  toNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 12 }],
  flows: [{ from: "t6", to: "t6", votes: 10 }],
};

const shard = {
  cycle: "2021_11_14_pvr",
  oblast: "BGS",
  basis: "БЪЛГАРСКАТА ОГРАДА",
  basisEn: "THE ENGLISH CAVEAT",
  finalists: [
    { number: 6, president: "Р", votes: 12 },
    { number: 15, president: "Г", votes: 6 },
  ],
  sections: 760,
  coverage: {
    basis: "ОБХВАТ БГ",
    basisEn: "COVERAGE EN",
    unplacedSectionsInCycle: 0,
    unplacedVotesInCycle: 0,
    abroadVotesInCycle: 127572,
  },
  matrix: MATRIX,
  droppedVotes: 76,
  marginGap: 0.107,
  rasResidual: 1e-8,
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(
    async () => new Response(JSON.stringify(shard), { status: 200 }),
  );
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  // ⚠ jsdom HAS NO `matchMedia`, and the tile's chart calls it during the first render — so
  // without this the lazy tile throws before any assertion runs.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
});

afterEach(async () => {
  __resetOblastTransferWarnings();
  vi.restoreAllMocks();
  // ⚠ THE LANGUAGE IS GLOBAL i18next STATE — one `changeLanguage("en")` below leaks into
  // whichever test runs next, and the Bulgarian assertions then fail in an order-dependent way
  // that reads as a component bug.
  await i18n.changeLanguage("bg");
});

const mount = (level: PresidentialPlaceLevel, id: string | undefined = "BGS") =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          })
        }
      >
        <TooltipProvider>
          <PresidentialPlaceTransfer
            cycle="2021_11_14_pvr"
            level={level}
            id={id}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("PresidentialPlaceTransfer", () => {
  it("asks for a shard on a REGION page and renders the estimate's own caveat", async () => {
    mount("region");
    // ⚠ THE CAVEAT FROM THE SHARD, not from a locale file. A region page fetches this file and
    // nothing else, so there is no cycle file in the document to fall back on.
    expect(await screen.findByText("БЪЛГАРСКАТА ОГРАДА")).toBeTruthy();
    expect(screen.getByText(/ОБХВАТ БГ/)).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      "2021_11_14_pvr/runoff_transfer/BGS.json",
    );
  });

  it.each(["municipality", "settlement", "section", "abroad"] as const)(
    "asks for NOTHING at %s — the regression is fitted per oblast",
    async (level) => {
      // ⚠⚠ THE REQUEST, NOT THE RENDER. Every non-ready state renders null, so „nothing on
      // screen" is also satisfied by four 404s per page view against a tree that has no arm
      // below the oblast at all.
      mount(level, "BGS04");
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    },
  );

  it("renders NOTHING when the shard is not published", async () => {
    // ⚠ THE ORDINARY ANSWER. `data/*_pvr` is gitignored and reaches the bucket only through
    // `bucket:gz`; a heading over an empty box would report a routine absence as a defect.
    fetchSpy.mockResolvedValue(new Response("", { status: 404 }));
    mount("region");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("renders NOTHING when the shard lost a caveat, rather than a chart without one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ...shard, coverage: { basis: "", basisEn: "" } }),
        { status: 200 },
      ),
    );
    mount("region");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("names the cycle-wide refusal, and suppresses it at zero", async () => {
    // ⚠⚠ THE CLAUSE THIS TILE EXISTS TO GET RIGHT, and the fixture's zeros meant only the
    // suppressed branch had ever rendered. On 2011 Sofia it is the difference between a
    // truthful page and a misleading one: 1,355 sections / 422,726 votes outside, against
    // 32,024 inside Sofia's three shards.
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...shard,
          coverage: {
            ...shard.coverage,
            unplacedSectionsInCycle: 1355,
            unplacedVotesInCycle: 422726,
          },
        }),
        { status: 200 },
      ),
    );
    mount("region");
    expect(await screen.findByText(/422\s*726/)).toBeTruthy();
    // ⚠ THE MUTATION CHECK: „it renders" is also satisfied by a clause that ALWAYS renders,
    // which would print „0 refused" on the four cycles that refuse nothing.
    cleanup();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(shard), { status: 200 }),
    );
    mount("region");
    await screen.findByText("БЪЛГАРСКАТА ОГРАДА");
    expect(screen.queryByText(/422\s*726/)).toBeNull();
  });

  it("names the abroad votes, which are outside every matrix", async () => {
    // ⚠ THE COUNTRY TILE PRINTS THIS NUMBER and an earlier cut of the region tile did not, so
    // the two made different completeness claims about the same estimate. 127,572 on 2021 is
    // larger than several oblasts' entire runoff vote.
    mount("region");
    expect(await screen.findByText(/127\s*572/)).toBeTruthy();
  });

  it("switches BOTH shard sentences to English", async () => {
    // ⚠ THE REGION PAGE NEEDS ITS CAVEATS MORE, not less: there is no cycle file in the
    // document to fall back on, and the tile renders `isEn ? …En : …` on two separate lines.
    await i18n.changeLanguage("en");
    mount("region");
    expect(await screen.findByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.getByText(/COVERAGE EN/)).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
  });

  it("declares exactly the levels the producer has an arm for", () => {
    // ⚠ THE MUTATION CHECK for the two cases above: „municipality asks for nothing" is also
    // satisfied by a set that had silently become empty, which would take the region page's
    // section with it.
    expect([...TRANSFER_LEVELS]).toEqual(["region"]);
  });
});
