import { describe, expect, it } from "vitest";
import { carryFailedProbe, flippedObshtini } from "./municipal_naredba";
import type { WatchState } from "../types";

const ok = {
  url: "https://x/n.pdf",
  status: 200,
  length: "10",
  lastModified: "a",
};

describe("municipal_naredba — a failed probe is not a change", () => {
  it("carries the same url's previous observation forward on status 0", () => {
    expect(carryFailedProbe({ url: ok.url, status: 0 }, [ok])).toEqual(ok);
    // Different url, or nothing earlier: nothing to carry.
    expect(
      carryFailedProbe({ url: "https://x/other.pdf", status: 0 }, [ok]),
    ).toEqual({ url: "https://x/other.pdf", status: 0 });
    // A real answer wins.
    const moved = { ...ok, length: "11" };
    expect(carryFailedProbe(moved, [ok])).toEqual(moved);
  });

  it("does not scope a município whose probe failed", () => {
    const prev: WatchState = {
      fingerprint: "a",
      detail: "d",
      meta: { perObshtina: { SOF00: [ok] } },
      lastChecked: "t",
      lastChanged: "t",
    };
    const curr = {
      value: "a",
      detail: "d",
      meta: {
        perObshtina: {
          SOF00: [carryFailedProbe({ url: ok.url, status: 0 }, [ok])],
        },
      },
    };
    expect(flippedObshtini(prev, curr)).toEqual([]);
  });
});
