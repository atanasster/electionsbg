import { describe, expect, it } from "vitest";
import { dedupeAcceptedShares } from "./dedupe_shares";

describe("dedupeAcceptedShares", () => {
  it("passes through a label mentioned once", () => {
    const claims = [{ label: "ГЕРБ-СДС", value: 20.4, quote: "q1" }];
    expect(dedupeAcceptedShares(claims)).toEqual({
      accepted: claims,
      refused: [],
    });
  });

  it("keeps every distinct label separately, even when their values collide", () => {
    // БСП / БСП-ОЛ (212732, real capture) — two DIFFERENT label spellings
    // for the same real party. dedupeAcceptedShares must not merge them
    // just because they happen to agree on the number.
    const claims = [
      { label: "БСП", value: 4, quote: "q1" },
      { label: "БСП-ОЛ", value: 4, quote: "q2" },
    ];
    expect(dedupeAcceptedShares(claims)).toEqual({
      accepted: claims,
      refused: [],
    });
  });

  it("collapses a repeated IDENTICAL label to one claim when every mention agrees", () => {
    const claims = [
      { label: "ГЕРБ-СДС", value: 20.4, quote: "headline: 20,4%" },
      { label: "ГЕРБ-СДС", value: 20.4, quote: "body: 20,4% отново" },
    ];
    const result = dedupeAcceptedShares(claims);
    expect(result.refused).toEqual([]);
    expect(result.accepted).toEqual([claims[0]]);
  });

  it("refuses — never guesses — when the same label disagrees on value across mentions", () => {
    const claims = [
      { label: "ГЕРБ-СДС", value: 20.4, quote: "headline: 20,4%" },
      { label: "ГЕРБ-СДС", value: 19.1, quote: "body: 19,1%" },
    ];
    const result = dedupeAcceptedShares(claims);
    expect(result.accepted).toEqual([]);
    expect(result.refused).toEqual([
      {
        field: "share:ГЕРБ-СДС",
        reason:
          "mentioned 2 times with disagreeing values (20.4, 19.1%) — refusing rather than guessing which is current",
        quote: "headline: 20,4% | body: 19,1%",
      },
    ]);
  });

  it("returns empty results for an empty input", () => {
    expect(dedupeAcceptedShares([])).toEqual({ accepted: [], refused: [] });
  });
});
