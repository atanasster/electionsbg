// `?mode=<universe>` on /sector/transport/network and /procurement (plan §3).
//
// Validated on READ: an unknown value is ignored rather than filtering the page
// to nothing — a shared link with a typo must not read as „this mode has no
// contracts". Page-local: the param is not in usePreserveParams' allowlist, so
// it does not leak onto other pages.

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_UNIVERSES,
  transportUniverseOf,
  type TransportUniverse,
} from "@/lib/transportReferenceData";

export const parseTransportMode = (
  raw: string | null,
): TransportUniverse | null =>
  raw && (TRANSPORT_UNIVERSES as string[]).includes(raw)
    ? (raw as TransportUniverse)
    : null;

/** The EIKs a mode covers — the whole roll-up when no mode is set. */
export const eiksForMode = (mode: TransportUniverse | null): string[] =>
  mode
    ? TRANSPORT_SECTOR_EIKS.filter((e) => transportUniverseOf(e) === mode)
    : TRANSPORT_SECTOR_EIKS;

export const useTransportMode = (): {
  mode: TransportUniverse | null;
  eiks: string[];
  setMode: (m: TransportUniverse | null) => void;
} => {
  const [params, setParams] = useSearchParams();
  const mode = parseTransportMode(params.get("mode"));
  const eiks = useMemo(() => eiksForMode(mode), [mode]);
  const setMode = useCallback(
    (m: TransportUniverse | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (m) next.set("mode", m);
          else next.delete("mode");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { mode, eiks, setMode };
};

/**
 * The contracts browser for what a page shows, carrying its scope. Without a mode
 * it is the sector browse pack (`?sector=transport`, ex-member counts). WITH one,
 * `?sector` would land on all 16 bodies' contracts — a different count from the
 * figure beside the link — so it is the mode's own awarder set (`?awarder=`)
 * instead. € agree either way; `?awarder=` lists consortium-member rows (€0)
 * that the pack hides, so its row COUNT can be a few higher. `?mode` itself is
 * never carried: the browser does not read it, and every later link that copies
 * the search would keep it.
 */
export const transportContractsHref = (
  params: URLSearchParams,
  mode: TransportUniverse | null,
  extra: Record<string, string> = {},
): string => {
  const p = new URLSearchParams(params);
  p.delete("mode");
  if (mode) {
    p.delete("sector");
    p.set("awarder", eiksForMode(mode).join(","));
  } else p.set("sector", "transport");
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `/procurement/contracts?${p.toString()}`;
};

/** The project map's feature link: the contracts browser over exactly the bodies the
 *  map draws, on the page's scope. The whole sector is the browse pack (`?sector=`);
 *  any narrower set is an explicit `?awarder=` list. `?mode` is dropped. */
export const projectMapContractsHref = (
  params: URLSearchParams,
  eiks: readonly string[],
  q: string,
): string => {
  const p = new URLSearchParams(params);
  p.delete("mode");
  const whole =
    eiks.length === TRANSPORT_SECTOR_EIKS.length &&
    TRANSPORT_SECTOR_EIKS.every((e) => eiks.includes(e));
  if (whole) {
    p.delete("awarder");
    p.set("sector", "transport");
  } else {
    p.delete("sector");
    p.set("awarder", eiks.join(","));
  }
  p.set("q", q);
  return `/procurement/contracts?${p.toString()}`;
};
