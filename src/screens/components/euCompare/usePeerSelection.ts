// Single source of truth for the EU compare dashboard's peer chip selector.
// Reads/writes the `?peers=` URL param so the view is shareable; BG and the
// EU27 aggregate are always included implicitly so the user can't construct
// a state with nothing to compare against.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { PeerGeo } from "@/data/macro/useMacroPeers";

export type ToggleablePeer = Exclude<PeerGeo, "BG" | "EU27_2020">;

export const TOGGLEABLE_PEERS: ToggleablePeer[] = ["RO", "GR", "HU", "HR"];

const PARAM_NAME = "peers";

const parsePeerParam = (raw: string | null): ToggleablePeer[] => {
  if (raw === null) return [...TOGGLEABLE_PEERS]; // default: all on
  if (raw === "") return [];
  const requested = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is ToggleablePeer =>
      (TOGGLEABLE_PEERS as readonly string[]).includes(s),
    );
  return TOGGLEABLE_PEERS.filter((p) => requested.includes(p));
};

export type PeerSelection = {
  /** The user-toggleable peers currently visible (excludes BG and EU27). */
  selected: ToggleablePeer[];
  /** Full geo list including BG (anchor) and EU27 (benchmark). */
  geos: PeerGeo[];
  togglePeer: (p: ToggleablePeer) => void;
  /** True iff `p` is in `selected`. */
  isActive: (p: ToggleablePeer) => boolean;
};

export const usePeerSelection = (): PeerSelection => {
  const [params, setParams] = useSearchParams();
  const selected = useMemo(
    () => parsePeerParam(params.get(PARAM_NAME)),
    [params],
  );
  const geos = useMemo<PeerGeo[]>(
    () => ["BG", "EU27_2020", ...selected],
    [selected],
  );
  const togglePeer = useCallback(
    (p: ToggleablePeer) => {
      const next = new URLSearchParams(params);
      const updated = selected.includes(p)
        ? selected.filter((x) => x !== p)
        : [...selected, p];
      // Default state (all four on) → drop the param so the URL stays clean.
      if (
        updated.length === TOGGLEABLE_PEERS.length &&
        TOGGLEABLE_PEERS.every((x) => updated.includes(x))
      ) {
        next.delete(PARAM_NAME);
      } else {
        next.set(
          PARAM_NAME,
          TOGGLEABLE_PEERS.filter((x) => updated.includes(x)).join(","),
        );
      }
      setParams(next, { replace: true });
    },
    [params, selected, setParams],
  );
  const isActive = useCallback(
    (p: ToggleablePeer) => selected.includes(p),
    [selected],
  );
  return { selected, geos, togglePeer, isActive };
};

// Shared display labels — kept here so every tile on the dashboard pulls
// from a single source rather than redefining names per component.
export const PEER_LABELS_EN: Record<ToggleablePeer, string> = {
  RO: "Romania",
  GR: "Greece",
  HU: "Hungary",
  HR: "Croatia",
};

export const PEER_LABELS_BG: Record<ToggleablePeer, string> = {
  RO: "Румъния",
  GR: "Гърция",
  HU: "Унгария",
  HR: "Хърватия",
};

export const GEO_SHORT_EN: Record<PeerGeo, string> = {
  BG: "BG",
  EU27_2020: "EU",
  RO: "RO",
  GR: "GR",
  HU: "HU",
  HR: "HR",
};

export const GEO_SHORT_BG: Record<PeerGeo, string> = {
  BG: "БГ",
  EU27_2020: "ЕС",
  RO: "РО",
  GR: "ГР",
  HU: "УН",
  HR: "ХР",
};

// Per-geo accent color, derived from each country's national flag so the
// legend reads as "this is the colour of country X" rather than as an
// arbitrary chart-palette swatch. Picks minimise collisions across the EU
// compare peer set (BG / HU / HR all carry red in their flags; the
// chosen hues split them: BG = Bulgarian green, HU = Hungarian red,
// HR = Croatian navy from the checkerboard coat-of-arms field).
//
// - BG: Bulgarian green (#00966E) — middle stripe of the flag, distinct
//   from HU's red and the EU's blue.
// - EU27: dark EU blue (#003399) — usually rendered with a dashed/muted
//   treatment so it reads as the reference benchmark, not a peer.
// - RO: Romanian yellow (#FCD116) — the only yellow in the peer set.
// - GR: Greek royal blue (#0D5EAF) — distinct from EU's darker blue
//   and from HR's navy.
// - HU: Hungarian red (#C8102E) — slightly cooler than BG's flag red,
//   wins the "red slot" because BG anchors with green.
// - HR: Croatian navy (#171796) — the dark blue from the checkerboard
//   coat-of-arms field, avoids the HU red clash.
export const GEO_COLOR: Record<PeerGeo, string> = {
  BG: "#00966E",
  EU27_2020: "#003399",
  RO: "#FCD116",
  GR: "#0D5EAF",
  HU: "#C8102E",
  HR: "#171796",
};
