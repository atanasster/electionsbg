// `isSharedNameIdentity` — the ONE reading of "the registry says several people share this
// name", used by the /person amber card and (through identity_confidence) by the /persons chip.
//
// It exists because the claim is written by two different steps of the same resolve:
// `fold_people_n` is copied onto every person, `identity_confidence = 'shared_name'` is set
// only on the Tier-V mint. This repo has shipped that failure before — a column dropped from
// the resolver's copyRows list comes back NULL for every row, with nothing failing — so the
// helper must not depend on the two agreeing.
//
//   npm run test:unit

import { describe, it, expect } from "vitest";
import { isSharedNameIdentity } from "./sharedNameIdentity";
// `blockFoldPeopleN` stays in usePersonProfile.ts — it is the per-BLOCK count rule, a
// different question from this predicate, and only this one is needed outside the profile.
import { blockFoldPeopleN } from "./usePersonProfile";

describe("isSharedNameIdentity", () => {
  it("is true when either signal says shared, and false only when neither does", () => {
    expect(isSharedNameIdentity({ foldPeopleN: 3 })).toBe(true);
    expect(isSharedNameIdentity({ identityConfidence: "shared_name" })).toBe(
      true,
    );
    // The point of reading both: one populated, the other not.
    expect(
      isSharedNameIdentity({
        foldPeopleN: null,
        identityConfidence: "shared_name",
      }),
    ).toBe(true);
    expect(
      isSharedNameIdentity({ foldPeopleN: 5, identityConfidence: "verified" }),
    ).toBe(true);

    expect(isSharedNameIdentity({ foldPeopleN: 1 })).toBe(false);
    expect(
      isSharedNameIdentity({ foldPeopleN: 1, identityConfidence: "verified" }),
    ).toBe(false);
  });

  it("treats UNMEASURED as not-shared, which is the only honest reading", () => {
    // null means the fold was never observed in the TR feed's window — 9.4% of folds, and
    // growing as the CR-Deeds arm widens, since that source publishes no identity key at all.
    // We cannot assert several people share the name on evidence we do not have. The weaker
    // "identity is a name match, not verified" card still renders for these people; what must
    // not happen is the STRONGER sentence being made on an absence.
    expect(isSharedNameIdentity({})).toBe(false);
    expect(isSharedNameIdentity({ foldPeopleN: null })).toBe(false);
    expect(isSharedNameIdentity({ foldPeopleN: undefined })).toBe(false);
  });
});

// `blockFoldPeopleN` — the sibling rule that decides WHICH surface states the count, so the
// profile never states it twice. It is tested here rather than at a call site because it broke
// as a call-site ternary: the NGO block was added beside the companies one passing the raw
// value, and the "none carries it twice" invariant became false for any private person holding
// a board seat, with nothing failing (that population is empty today, so nothing was live).
describe("blockFoldPeopleN", () => {
  it("withholds the count from the blocks when the identity card already states it", () => {
    // A private (Tier-V) person is the only one who sees the amber card, and the card carries
    // the same sentence — so the blocks below it must stay silent.
    expect(
      blockFoldPeopleN({ isPublicFigure: false, foldPeopleN: 3 }),
    ).toBeUndefined();
  });

  it("gives the count to the blocks for a public figure — the card never renders for them", () => {
    // The Bridge-B population this sentence exists for: identity resolved across sources, so
    // the card would be false about them, and only the per-block footer can say it.
    expect(blockFoldPeopleN({ isPublicFigure: true, foldPeopleN: 3 })).toBe(3);
  });

  it("passes an UNMEASURED fold through as null, never as 1 and never as withheld", () => {
    // The three states must stay three. Collapsing null to `undefined` here would be
    // indistinguishable from "the card said it", and collapsing it to a number would turn
    // missing evidence into a clean bill — the distinction isSharedNameIdentity guards above.
    expect(blockFoldPeopleN({ isPublicFigure: true, foldPeopleN: null })).toBe(
      null,
    );
    expect(
      blockFoldPeopleN({ isPublicFigure: true, foldPeopleN: undefined }),
    ).toBe(undefined);
  });

  it("does NOT withhold when public-figure status is unknown", () => {
    // Only an explicit `false` means "the card is showing". An absent flag — an older payload,
    // a partial fixture — must not silently suppress the caveat on every block at once.
    expect(blockFoldPeopleN({ foldPeopleN: 4 })).toBe(4);
  });
});
