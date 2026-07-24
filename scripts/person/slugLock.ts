// Stable-slug selection for the person resolver (migration 099, table person_slug_lock).
//
// A person who is neither an MP nor an official gets a name-hash slug whose hash is over the
// exact set of member mentions — so any cluster drift reassigns it, breaking bookmarked
// /person links and the browser-local watchlist (which stores slugs). To keep the URL stable,
// a person reuses the slug persisted for one of its member mentions instead of re-deriving it.
//
// Extracted as a pure function so the reuse rule is unit-tested independently of the (large,
// DB-bound) resolve.

export type SlugLock = { slug: string; firstSeen: number };

/**
 * Pick a person's slug.
 *
 * - `anchored` (the person is an MP or an official) → always the natural slug; those tiers are
 *   already stable (mp-<id> / the officials ref) and are never locked over.
 * - otherwise reuse the persisted slug of the person's OLDEST previously-seen member mention
 *   — the "founding" anchor — falling back to the freshly derived name-hash for a wholly new
 *   person. "Oldest" is by `firstSeen`, then by slug so a tie (a whole seeding run shares one
 *   timestamp) resolves the same way on every run rather than by map/iteration order.
 *
 * NOTE the anchor is the oldest RETAINED member: if a person later absorbs a member with an
 * even earlier lock, it re-anchors to that member's slug (the merge case).
 */
export const chooseStableSlug = (
  naturalSlug: string,
  anchored: boolean,
  memberIds: readonly string[],
  locks: ReadonlyMap<string, SlugLock>,
): string => {
  if (anchored) return naturalSlug;
  let best: SlugLock | undefined;
  for (const id of memberIds) {
    const lock = locks.get(id);
    if (!lock) continue;
    if (
      !best ||
      lock.firstSeen < best.firstSeen ||
      (lock.firstSeen === best.firstSeen && lock.slug < best.slug)
    )
      best = lock;
  }
  return best ? best.slug : naturalSlug;
};
