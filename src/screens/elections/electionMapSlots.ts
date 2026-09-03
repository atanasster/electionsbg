// The map slot's TYPED CONTRACT (Phase 2 item 4, §6).
//
// ⚠ THE ACCESSIBILITY RULE IS TWO PROPS THAT MUST TRAVEL TOGETHER, and the plan says why:
// `FeatureMap` derives keyboard access as `const keyboard = !!ariaLabel && !!onClick`, and
// `tabIndex`, `role="button"`, `aria-label`, `onKeyDown` and the focus ring are ALL gated on
// that one boolean. A region wired for selection but missing its `ariaLabel` is silently
// MOUSE-ONLY: nothing renders half-done and nothing looks wrong.
//
// So the pairing is enforced by the TYPE rather than by a check. An interactive panel's features
// each carry a required `ariaLabel` and the panel carries a required `onSelect`; a presentational
// one has neither and carries a single `ariaLabel` naming what the map shows. The third
// state — features that answer a mouse and not a keyboard — is the defect, and it is what an
// adapter produces by default if nobody states the posture. Here it is unrepresentable.

import type { FC } from "react";
import type {
  ElectionKind,
  ElectionPlaceLevel,
} from "@/data/elections/surfaceTypes";

/** One selectable feature. `ariaLabel` is REQUIRED — see the header. */
export type ElectionMapFeature = {
  /** The place code the feature stands for; also the key the ranked list selects by. */
  id: string;
  /** What a screen reader announces. Never optional: an unnamed selectable feature is the
   *  mouse-only defect. */
  ariaLabel: string;
  /** The quantity the choropleth colours by. Absent means "no value here" — never zero. */
  value?: number;
};

export type ElectionMapSlot =
  | {
      posture: "presentational";
      /** ⚠ ONE LABEL FOR THE WHOLE MAP, the posture `EuChoroplethMap` already takes. It is a
       *  legitimate answer for a map that illustrates rather than selects — and it is not a
       *  licence to skip the ranked list, which §4 requires regardless. */
      ariaLabel: string;
      features: readonly Omit<ElectionMapFeature, "ariaLabel">[];
    }
  | {
      posture: "interactive";
      /** ⚠ WHO DRIVES SELECTION — an ORTHOGONAL fact from the posture, and the one this union
       *  originally conflated with it. §6's two postures are a claim about the MAP's
       *  accessibility: does every selectable feature carry a label and an activation, or does
       *  the map illustrate rather than select. They say nothing about where the features come
       *  from, and the first adapter this shell wraps is an existing tile that fetches its own
       *  geography and navigates on click.
       *
       *  Forcing that tile into `"shell"` would mean handing it an empty feature list and a
       *  no-op `onSelect` — a lie in the type — while `"presentational"` would be a false
       *  a11y claim about a map that navigates. So the posture stays exactly the two §6 names
       *  and this second axis says who supplies the rows. */
      selection: "shell";
      features: readonly ElectionMapFeature[];
      /** Bound to the ranked list in BOTH directions (§6). */
      onSelect: (id: string) => void;
      selectedId?: string;
    }
  | {
      posture: "interactive";
      /** The adapter owns its own features, labels and navigation.
       *
       *  ⚠ THE POSTURE IS STILL A CLAIM AND STILL CHECKABLE — it is just checked where the
       *  features are, in the adapter's own gate, rather than at this boundary. The country
       *  adapter's map is keyboard-operable because `MapElement` now passes an `ariaLabel`
       *  through `FeatureMap`'s `!!ariaLabel && !!onClick` derivation, and
       *  `mapKeyboard.test.tsx` is what holds it. What must never happen is this variant
       *  becoming the place an unlabelled map hides: it asserts MORE than `presentational`,
       *  not less. */
      selection: "adapter";
    };

/** Which adapter draws a given surface's map. The key is the surface's own coordinates plus the
 *  map's declared mode, so a level with two modes gets two adapters rather than one with a
 *  branch inside it. */
export type ElectionMapAdapterKey =
  `${ElectionKind}/${ElectionPlaceLevel}/${string}`;

export const adapterKey = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  mode: string,
): ElectionMapAdapterKey => `${kind}/${level}/${mode}`;

export type ElectionMapAdapterProps = ElectionMapSlot & {
  /** The question this map answers, already localised — §6 requires a map to name it. */
  question?: string;
  /** The place whose map this is — an oblast code, an obshtina code, an EKATTE.
   *
   *  ⚠ IT COMES FROM THE SURFACE, never from the router. A map adapter that read `useParams`
   *  would draw a different place from the one the ranked list beside it describes on any page
   *  that renders two surfaces — which §4.1's whole premise says is the expected case. */
  placeId: string;
};

/** ⚠ EVERY VALUE IS A LOADER, NEVER A COMPONENT. A static reference here would pull the
 *  adapter — and its map library — into this module's own chunk, which is exactly what the
 *  lazy indirection exists to prevent, and it would do so silently: the page still works, it
 *  just ships Leaflet to the section route.
 *
 *  ⚠ EMPTY IN PHASE 2 BY DESIGN. Phase 2's exit criterion is that every production page still
 *  renders its legacy composition, so wiring the eight real map tiles here would be the one
 *  change that breaks it. Phase 4 fills it; this file is the seam and its gates. */
export const MAP_ADAPTERS: Partial<
  Record<
    ElectionMapAdapterKey,
    () => Promise<{ default: FC<ElectionMapAdapterProps> }>
  >
> = {
  // The country's winner map — `RegionsMap`, wrapped. ⚠ `() => import(...)`, never a static
  // reference: the whole point of this registry is that the map libraries stay out of the
  // shell's own chunk, and a static import here would ship Leaflet and d3 to the polling-section
  // route, which draws no map at all.
  "parliamentary/country/winner": () =>
    import("./adapters/ParliamentaryCountryMap"),
  // ⚠ THE SAME MODULE FOR BOTH LEVELS (§Phase 4 item 6: "abroad uses the parliamentary region
  // adapter"). `MunicipalitiesMap` already branches on the region — МИР 32 loads the continents
  // geo, Sofia's three МИР load their районы — so a second entry pointing elsewhere would be a
  // second copy of that branching.
  "parliamentary/region/winner": () =>
    import("./adapters/ParliamentaryRegionMap"),
  "parliamentary/abroad/winner": () =>
    import("./adapters/ParliamentaryRegionMap"),
  "parliamentary/municipality/winner": () =>
    import("./adapters/ParliamentaryMunicipalityMap"),
};
