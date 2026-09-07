// The map slot: what it must NOT pull in, and the accessibility state it must make
// unrepresentable (Phase 2 item 4, §6).

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { EDGE, REPO_ROOT, SRC_DIR, walk } from "@/../scripts/lib/module_graph";
import { bgCorpus as bg } from "@/locales/allKeys";
import { ElectionMapPanel } from "./ElectionMapPanel";
import { MAP_ADAPTERS, type ElectionMapSlot } from "./electionMapSlots";
import { adapterKey } from "./electionMapSlots";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const presentational: ElectionMapSlot = {
  posture: "presentational",
  ariaLabel: "Карта",
  features: [{ id: "PDV", value: 1 }],
};

describe("the panel pulls in no map library", () => {
  // ⚠ THE RULE THE WHOLE INDIRECTION EXISTS FOR. Leaflet, d3 and recharts are the heavy vendor
  // chunks, the shell composes ~15 screens, and one of them — the polling section — draws no
  // map at all. A static import anywhere in this file's closure ships those chunks to that
  // route, and nothing about the page would look wrong.
  const FORBIDDEN = [
    "leaflet",
    "react-leaflet",
    "d3",
    "recharts",
    "react-d3-library",
  ];
  it("has none of them anywhere in its STATIC closure", () => {
    const { seen } = walk([
      path.join(SRC_DIR, "screens/elections/ElectionMapPanel.tsx"),
    ]);
    const offenders: string[] = [];
    for (const file of seen) {
      const src = stripComments(fs.readFileSync(file, "utf8"), {
        trailing: true,
      });
      for (const m of src.matchAll(EDGE)) {
        const spec = m[1] ?? m[2];
        if (FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`)))
          offenders.push(`${path.relative(REPO_ROOT, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("registers LOADERS, never components", () => {
    // ⚠ A STATIC REFERENCE IN THE REGISTRY DEFEATS THE WHOLE FILE, silently: the page still
    // works, it just ships the map library in this module's chunk. Read off the source, because
    // at runtime a loader and a component are both functions.
    const src = stripComments(
      fs.readFileSync(
        path.join(SRC_DIR, "screens/elections/electionMapSlots.ts"),
        "utf8",
      ),
      { trailing: true },
    );
    const body = src.slice(
      src.indexOf("MAP_ADAPTERS"),
      src.indexOf("};", src.indexOf("MAP_ADAPTERS")),
    );
    // Every entry, if any, must be an arrow returning a dynamic import.
    for (const entry of body.matchAll(/"[^"]+"\s*:\s*([^,]+)/g))
      expect(entry[1], entry[0]).toMatch(/\(\)\s*=>\s*import\(/);
    for (const v of Object.values(MAP_ADAPTERS))
      expect(typeof v).toBe("function");
  });
});

describe("an unwired level degrades to its text equivalent", () => {
  it("says so and does not collapse the canvas", () => {
    // §4 requires a ranked list beside every map, so the surface is readable with no map at
    // all — but a level whose adapter is not written yet must SAY so rather than render a hole.
    render(
      <ElectionMapPanel
        adapter={adapterKey("parliamentary", "country", "vote_share")}
        {...presentational}
        placeId="BG"
        cycle="2026_04_19"
      />,
    );
    expect(screen.getByText(bg.election_map_unavailable)).toBeInTheDocument();
  });

  it("does not describe a permanent state in the present continuous", () => {
    // ⚠ THE COPY WAS „Картата се зарежда с данните за мястото." — "the map is loading" — on a
    // branch reached only when the registry has NO adapter for the key, so nothing was loading
    // and nothing ever would. Measured then: every `local/*` level declared a map and registered
    // no adapter, so all 289 municipality pages plus both regions and the country page carried a
    // loading message that resolved for no one. `local/country/winner` has since been wired; the
    // levels below it have not, so the branch is still live and this case still has a subject.
    render(
      <ElectionMapPanel
        adapter={adapterKey("parliamentary", "country", "vote_share")}
        {...presentational}
        placeId="BG"
        cycle="2026_04_19"
      />,
    );
    expect(screen.queryByText(bg.election_map_placeholder)).toBeNull();
    // …and the two really are different strings, so this is not passing on a copy change that
    // merely renamed the key.
    expect(bg.election_map_unavailable).not.toBe(bg.election_map_placeholder);
    expect(bg.election_map_unavailable).not.toMatch(/зарежда/);
  });
});

describe("a registered adapter is loaded lazily and only once", () => {
  it("renders it, and does not rebuild the lazy type on re-render", async () => {
    // ⚠ `lazy()` RETURNS A NEW COMPONENT TYPE EVERY CALL, so an un-memoised one remounts the map
    // — and refetches its geography — on every render of the page. Counting loader calls across
    // a re-render is the only way to see that from outside.
    const loader = vi.fn(async () => ({
      default: (p: { ariaLabel?: string }) => (
        <div data-testid="adapter">{p.ariaLabel}</div>
      ),
    }));
    const key = adapterKey("parliamentary", "region", "vote_share");
    (MAP_ADAPTERS as Record<string, unknown>)[key] = loader;
    try {
      const { rerender } = render(
        <ElectionMapPanel
          adapter={key}
          placeId="BG"
          cycle="2026_04_19"
          {...presentational}
        />,
      );
      await waitFor(() => expect(screen.getByTestId("adapter")).toBeTruthy());
      rerender(
        <ElectionMapPanel
          adapter={key}
          placeId="BG"
          cycle="2026_04_19"
          {...presentational}
        />,
      );
      await waitFor(() => expect(screen.getByTestId("adapter")).toBeTruthy());
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      delete (MAP_ADAPTERS as Record<string, unknown>)[key];
    }
  });
});

describe("the mouse-only map is unrepresentable", () => {
  it("refuses an interactive feature with no ariaLabel, at COMPILE time", () => {
    // ⚠ THE DEFECT THIS TYPE EXISTS FOR. `FeatureMap` derives keyboard access as
    // `!!ariaLabel && !!onClick`, so a feature wired for selection with no label is silently
    // mouse-only: nothing renders half-done and nothing looks wrong. A runtime check would only
    // fire on the path a test happens to take; the type refuses it everywhere.
    //
    // @ts-expect-error an interactive feature without `ariaLabel`
    const bad: ElectionMapSlot = {
      posture: "interactive",
      features: [{ id: "PDV" }],
      onSelect: () => {},
    };
    expect(bad).toBeTruthy();

    // …and an interactive panel with no `onSelect` is refused for the same reason.
    // @ts-expect-error an interactive posture without `onSelect`
    const alsoBad: ElectionMapSlot = {
      posture: "interactive",
      features: [{ id: "PDV", ariaLabel: "Пловдив" }],
    };
    expect(alsoBad).toBeTruthy();
  });
});

describe("the preloaded adapter cannot disagree with the registry", () => {
  // ⚠ THE PROP IS A PRELOAD, NOT A SECOND REGISTRY. `DashboardScreen` imports its adapter
  // statically so the browser fetches vendor-leaflet and vendor-geo in PARALLEL with the screen
  // rather than two hops behind it — the waterfall `tests/perf.spec.ts` guards. Nothing in that
  // mechanism checks the component matches the key it is passed alongside, and a mismatch would
  // draw the WRONG MAP on a correct-looking page: the country result showing a município's
  // geography, at a 200, with the key still saying `parliamentary/country/winner`.
  //
  // So the one screen that uses it is checked against the registry it bypasses.

  it("DashboardScreen passes the module its own key resolves to", async () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/screens/DashboardScreen.tsx"),
      "utf8",
    );
    const imported =
      /import\s+(\w+)\s+from\s+"@\/screens\/elections\/adapters\/(\w+)"/.exec(
        src,
      );
    expect(
      imported,
      "DashboardScreen no longer statically imports an adapter",
    ).toBeTruthy();
    const [, binding, moduleName] = imported!;
    // It must actually be handed to the shell, not merely imported.
    expect(src).toContain(`preloadedMap={${binding}}`);

    // …and the registry must resolve the SAME module for the country key.
    const loader = MAP_ADAPTERS["parliamentary/country/winner"];
    expect(loader, "the country key lost its registry entry").toBeTruthy();
    const mod = await loader!();
    const registryName = (mod.default as { name?: string }).name;
    expect(registryName).toBe(moduleName);
  });

  it("the registry entry is still what every other level uses", () => {
    // The discriminating half: if the static import had REPLACED the registry entry rather
    // than shadowing it for one screen, the other four levels would silently lose their maps.
    for (const key of [
      "parliamentary/region/winner",
      "parliamentary/abroad/winner",
      "parliamentary/municipality/winner",
      "parliamentary/settlement/winner",
    ] as const)
      expect(MAP_ADAPTERS[key], key).toBeTruthy();
  });
});
