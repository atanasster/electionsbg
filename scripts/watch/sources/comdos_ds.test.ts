// The comdos watcher: fingerprints the DecisionID set on archive page 1 with the
// crawler's own parser, and degrades to a stable sentinel rather than flapping.

import { afterEach, describe, expect, it, vi } from "vitest";

const fetchText = vi.hoisted(() => vi.fn());
vi.mock("../fingerprint", async (orig) => ({
  ...(await orig<typeof import("../fingerprint")>()),
  fetchText,
}));

const { comdosDs } = await import("./comdos_ds");

const page = (ids: number[]) =>
  ids
    .map(
      (id) =>
        `<a href="/x?DecisionID=${id}">Решение № 3-${id} от 01.01.2026 г.</a>`,
    )
    .join("\n") +
  // the „>>" sidebar repeats page-1 rows and must not move the fingerprint
  `<a href="/x?DecisionID=1">&gt;&gt; Решение № 3-1</a>`;

afterEach(() => fetchText.mockReset());

describe("comdos_ds", () => {
  it("keys the value on the latest id plus a hash of the id set", async () => {
    fetchText.mockResolvedValue(page([2201, 2200, 2199]));
    const fp = await comdosDs.fingerprint();
    expect(fp.value).toMatch(/^2201:[0-9a-f]+$/);
    expect(fp.meta).toEqual({ count: 3, latest: 2201 });
  });

  it("is order-insensitive and moves when a decision is added", async () => {
    fetchText.mockResolvedValue(page([2199, 2201, 2200]));
    const a = (await comdosDs.fingerprint()).value;
    fetchText.mockResolvedValue(page([2201, 2200, 2199]));
    expect((await comdosDs.fingerprint()).value).toBe(a);
    fetchText.mockResolvedValue(page([2202, 2201, 2200, 2199]));
    expect((await comdosDs.fingerprint()).value).not.toBe(a);
  });

  it("returns the sentinel on a failed fetch and on a page with no rows", async () => {
    fetchText.mockRejectedValue(new Error("ECONNRESET"));
    expect((await comdosDs.fingerprint()).value).toBe("unreachable");
    fetchText.mockReset();
    fetchText.mockResolvedValue("<html>maintenance</html>");
    expect((await comdosDs.fingerprint()).value).toBe("unreachable");
  });

  it("describes the move, and falls back to the detail on old state", async () => {
    fetchText.mockResolvedValue(page([2202, 2201]));
    const curr = await comdosDs.fingerprint();
    expect(
      comdosDs.describe!({ value: "x", meta: { latest: 2201 } } as never, curr),
    ).toContain("2201 → 2202");
    // state written by the previous watcher carried only `count`
    expect(
      comdosDs.describe!({ value: "x", meta: { count: 7 } } as never, curr),
    ).toContain("latest DecisionID 2202");
  });
});
