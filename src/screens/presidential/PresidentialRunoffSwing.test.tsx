// The observed half of the runoff feature: the pickup ratio, its bands, the map's keyboard
// reachability, and the table that is its text twin.
//
// ⚠ THE COPY IS PART OF THE CONTRACT HERE, not decoration. Everything on this map is
// arithmetic on published protocols; the one thing it must never say is that the eliminated
// pairs' voters CHOSE the winner. That is an ecological inference, and the only surface
// entitled to make it is the Sankey, with its caveat attached.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  PresidentialRunoffSwingList,
  PresidentialRunoffSwingMap,
} from "./PresidentialRunoffSwing";
import { bandFor, pickupRatio } from "./runoffPickup";
import type { RunoffOblast } from "@/data/presidential/useRunoffTransfer";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const GEO = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { nuts3: "BLG" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [23, 41.5],
            [23.5, 41.5],
            [23.5, 42],
            [23, 42],
            [23, 41.5],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { nuts3: "BGS" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [27, 42],
            [27.5, 42],
            [27.5, 42.5],
            [27, 42.5],
            [27, 42],
          ],
        ],
      },
    },
  ],
};

const oblast = (over: Partial<RunoffOblast> = {}): RunoffOblast => ({
  oblast: "BLG",
  sections: 10,
  rasResidual: 0.0001,
  w1: 1000,
  w2: 1600,
  elim: 1200,
  v1: 3000,
  v2: 2400,
  n1: null,
  n2: null,
  a1: 3200,
  a2: 2600,
  reg1: 8000,
  reg2: 8100,
  ...over,
});

const mount = (node: React.ReactNode, geo: unknown = GEO) => {
  globalThis.fetch = (async (url: RequestInfo | URL) =>
    String(url).includes("regions_map.json")
      ? new Response(JSON.stringify(geo), { status: 200 })
      : new Response("", { status: 404 })) as typeof fetch;
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => i18n.changeLanguage("bg"));

describe("pickupRatio", () => {
  it("is the winner's gain over the eliminated pool", () => {
    expect(pickupRatio(oblast())).toBeCloseTo(0.5, 6);
  });

  it("is NULL, never 0, where nobody was eliminated", () => {
    // ⚠ A runoff between the only two pairs who stood has no pool. 0 would read as „the
    // winner picked up none of it", which is a claim about a place rather than about the
    // question being inapplicable there.
    expect(pickupRatio(oblast({ elim: 0 }))).toBeNull();
  });

  it("goes negative when the winner polled FEWER votes than in round 1", () => {
    // Turnout falls between the rounds; a winner can gain share and lose votes.
    expect(pickupRatio(oblast({ w2: 700 }))).toBeLessThan(0);
  });
});

describe("bandFor", () => {
  it("gives a loss its own colour rather than the bottom of the positive ramp", () => {
    expect(bandFor(-0.1)?.key).toBe("neg");
    expect(bandFor(0.01)?.key).toBe("q1");
    expect(bandFor(5)?.key).toBe("q4");
  });

  it("does NOT call a gain of exactly zero a loss", () => {
    // ⚠ THE LEGEND LABELS THAT BAND „загуба на гласове". A `<= 0` boundary put an unchanged
    // vote count in it, so the map would state something false about the place it coloured.
    // Vanishingly unlikely at oblast scale — which is exactly why it would never be noticed.
    expect(bandFor(0)?.key).toBe("q1");
  });

  it("has no band for „not applicable“", () => {
    expect(bandFor(null)).toBeNull();
  });
});

describe("PresidentialRunoffSwingList", () => {
  it("renders „—“ rather than 0% where no pair was eliminated", () => {
    mount(
      <PresidentialRunoffSwingList
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast({ elim: 0 })]}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("measures each round's turnout against ITS OWN published roll", () => {
    // ⚠ THE ROLLS DIFFER — up to 6% in Софийска област in 2006 — so dividing round 1's voters
    // by round 2's roll invents a turnout change that did not happen. 3200/8000 = 40% and
    // 2600/8100 = 32,1%; the wrong denominator would print 39,5% for the first. (`formatPct`
    // trims a trailing zero, so the first reads „40%" rather than „40,0%".)
    mount(
      <PresidentialRunoffSwingList
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
    );
    expect(screen.getByText(/\b40\s*%\s*→\s*32,1\s*%/)).toBeTruthy();
  });

  it("is the only route down to an oblast from this section", () => {
    mount(
      <PresidentialRunoffSwingList
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Благоевград" }).getAttribute("href"),
    ).toBe("/presidential/2021_11_14_pvr/region/BLG");
  });

  it("never says the eliminated pairs' voters chose the winner", () => {
    // ⚠ THE ONE SENTENCE THIS SURFACE MAY NOT CARRY. „Равен на" is arithmetic; „отидоха при"
    // is an ecological inference, and this half of the feature has no licence for one.
    const { container } = mount(
      <PresidentialRunoffSwingList
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
    );
    expect(container.textContent ?? "").not.toMatch(
      /отидоха|преминаха|went to/,
    );
  });
});

describe("PresidentialRunoffSwingMap", () => {
  it("makes every region a keyboard-operable button naming the measure", async () => {
    // ⚠ BOTH HALVES. `FeatureMap` derives `keyboard` as `!!ariaLabel && !!onClick`, so a
    // region missing either is silently mouse-only.
    mount(
      <PresidentialRunoffSwingMap
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
    );
    const btn = await screen.findByRole("button", { name: /Благоевград/ });
    expect(btn.getAttribute("tabindex")).toBe("0");
    expect(btn.getAttribute("aria-label")).toMatch(/Румен Радев/);
  });

  it("colours a region with NO row in the neutral fill", async () => {
    // ⚠ BGS has no row here. Giving it a band's colour would state a measured result for a
    // place the file says nothing about.
    mount(
      <PresidentialRunoffSwingMap
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
    );
    const led = await screen.findByRole("button", { name: /Благоевград/ });
    expect(led.getAttribute("fill")).toBe("#a3e635");
    const others = [...document.querySelectorAll("path")].filter(
      (p) => p.getAttribute("aria-label") !== led.getAttribute("aria-label"),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const p of others) expect(p.getAttribute("fill")).toBe("hsl(var(--muted))"); // prettier-ignore
  });

  it("renders nothing rather than throwing when the geography is not a feature collection", async () => {
    // ⚠ `useRegionsMap` has NO shape guard, and with no error boundary in `src/` a render-time
    // TypeError unmounts the React ROOT — a white screen for the whole SPA.
    const { container } = mount(
      <PresidentialRunoffSwingMap
        cycle="2021_11_14_pvr"
        winner="Румен Радев"
        oblasts={[oblast()]}
      />,
      { not: "a feature collection" },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll("path").length).toBe(0);
  });
});
