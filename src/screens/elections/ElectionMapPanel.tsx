// The map SLOT: it holds a map's place in the canvas and loads the adapter lazily (Phase 2
// item 4, §6).
//
// ⚠ IT IMPORTS NO MAP LIBRARY, AND THAT IS THE WHOLE POINT. Leaflet, d3 and recharts are the
// heavy vendor chunks (§10.1), and the shell composes ~15 screens — one of which, the polling
// section, draws no map at all. A static import here would put those chunks on that route for
// nothing. Every adapter is reached through `import()`, so the module graph from this file
// contains no map code and `ElectionResultsShell.test.tsx`'s vendor-chunk gate stays true of
// the shell's whole static closure rather than only of the shell's own file.
//
// ⚠ AN UNREGISTERED KEY RENDERS THE TEXT EQUIVALENT, NEVER A HOLE. §4 requires a ranked list
// beside every map, so the surface is readable with no map at all; a level whose adapter has
// not been written yet says so and keeps its reserved space, rather than collapsing the canvas.

import { FC, Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SKELETON_MAP_HEIGHT_CLASS } from "./electionSurfaceLayout";
import {
  MAP_ADAPTERS,
  type ElectionMapAdapterKey,
  type ElectionMapAdapterProps,
} from "./electionMapSlots";

export type ElectionMapPanelProps = ElectionMapAdapterProps & {
  adapter: ElectionMapAdapterKey;
  /** A screen that ALWAYS draws this map may hand its adapter in already-loaded.
   *
   *  ⚠ THIS IS A PRELOAD, NOT A SECOND REGISTRY, AND THE DIFFERENCE IS THE POINT. The lazy
   *  registry buys the polling-section route its freedom from Leaflet, and that stays. What it
   *  costs is a serial hop on the routes that always draw a map: entry → screen chunk →
   *  ADAPTER chunk → vendor-leaflet, three round-trips before the map can paint. `/parliamentary`
   *  is the one route where that is unambiguously wrong — a country result whose map is the
   *  page — so `DashboardScreen` imports its adapter statically, which puts vendor-leaflet and
   *  vendor-geo back into its own dependency list and lets the browser fetch them in parallel.
   *
   *  ⚠ THE KEY IS STILL REQUIRED AND STILL THE AUTHORITY. `election_map_adapter_preload` in
   *  `ElectionMapPanel.test.tsx` asserts the passed component is the one the registry resolves
   *  for that key, so the two cannot name different maps. */
  preloaded?: FC<ElectionMapAdapterProps>;
};

export const ElectionMapPanel: FC<ElectionMapPanelProps> = ({
  adapter,
  preloaded,
  ...slot
}) => {
  const { t } = useTranslation();
  const loader = MAP_ADAPTERS[adapter];
  // ⚠ MEMOISED ON THE KEY. `lazy()` returns a new component type on every call, so building it
  // inline remounts the map — and refetches its geography — on every render of the page.
  const lazyAdapter = useMemo(() => (loader ? lazy(loader) : null), [loader]);
  const Adapter = preloaded ?? lazyAdapter;

  if (!Adapter)
    return (
      <p
        className="text-sm text-muted-foreground"
        data-map-unavailable={adapter}
      >
        {/* ⚠ NOT „Картата се зарежда…". This branch is reached when the registry has NO adapter
            for the key, so nothing is loading and nothing ever will — the message resolved for
            no one. Measured then: every `local/*` level declared a map and registered no
            adapter, so all 289 municipality pages, both regions and the country page printed a
            permanent "the map is loading" above a page that was otherwise complete. A state
            that cannot change must not be described in the present continuous.
            ⚠ `local/country/winner` IS REGISTERED NOW and the rest of that family is not, so
            this branch is still the one every `local` page below the country level takes. */}
        {t("election_map_unavailable")}
      </p>
    );

  return (
    <Suspense
      fallback={
        // The same reserved height the skeleton uses, so the arriving map does not move the
        // page a second time after the surface itself has landed.
        <div
          className={`animate-pulse rounded bg-muted w-full ${SKELETON_MAP_HEIGHT_CLASS}`}
          aria-hidden="true"
          data-map-loading
        />
      }
    >
      <Adapter {...(slot as ElectionMapAdapterProps)} />
    </Suspense>
  );
};
