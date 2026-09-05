// Which of the three programmes a visitor sees — `docs/plans/home-flyover-v1.md` §0.4 and §8.2.
//
// The user's instruction was „place them on the home page; if they don't fit, we can randomly
// switch them". They do not fit: three moving scenes above the eight destinations would
// compete with the routing job the page exists to do. So `/` gets ONE band holding ONE
// programme per visit, rotated deterministically, with a visible switch so a reader can reach
// the other two.
//
// ⚠️ PURE, AND IT READS NO STORAGE. `sessionStorage`, `location` and the clock are the HOST's
// — the engine may not touch the DOM (three callers, three runtimes; `isolation.test.ts`
// enforces it), and a rotation that read the environment could not be tested for the property
// that matters: the same visitor-day must produce the same programme on every render, or the
// band would change scene under a reader mid-visit.

import { PROGRAMME_IDS, type ProgrammeId } from "./programmes";

/** Days since the epoch, UTC — the host's clock, turned into the rotation's input. */
export const utcDayIndex = (nowMs: number): number =>
  Math.floor(nowMs / 86_400_000);

/**
 * Is this a programme id? The host passes `?scene=` straight from the URL, so this is the
 * validation, and an unknown value must fall through to the rotation rather than to an empty
 * band.
 */
export const isProgrammeId = (v: string | null | undefined): v is ProgrammeId =>
  !!v && (PROGRAMME_IDS as readonly string[]).includes(v);

export interface RotationInput {
  /** `utcDayIndex(Date.now())`, from the host. */
  dayIndex: number;
  /**
   * A per-SESSION integer the host mints once. Two readers on one day see different scenes,
   * and one reader navigating back within a session sees the same one — a band that reshuffled
   * on every mount would make the switch control meaningless.
   */
  seed: number;
  /** `?scene=`, or the switch the reader clicked. Wins over everything. */
  override?: string | null;
}

/**
 * ⚠️ DETERMINISTIC PER (visitor, day), NEVER PER RENDER. React re-renders for reasons that
 * have nothing to do with the band — a fetch settling, a language change — and a rotation
 * evaluated fresh each time would swap the scene under a reader mid-sentence.
 */
export const programmeFor = ({
  dayIndex,
  seed,
  override,
}: RotationInput): ProgrammeId => {
  if (isProgrammeId(override)) return override;
  const n = PROGRAMME_IDS.length;
  // ⚠️ NON-FINITE READS AS 0, it does not propagate — the rule `stateAt` states for `t`, and
  // with more force here because nothing downstream gates it. The host derives BOTH of these
  // from the environment (a clock, a `sessionStorage` value it parsed), so `NaN` is the
  // ordinary cleared-storage path — and `PROGRAMME_IDS[NaN]` is `undefined` returned AS a
  // `ProgrammeId`, i.e. the empty band this file exists to rule out, invisible to every
  // consumer until `stateAt` throws on `p.duration`.
  const day = Number.isFinite(dayIndex) ? Math.trunc(dayIndex) : 0;
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  // Both can also be negative (a clock before 1970, a seed from a signed source), and `%` in
  // JavaScript keeps the sign — which would index off the front of the array.
  const i = (((day + s) % n) + n) % n;
  return PROGRAMME_IDS[i]!;
};

/**
 * A fresh session seed. The host stores it; only `seed % PROGRAMME_IDS.length` is ever read.
 *
 * ⚠️ THE `PROGRAMME_IDS.length` FACTOR IS LOAD-BEARING, not decoration: it makes the range
 * `[0, n*1000)` an exact multiple of `n`, so `seed % n` is uniform for any number of
 * programmes. A plain `* 1000` biases the first bucket — a little at n = 3, and more at an
 * `n` that does not divide 1000.
 */
export const mintSeed = (random: () => number): number =>
  Math.floor(random() * PROGRAMME_IDS.length * 1000);
