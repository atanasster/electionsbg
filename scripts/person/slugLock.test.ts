// Unit tests for the stable-slug reuse rule (migration 099). These pin the behaviour the
// resolver relies on to keep /person URLs stable across re-resolves.

import { describe, it, expect } from "vitest";
import { chooseStableSlug, type SlugLock } from "./slugLock";

const locks = (entries: Record<string, SlugLock>): Map<string, SlugLock> =>
  new Map(Object.entries(entries));

describe("chooseStableSlug", () => {
  it("mints the natural slug for a wholly new person (no locks)", () => {
    expect(
      chooseStableSlug("ivan-petrov-a1b2c3", false, ["cand:x"], locks({})),
    ).toBe("ivan-petrov-a1b2c3");
  });

  it("reuses the locked slug of a returning name-hash person", () => {
    expect(
      chooseStableSlug(
        "ivan-petrov-NEWHASH", // cluster drifted → different derived hash
        false,
        ["cand:x", "donor:y"],
        locks({ "cand:x": { slug: "ivan-petrov-a1b2c3", firstSeen: 100 } }),
      ),
    ).toBe("ivan-petrov-a1b2c3");
  });

  it("never locks over an anchored (MP/official) person", () => {
    expect(
      chooseStableSlug(
        "mp-5186",
        true,
        ["cand:x"],
        locks({ "cand:x": { slug: "old-name-hash", firstSeen: 100 } }),
      ),
    ).toBe("mp-5186");
  });

  it("anchors to the OLDEST member when several are locked (merge case)", () => {
    expect(
      chooseStableSlug(
        "derived-hash",
        false,
        ["a", "b", "c"],
        locks({
          a: { slug: "slug-newer", firstSeen: 300 },
          b: { slug: "slug-oldest", firstSeen: 100 },
          c: { slug: "slug-mid", firstSeen: 200 },
        }),
      ),
    ).toBe("slug-oldest");
  });

  it("breaks a first_seen tie by slug, deterministically (not by member order)", () => {
    const l = locks({
      a: { slug: "slug-b", firstSeen: 100 },
      b: { slug: "slug-a", firstSeen: 100 },
    });
    // Same tie whichever order the member ids arrive in.
    expect(chooseStableSlug("d", false, ["a", "b"], l)).toBe("slug-a");
    expect(chooseStableSlug("d", false, ["b", "a"], l)).toBe("slug-a");
  });

  it("falls back to the natural slug when none of the members are locked", () => {
    expect(
      chooseStableSlug(
        "fresh-hash",
        false,
        ["new1", "new2"],
        locks({ "unrelated:z": { slug: "other", firstSeen: 1 } }),
      ),
    ).toBe("fresh-hash");
  });
});
