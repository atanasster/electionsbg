// The flyover band's one fetch — `docs/plans/home-flyover-v1.md` §8.1 and §2.5.
//
// ⚠️ GCS, AND ONLY AFTER THE BAND ARMS. `/`'s first paint is budgeted at exactly two GCS
// requests and zero `/api/db`; this object is the THIRD, and `enabled: armed` is what keeps
// it out of the first paint. A reader who never scrolls to the band, or who has asked for no
// animation, never pays for it — which is why the poster is a complete picture rather than a
// placeholder waiting on data.
//
// `undefined` is an ANSWER: a checkout that never ran the generator, a bucket object that has
// not been published, and a payload whose SHAPE is wrong all land in the same state — poster,
// no captions, no canvas. It never renders a zeroed map, because an empty column is a claim
// about that oblast.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FlyoverWorld } from "@/lib/flyover/types";

/**
 * `Infinity`, unlike the hub stats' 30 minutes.
 *
 * The artifact is 34 KB of geometry and a corpus that moves once a day at most, and the band
 * is a decoration on the entry page rather than a figure a reader might quote. Re-fetching it
 * on window focus would spend the bytes again to move a column by a pixel.
 */
export const FLYOVER_STALE_MS = Number.POSITIVE_INFINITY;

/**
 * ⚠️ A SHAPE GATE, NOT A PARSE, and it is the difference between a blank band and a white
 * screen on the site's entry page.
 *
 * `captionFor` and `render` dereference `figures`, `flows.coverage` and `geo.regions` with no
 * guard — one of them inside a `useMemo` DURING RENDER — and this application has no error
 * boundary anywhere. So an artifact that parses as JSON and is missing a branch (an older
 * generator's output, a partially written object, a schema change published to `data/` before
 * the bundle shipped) is a TypeError React cannot recover from, thrown by a decoration.
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

export const useFlyoverArtifact = (
  armed: boolean,
): { world: FlyoverWorld | undefined } => {
  const { data } = useQuery({
    queryKey: ["home", "flyover"] as const,
    queryFn,
    enabled: armed,
    staleTime: FLYOVER_STALE_MS,
    refetchOnWindowFocus: false,
    // One attempt. The poster is a complete picture, so a retry buys a decoration at the cost
    // of bytes on the page whose request budget is the reason this fetch is deferred at all.
    retry: false,
  });
  return { world: data ?? undefined };
};
