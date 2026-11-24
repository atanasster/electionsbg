// The pitay ЗДОИ watcher: the newest application id is the fingerprint, and a failed
// fetch is an ERROR for the runner, never a fingerprint that would read as a change.

import { afterEach, describe, expect, it, vi } from "vitest";

const fetchText = vi.hoisted(() => vi.fn());
vi.mock("../fingerprint", async (orig) => ({
  ...(await orig<typeof import("../fingerprint")>()),
  fetchText,
}));

const { zdoiPitay } = await import("./zdoi_pitay");

const front = (...ids: number[]) =>
  ids.map((id) => `<a href="/application/${id}/view">x</a>`).join("");

afterEach(() => fetchText.mockReset());

describe("zdoi_pitay", () => {
  it("fingerprints the newest application id on the front page", async () => {
    fetchText.mockResolvedValue(front(22940, 22945, 22931));
    const fp = await zdoiPitay.fingerprint();
    expect(fp.value).toBe("22945");
    expect(
      zdoiPitay.describe!({ meta: { latest: 22940 } } as never, fp),
    ).toMatch(/5 new ЗДОИ request\(s\), newest id 22940 → 22945/);
  });

  it("throws on an unreachable site or a page with no applications", async () => {
    fetchText.mockResolvedValue(null);
    await expect(zdoiPitay.fingerprint()).rejects.toThrow();
    fetchText.mockResolvedValue("<html>maintenance</html>");
    await expect(zdoiPitay.fingerprint()).rejects.toThrow(
      /no application links/,
    );
  });
});
