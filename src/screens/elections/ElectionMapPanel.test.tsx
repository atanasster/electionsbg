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
      />,
    );
    expect(screen.getByText(bg.election_map_placeholder)).toBeInTheDocument();
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
        <ElectionMapPanel adapter={key} placeId="BG" {...presentational} />,
      );
      await waitFor(() => expect(screen.getByTestId("adapter")).toBeTruthy());
      rerender(
        <ElectionMapPanel adapter={key} placeId="BG" {...presentational} />,
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
