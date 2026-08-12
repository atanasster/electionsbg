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
import { isSharedNameIdentity } from "./usePersonProfile";

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
