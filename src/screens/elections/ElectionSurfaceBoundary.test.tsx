// The boundary decides legacy-vs-new, and every one of its branches is a rendered state.
//
// ⚠ THE MARKER IS THE ANTI-VACUITY DEVICE, and Phase 2 makes it a runtime gate rather than a
// convenience: "the shell's `data-surface-shell` marker is PRESENT on every level under test, so
// a run that silently rendered the legacy body fails instead of passing." Without it, every
// assertion about the new surface is satisfied by a page that fell back — which is the ONE
// failure mode this whole phase is built around, because the fallback is designed to look normal.

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus as bg } from "@/locales/allKeys";
import { ElectionSurfaceBoundary } from "./ElectionSurfaceBoundary";
import { __resetSurfaceWarnings } from "@/data/elections/useElectionSurface";
import { parliamentaryCountry } from "@/data/elections/fixtures/surfaceFixtures";
import { SURFACE_POLICY } from "@/data/elections/surfacePath";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const draw = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  );

const boundary = (
  props: Partial<React.ComponentProps<typeof ElectionSurfaceBoundary>> = {},
) =>
  draw(
    <ElectionSurfaceBoundary
      kind="parliamentary"
      level="region"
      cycle="2026_04_19"
      id="BLG"
      fallback={<div data-testid="legacy">legacy body</div>}
      {...props}
    >
      {(s) => <div data-surface-shell={s.place.level}>new surface</div>}
    </ElectionSurfaceBoundary>,
  );

/** ⚠ WAIT FOR THE SETTLED STATE, NEVER FOR THE LEGACY BODY. With no skeleton, `loading` renders
 *  the fallback too — so `findByTestId("legacy")` returns immediately, while the fetch is still
 *  in flight, and any assertion after it runs against the loading branch. Two tests here passed
 *  their `findByTestId` and then failed on the state attribute for exactly that reason. */
const settled = (status: string) =>
  waitFor(() => {
    const el = document.querySelector(`[data-surface-boundary='${status}']`);
    expect(el, `boundary never reached '${status}'`).toBeTruthy();
    return el!;
  });

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    url: "u",
    json: async () => body,
  }) as unknown as Response;

describe("the boundary renders the surface only when it is usable", () => {
  beforeEach(() => __resetSurfaceWarnings());
  afterEach(() => vi.unstubAllGlobals());

  it("renders the new surface, and MARKS it", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(parliamentaryCountry));
    boundary();
    expect(await screen.findByText("new surface")).toBeTruthy();
    // ⚠ THE MARKER. Every other assertion in this file is satisfiable by the legacy body.
    expect(document.querySelector("[data-surface-shell]")).toBeTruthy();
    expect(screen.queryByTestId("legacy")).toBeNull();
  });

  it("falls back on an unpublished cycle, without an empty first screen", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    boundary();
    await settled("absent");
    expect(screen.getByTestId("legacy")).toBeTruthy();
    expect(document.querySelector("[data-surface-shell]")).toBeNull();
  });

  it("falls back on a schema version it cannot read", async () => {
    // A v2 artifact is a migration, not a defect — but it is still not renderable here.
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ ...parliamentaryCountry, schemaVersion: 2 }),
    );
    boundary();
    await settled("unusable");
    expect(screen.getByTestId("legacy")).toBeTruthy();
  });

  it("falls back on a malformed artifact", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ schemaVersion: 1, kind: "nope" }),
    );
    boundary();
    await settled("unusable");
    expect(screen.getByTestId("legacy")).toBeTruthy();
  });

  it("logs the reason once per process, not per render", async () => {
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    boundary();
    await settled("absent");
    boundary();
    await waitFor(() =>
      expect(
        document.querySelectorAll("[data-surface-boundary='absent']").length,
      ).toBe(2),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("loading is not absence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the skeleton, aria-busy, while the fetch is in flight", () => {
    // ⚠ SWAPPING TO THE LEGACY BODY MID-LOAD is a layout shift a reader sees and a change a
    // screen reader is not told about — which is what item 5's `aria-busy` requirement is for.
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    boundary({ skeleton: <div data-testid="skeleton">…</div> });
    const busy = document.querySelector("[data-surface-boundary='loading']")!;
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-live")).toBe("polite");
    expect(busy.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByTestId("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("legacy")).toBeNull();
  });

  it("waits, rather than falling back, while a route param is unresolved", () => {
    // ⚠ THE DEFECT A BOOLEAN CAUSES. An id that has not arrived is `pending`, not `absent`; a
    // fallback here renders the legacy body and never re-renders, because a fallback is not a
    // suspended state.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    boundary({ id: undefined, skeleton: <div data-testid="skeleton">…</div> });
    expect(
      document.querySelector("[data-surface-boundary='loading']"),
    ).toBeTruthy();
    expect(screen.queryByTestId("legacy")).toBeNull();
    // …and it issues no request for a place it cannot name.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the legacy body when no skeleton is supplied", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    boundary();
    expect(screen.getByTestId("legacy")).toBeTruthy();
    expect(
      document
        .querySelector("[data-surface-boundary='loading']")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
  });
});

describe("a level §5.0 does not emit issues no request at all", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the legacy body for a canonical level, with no fetch", () => {
    // parliamentary/country is served from `national_summary.json` by design. Requesting an
    // artifact for it would 404 on every render of the busiest page family on the site.
    expect(SURFACE_POLICY.parliamentary.country.source).toBe("canonical");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    boundary({ level: "country", id: "BG" });
    expect(screen.getByTestId("legacy")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-surface-boundary='canonical']"),
    ).toBeTruthy();
  });

  it("renders the legacy body for an embedded level, with no fetch", () => {
    expect(SURFACE_POLICY.local.section.source).toBe("embedded");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    boundary({
      kind: "local",
      level: "section",
      cycle: "2023_10_29_mi",
      id: "1",
    });
    expect(screen.getByTestId("legacy")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the legacy body for a kind × level that does not exist", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    boundary({
      kind: "local",
      level: "abroad",
      cycle: "2023_10_29_mi",
      id: "32",
    });
    expect(
      document.querySelector("[data-surface-boundary='none']"),
    ).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
