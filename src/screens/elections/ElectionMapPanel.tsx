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
};

export const ElectionMapPanel: FC<ElectionMapPanelProps> = ({
  adapter,
  ...slot
}) => {
  const { t } = useTranslation();
  const loader = MAP_ADAPTERS[adapter];
  // ⚠ MEMOISED ON THE KEY. `lazy()` returns a new component type on every call, so building it
  // inline remounts the map — and refetches its geography — on every render of the page.
  const Adapter = useMemo(() => (loader ? lazy(loader) : null), [loader]);

  if (!Adapter)
    return (
      <p
        className="text-sm text-muted-foreground"
        data-map-unavailable={adapter}
      >
        {t("election_map_placeholder")}
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
