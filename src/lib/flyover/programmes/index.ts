// A programme is a keyframe timeline, and `stateAt` is how `/` and the article read one.
// `docs/plans/home-flyover-v1.md` §0.2 and §5.
//
// ⚠️ REMOTION DOES NOT USE ANY OF THIS. Its `resolveTimeline` blends each scene's PARTIAL
// state over the durations the NARRATION measured, so a fixed-length loop would not have
// fitted — that is why the engine's unit is a blendable `FlyoverState` and why the tour's
// chapter states are exported separately (`tour.ts`) rather than being reachable only through
// a `t`. The home band and the article share `stateAt`; the video shares the STATES.
//
// ⚠️ AND A KEYFRAME IS A PATCH, NOT A PICTURE. Each one accretes onto the resolved state
// before it — the same rule `applyPartial` states for Remotion — so a keyframe that says
// nothing about the arcs keeps them, and one that wants them off must say `arcs: 0`. Writing
// keyframes as complete states instead would work and would make every camera edit a
// thirteen-field rewrite.

import {
  blend,
  applyPartial,
  cloneState,
  STATE_ZERO,
  type FlyoverState,
} from "../state";
import { smoothstep } from "../math";
import { COLUMNS } from "./columns";
import { ARCS } from "./arcs";
import { TOUR } from "./tour";

export type ProgrammeId = "columns" | "arcs" | "tour";

export interface Keyframe {
  /** Seconds into the loop. The first must be 0; `validateProgramme` refuses otherwise. */
  t: number;
  /** Accreted onto the resolved state before it — see the header. */
  state: Partial<FlyoverState>;
  /**
   * Seconds to HOLD this state before easing to the next. A camera that never rests reads as
   * drifting rather than as looking at something, and a caption needs time to be read.
   */
  dwell?: number;
}

export interface Programme {
  id: ProgrammeId;
  /** Seconds. The loop closes: at `duration` the state is the first keyframe's again. */
  duration: number;
  keyframes: Keyframe[];
}

export const PROGRAMMES: Record<ProgrammeId, Programme> = {
  columns: COLUMNS,
  arcs: ARCS,
  tour: TOUR,
};

/** In rotation order — `rotation.ts` indexes this, so it is the ONE place the order lives. */
export const PROGRAMME_IDS: readonly ProgrammeId[] = [
  "columns",
  "arcs",
  "tour",
];

/**
 * Refuse a timeline that cannot be read, rather than drawing a wrong picture from it.
 *
 * Every condition here is a mistake a keyframe table invites: a first frame that is not at 0
 * (the loop would jump), unsorted times (a segment of negative length divides by zero), a
 * dwell longer than its own segment (the ease never runs, so the camera teleports), and a
 * duration at or before the last keyframe (the closing segment inverts).
 */
export const validateProgramme = (p: Programme): void => {
  const { keyframes: kf, duration, id } = p;
  if (!kf.length) throw new Error(`flyover programme ${id}: no keyframes`);
  if (kf[0]!.t !== 0) {
    throw new Error(
      `flyover programme ${id}: the first keyframe must be at t=0`,
    );
  }
  for (let i = 1; i < kf.length; i++) {
    if (!(kf[i]!.t > kf[i - 1]!.t)) {
      throw new Error(
        `flyover programme ${id}: keyframe ${i} is at t=${kf[i]!.t}, not after ${kf[i - 1]!.t}`,
      );
    }
  }
  if (!(duration > kf[kf.length - 1]!.t)) {
    throw new Error(
      `flyover programme ${id}: duration ${duration} does not exceed the last keyframe`,
    );
  }
  for (let i = 0; i < kf.length; i++) {
    const span = (kf[i + 1]?.t ?? duration) - kf[i]!.t;
    const dwell = kf[i]!.dwell ?? 0;
    // ⚠️ BOTH ENDS. Too long and the ease never runs, so the camera teleports; NEGATIVE and
    // the ease starts BEFORE its own keyframe, so the state AT `kf.t` is a blend rather than
    // the keyframe — measured, a 317-unit camera jump at the very frame `dwell` exists to
    // hold. `NaN` fails `>= 0` and is refused here too, rather than freezing a whole segment.
    if (!(dwell >= 0)) {
      throw new Error(
        `flyover programme ${id}: keyframe ${i} has a negative or non-finite dwell (${kf[i]!.dwell})`,
      );
    }
    if (dwell > span) {
      throw new Error(
        `flyover programme ${id}: keyframe ${i} dwells ${dwell}s inside a ${span}s segment`,
      );
    }
  }
};

for (const p of Object.values(PROGRAMMES)) validateProgramme(p);

/**
 * Each keyframe's state, with the accretion already applied. Computed once per programme.
 *
 * ⚠️ KEYED ON THE PROGRAMME OBJECT, NEVER ON `p.id`. An id does not identify a timeline — a
 * preview slice, a Remotion trim or a test fixture legitimately keeps the id and changes the
 * keyframes — and under an id key `stateAt` walks one table's keyframes against another's
 * states: silently the wrong picture when the cached table is longer, and a TypeError inside
 * `blend` when it is shorter, three modules from the cause.
 */
const RESOLVED = new WeakMap<Programme, FlyoverState[]>();

/**
 * ⚠️ The returned array and its states are the CACHE'S OWN. Read them; do not write them.
 * `stateAt` clones on every path for that reason.
 */
export const resolvedStates = (p: Programme): FlyoverState[] => {
  const cached = RESOLVED.get(p);
  if (cached) return cached;
  const out: FlyoverState[] = [];
  let running = STATE_ZERO;
  for (const kf of p.keyframes) {
    running = applyPartial(running, kf.state);
    out.push(running);
  }
  RESOLVED.set(p, out);
  return out;
};

/**
 * The state a programme is in `t` seconds into its loop. The result is always a FRESH object
 * the caller owns.
 *
 * `t` wraps, so a host can pass a monotonically increasing clock and never think about the
 * loop. A non-finite `t` reads as 0 rather than propagating: every host derives it by
 * division, and the alternative is `blend`'s NaN gate producing the first frame anyway but
 * three modules further from the cause.
 */
export const stateAt = (p: Programme, t: number): FlyoverState => {
  const states = resolvedStates(p);
  const kf = p.keyframes;
  const time = Number.isFinite(t)
    ? ((t % p.duration) + p.duration) % p.duration
    : 0;

  let i = 0;
  for (let j = kf.length - 1; j >= 0; j--) {
    if (time >= kf[j]!.t) {
      i = j;
      break;
    }
  }
  const from = states[i]!;
  // The last segment closes the loop back onto the first keyframe, which is what makes
  // `stateAt(p, duration) === stateAt(p, 0)` and lets a band run for ever without a seam.
  const to = states[i + 1] ?? states[0]!;
  const start = kf[i]!.t;
  const end = kf[i + 1]?.t ?? p.duration;
  const dwell = kf[i]!.dwell ?? 0;
  const elapsed = time - start;
  // ⚠️ CLONE, NEVER ALIAS. `from` is the cache's own object, and `blend` below allocates — so
  // without this the band is handed a live keyframe state for the whole of every dwell, and
  // one in-place write by a host permanently corrupts the keyframe table for the process,
  // with nothing failing. The rule and the reasoning are `state.ts`'s (`cloneState`,
  // `applyPartial`), and the host is being written next by an author that file tells the
  // returned state is theirs to hold.
  if (elapsed <= dwell) return cloneState(from);
  const span = end - start - dwell;
  if (span <= 0) return cloneState(from);
  return blend(from, to, smoothstep((elapsed - dwell) / span));
};
