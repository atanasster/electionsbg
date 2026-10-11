// The money-map article's one fetch — the flyover artifact (`data/home/flyover.json`).
//
// `undefined` is an ANSWER: a checkout that never ran the generator, a bucket object that has
// not been published, and a payload whose SHAPE is wrong all land in the same state — the
// article's frozen chapter stills, no live canvas. It never renders a zeroed map, because an
// empty column is a claim about that oblast.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FlyoverWorld } from "@/lib/flyover/types";

/**
 * `Infinity`, unlike the hub stats' 30 minutes.
 *
 * The artifact is 34 KB of geometry and a corpus that moves once a day at most. Re-fetching it
 * on window focus would spend the bytes again to move a column by a pixel.
 */
export const FLYOVER_STALE_MS = Number.POSITIVE_INFINITY;

/**
 * ⚠️ A SHAPE GATE, NOT A PARSE, and it is the difference between the frozen stills and a
 * white screen.
 *
 * `render` dereferences `flows.coverage` and `geo.regions` with no guard, and this
 * application has no error boundary anywhere. So an artifact that parses as JSON and is
 * missing a branch (an older generator's output, a partially written object, a schema change
 * published to `data/` before the bundle shipped) is a TypeError React cannot recover from.
 *
 * „Absent" is already an answer here. „Malformed" has to be the same one.
 */
export const isFlyoverWorld = (v: unknown): v is FlyoverWorld => {
  const w = v as Partial<FlyoverWorld> | null;
  return (
    !!w &&
    typeof w === "object" &&
    !!w.figures &&
    !!w.flows?.coverage &&
    Array.isArray(w.flows.keys) &&
    !!w.geo?.regions &&
    !!w.geo.cities &&
    !!w.layers
  );
};

const queryFn = async (): Promise<FlyoverWorld | null> => {
  const r = await fetch(dataUrl("/home/flyover.json"));
  if (!r.ok) return null;
  const body: unknown = await r.json().catch(() => null);
  return isFlyoverWorld(body) ? body : null;
};

export const useFlyoverArtifact = (): { world: FlyoverWorld | undefined } => {
  const { data } = useQuery({
    queryKey: ["home", "flyover"] as const,
    queryFn,
    staleTime: FLYOVER_STALE_MS,
    refetchOnWindowFocus: false,
    // One attempt. The frozen stills are a complete picture, so a retry buys little.
    retry: false,
  });
  return { world: data ?? undefined };
};
