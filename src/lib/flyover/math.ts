// The scalar rules the camera and the state both interpolate with.
//
// They live here rather than in either of those files because both need them and a cycle
// between the two would be the alternative — and because a second copy of `lerpAngle` is the
// classic way a camera path acquires a 340° spin in one caller and not the other.

/**
 * Clamp to [0, 1].
 *
 * ⚠️ `NaN` CLAMPS TO 0 rather than passing through, and this is the ONE gate in front of
 * `blend`, `blendCamera` and `smoothstep`. All three hosts derive `k` by division — `/` from a
 * rAF clock, the article from a scroll ratio, Remotion from `frame / (fps * duration)` — so a
 * `0/0` on a first frame, a zero duration or a scroll measured before layout all produce one.
 * Left ungated, every number in the state becomes NaN and the canvas draws nothing, while
 * `highlight` and `captionId` still advance (both `NaN < 0.5` comparisons are false, so both
 * take the `b` branch): a blank picture with a caption confidently narrating it, which reads
 * as a renderer bug three modules from the caller that produced the NaN.
 *
 * The test is inverted for that reason — the fall-through case is 0, not `k`.
 */
export const clamp01 = (k: number): number => (k > 0 ? (k > 1 ? 1 : k) : 0);

export const lerp = (a: number, b: number, k: number): number =>
  a + (b - a) * k;

/**
 * Interpolate an angle in DEGREES the short way around.
 *
 * ⚠️ Plain `lerp` on a yaw crossing 0° sweeps the camera 340° the wrong way in the time it
 * should take to move 20°. The failure is a spin — obvious once seen, invisible in a keyframe
 * table.
 *
 * ⚠️ THE ENDPOINTS RETURN THEIR INPUT EXACTLY, and that is not cosmetic. The short-way sum
 * from 350° to 10° lands on 370°, which is the same ROTATION and a different NUMBER — so
 * without this, `blend(a, b, 1)` is not value-equal to `b`, and Remotion's timeline compares
 * states at every scene boundary. In between, the value may legitimately sit outside
 * [0, 360): every consumer feeds it to `Math.sin`/`Math.cos`, where 370° and 10° are the same
 * angle, so normalising the whole range instead would break the identity at the other end for
 * any keyframe written as a negative yaw.
 */
export const lerpAngle = (a: number, b: number, k: number): number => {
  // ⚠️ Both of these are FALSE for NaN, so the NaN case is caught here rather than falling
  // through to arithmetic — this function does not route through `clamp01`.
  if (!(k > 0)) return a;
  if (k >= 1) return b;
  let d = ((((b - a) % 360) + 540) % 360) - 180;
  // −180 and +180 are the same rotation; prefer the positive one so the result does not
  // depend on a floating-point sign.
  if (d === -180) d = 180;
  return a + d * k;
};

/** Ease-in-out, so a camera arrives and departs at rest rather than snapping. */
export const smoothstep = (k: number): number => {
  const t = clamp01(k);
  return t * t * (3 - 2 * t);
};
