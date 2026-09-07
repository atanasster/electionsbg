// The place page's WIRING — which id it asks the surface layer for, and what it says when
// there is nothing to show.
//
// ⚠ THE ABROAD ARM IS THE ONE WORTH PINNING. Its route carries no id and its artifact needs
// one, so the screen supplies a constant; get that wrong and the page fetches a file nobody
// wrote and renders a skeleton for ever — the failure mode `useElectionSurface` calls
// `pending`, which is deliberately NOT a fallback and therefore never resolves on its own.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { MAP_ADAPTERS } from "@/screens/elections/electionMapSlots";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialPlaceScreen } from "./PresidentialPlaceScreen";
import { PRESIDENTIAL_ABROAD_ID } from "@/data/elections/presidentialRoutes";
import type { PresidentialPlaceLevel } from "./PresidentialPlaceScreen";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { artifactPath } from "@/data/elections/surfacePath";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Every level this screen serves, with the route that reaches it.
 *
 *  ⚠ THE LEVEL IS THE AXIS. The whole design is „one component, five levels", so testing two
 *  of them tests the design at 40%. `section` is the one that differs most: it is the only
 *  level passing `withMap={false}`, and its artifact lives at the sharded
 *  `…/section/by-oblast/<2-char>/<code>.json`, a prefix split no other level drives. */
const LEVELS = [
  {
    level: "region",
    pattern: "/presidential/:cycle/region/:oblast",
    path: "region/BLG",
    id: "BLG",
  },
  {
    level: "municipality",
    pattern: "/presidential/:cycle/municipality/:obshtina",
    path: "municipality/BLG04",
    id: "BLG04",
  },
  {
    level: "settlement",
    pattern: "/presidential/:cycle/settlement/:ekatte",
    path: "settlement/56784",
    id: "56784",
  },
  {
    level: "section",
    pattern: "/presidential/:cycle/section/:code",
    path: "section/021700054",
    id: "021700054",
  },
] as const;

const asked: string[] = [];
const mount = (
  path: string,
  pattern: string,
  level: PresidentialPlaceLevel,
) => {
  asked.length = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    asked.push(String(url));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PresidentialPlaceScreen level={level} />, {
    wrapper: Wrapper,
  });
};

beforeEach(() => {
  i18n.changeLanguage("bg");
  vi.restoreAllMocks();
});

describe("the presidential place page", () => {
  it("asks for the abroad artifact under the id the producer wrote it at", async () => {
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/abroad`,
      "/presidential/:cycle/abroad",
      "abroad",
    );
    await screen.findByText(bgCorpus.presidential_place_not_published);
    const expected = artifactPath(
      "abroad",
      LATEST_PRESIDENTIAL_CYCLE,
      PRESIDENTIAL_ABROAD_ID,
    );
    expect(expected).not.toBeNull();
    expect(asked.some((u) => u.endsWith(expected!))).toBe(true);
  });

  for (const c of LEVELS)
    it(`asks for the ${c.level} artifact at the path the producer wrote it to`, async () => {
      mount(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/${c.path}`,
        c.pattern,
        c.level,
      );
      await screen.findByText(bgCorpus.presidential_place_not_published);
      const expected = artifactPath(c.level, LATEST_PRESIDENTIAL_CYCLE, c.id);
      expect(expected, c.level).not.toBeNull();
      expect(
        asked.some((u) => u.endsWith(expected!)),
        `${c.level}: asked ${asked.join(", ")}`,
      ).toBe(true);
    });

  it("shards a section's path by the oblast prefix of its code", async () => {
    // ⚠ THE ONE PATH SHAPE NO OTHER LEVEL EXERCISES. A section artifact lives under a
    // two-character oblast prefix, so a screen-side change that stopped passing the code
    // through would still produce a plausible-looking URL under a different directory.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/section/021700054`,
      "/presidential/:cycle/section/:code",
      "section",
    );
    await screen.findByText(bgCorpus.presidential_place_not_published);
    expect(asked.some((u) => u.includes("/section/by-oblast/02/"))).toBe(true);
  });

  it("reserves a map slot only where an adapter fills one", () => {
    // ⚠ DERIVED FROM `MAP_ADAPTERS`, never retyped. A hand-written list here would agree with
    // the screen's hand-written list and both could be wrong about the registry together.
    const MAPPED = new Set(
      Object.keys(MAP_ADAPTERS)
        .filter((k) => k.startsWith("presidential/"))
        .map((k) => k.split("/")[1]),
    );
    // Anti-vacuity: an empty set would make this assert „no level reserves a box" and pass on a
    // screen that reserves none.
    expect(MAPPED.size).toBeGreaterThan(0);
    // The other per-level difference. It used to be „none for a section, one for everything
    // else", because a single polling station has no geography to answer a question about and
    // every other level DECLARED a map. Declaring one is not drawing one: `MAP_ADAPTERS` serves
    // `presidential/region|municipality/winner` and deliberately refuses `settlement` (its
    // grain is `section` — a marker map, a different component) and `abroad` (no
    // country→continent crosswalk). Reserving 360px on those two is the same layout shift in
    // the same direction as reserving it for a section.
    //
    // ⚠ THIS IS WHAT PINS `MAPPED_LEVELS` TO THE REGISTRY. The screen mirrors the registry by
    // hand rather than importing it — importing would pull every adapter's `import()` edge into
    // that screen's static closure, which is what the lazy indirection exists to prevent — so
    // this case is the only thing stopping the two drifting.
    //
    // ⚠ ASSERTED BEFORE THE FETCH RESOLVES. The skeleton is what the boundary renders while
    // LOADING; once the 404 lands the fallback replaces it, so an awaited assertion here would
    // measure the wrong tree and pass at 0 slots for every level.
    for (const c of LEVELS) {
      const { container, unmount } = mount(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/${c.path}`,
        c.pattern,
        c.level,
      );
      expect(
        container.querySelectorAll('[data-skeleton-slot="map"]').length,
        c.level,
      ).toBe(MAPPED.has(c.level) ? 1 : 0);
      // …and the skeleton really is what is on screen, so the count above is not zero
      // because nothing rendered.
      expect(
        container.querySelectorAll("[data-surface-skeleton]").length,
        c.level,
      ).toBe(1);
      unmount();
    }
  });

  it("names the place rather than printing its code", async () => {
    // ⚠ A blank heading over a result is a page about nowhere; the code is the FALLBACK, and
    // for an oblast the corpus has a real name.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`,
      "/presidential/:cycle/region/:oblast",
      "region",
    );
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).not.toBe("BLG");
    expect(heading.textContent?.length).toBeGreaterThan(2);
  });

  it("states the absence instead of rendering a heading over nothing", async () => {
    // ⚠ THERE IS NO LEGACY BODY FOR THIS FAMILY. Every other caller of the boundary falls back
    // to its own composition; here `null` would leave a place name and empty space.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`,
      "/presidential/:cycle/region/:oblast",
      "region",
    );
    expect(
      await screen.findByText(bgCorpus.presidential_place_not_published),
    ).toBeInTheDocument();
  });
});
