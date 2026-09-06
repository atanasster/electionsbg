// The lazy boundary the flyover band sits behind — `docs/plans/home-flyover-v1.md` §8.1.
//
// ⚠️ THE FALLBACK IS THE SAME POSTER IN THE SAME BOX, and that is the whole point of the
// split. `/` is budgeted at CLS < 0.1 and the band sits ABOVE the eight destination tiles, so
// a fallback of a different height would move every one of them the moment the chunk arrived.
// Every dimension comes from `box.ts` — the five that used to be hand-copied across this
// boundary agreed only because a comment asked a future reader to remember.
//
// ⚠️ AND THE IMPORT IS DYNAMIC SO THE ENGINE STAYS OUT OF THE ENTRY CHUNK.
// `entryGraph.test.ts` seeds `src/lib/flyover/render.ts` and `programmes/index.ts` into its
// forbidden set: nothing reachable from `main.tsx` without crossing a `lazy()` may name them,
// because every page on the site downloads the entry chunk before it can paint.
//
// ⚠️ AND IT IS ALSO AN ERROR BOUNDARY, because this application has none. The band runs a
// per-frame numeric pipeline over a fetched artifact on the site's ENTRY page; without a
// boundary, any throw from it is a white screen where a missing decoration should be.
//
// The fallback's poster is `columns` rather than the rotated programme: the rotation lives
// inside the lazy chunk (it reads `PROGRAMME_IDS`), and importing it here to pick the right
// still would put the engine back in the entry chunk for one filename.

import { Component, FC, ReactNode, Suspense, lazy } from "react";
import {
  CAPTION_ROW_CLASS,
  FLYOVER_ASPECT,
  FLYOVER_H,
  FLYOVER_W,
  SWITCH_ROW_CLASS,
} from "./box";

const HomeFlyover = lazy(() => import("./HomeFlyover"));

const PosterBox: FC = () => (
  <section className="mt-6" aria-hidden="true">
    <div
      className="relative overflow-hidden rounded-lg border border-border bg-card"
      style={{ aspectRatio: FLYOVER_ASPECT }}
    >
      <img
        src="/flyover/columns.webp"
        alt=""
        width={FLYOVER_W}
        height={FLYOVER_H}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
    {/* The caption row and the switch row, reserved but empty — the same classes the real
        band uses, so the swap moves nothing. */}
    <p className={CAPTION_ROW_CLASS} />
    <div className={SWITCH_ROW_CLASS} />
  </section>
);

/**
 * ⚠️ THE ONE PLACE A THROW MAY BE SWALLOWED, and it swallows it into a complete picture.
 * `useFlyoverArtifact` already refuses a malformed artifact, so this is the second line: a
 * bug in the engine, a lost canvas context, anything unforeseen costs the BAND and not the
 * page. `componentDidCatch` logs, because a silently missing band is how one stays missing.
 */
class FlyoverBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn("flyover band failed; falling back to the poster", error);
  }

  render() {
    return this.state.failed ? <PosterBox /> : this.props.children;
  }
}

export const HomeFlyoverSlot: FC = () => (
  <FlyoverBoundary>
    <Suspense fallback={<PosterBox />}>
      <HomeFlyover />
    </Suspense>
  </FlyoverBoundary>
);

export default HomeFlyoverSlot;
