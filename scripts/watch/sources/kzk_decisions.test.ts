// The kzk_decisions watch source is not merely a change detector — its `meta` is
// the anchor for the freshness gate. scripts/db/tests/kzk_decisions.data.test.ts
// reads `newestAct` out of the COMMITTED state file and asserts that act is
// present in the `kzk_decisions` table, which is what makes the gate exact and
// offline rather than a flaky calendar threshold.
//
// So the contract under test is: the fingerprint always publishes newestAct and
// newestDate when the page has any acts at all, and it THROWS rather than
// returning a stable value when the markup stops being recognisable — because a
// silently-constant fingerprint is precisely the blindness this source exists to
// end.

import { describe, it, expect, vi, afterEach } from "vitest";
import { SOURCES } from "./index";

const source = SOURCES.find((s) => s.id === "kzk_decisions")!;

// One page-1 render, close to what the register emits: a total with a
// non-breaking thousands separator and newest-first act numbers.
const PAGE = `
  <div>Намерени са общо 4&nbsp;407 акта за 2026 година.</div>
  <table>
    <tr><td>1</td><td>Акт № АКТ-608-25.06.2026</td></tr>
    <tr><td>2</td><td>Акт № АКТ-607-25.06.2026</td></tr>
    <tr><td>3</td><td>Акт № АКТ-606-24.06.2026</td></tr>
  </table>`.replace(/&nbsp;/g, " ");

const mockFetch = (body: string | null) =>
  vi.doMock("../fingerprint", async (orig) => ({
    ...(await orig<typeof import("../fingerprint")>()),
    fetchText: async () => body,
  }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../fingerprint");
});

describe("kzk_decisions watch source", () => {
  it("is registered, weekly, and points at the shared register URL", async () => {
    const { DECISIONS_LIST_URL } =
      await import("../../procurement/kzk_decisions_store");
    expect(source).toBeDefined();
    expect(source.cadence).toBe("weekly");
    // Shared constant, not a second copy: if КЗК moves the register, the watcher
    // cannot keep polling an address the crawler has abandoned.
    expect(source.url).toBe(DECISIONS_LIST_URL);
  });

  it("is a SEPARATE source from the intake arm", () => {
    // The whole defect was one watcher covering only the intake register.
    const ids = SOURCES.filter((s) => s.id.startsWith("kzk")).map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["kzk_appeals", "kzk_decisions"]),
    );
  });

  it("publishes newestAct and newestDate — the gate's anchor", async () => {
    mockFetch(PAGE);
    const { kzkDecisions } = await import("./kzk_decisions");
    const fp = await kzkDecisions.fingerprint();
    expect(fp.meta?.total).toBe(4407);
    expect(fp.meta?.newestAct).toBe("АКТ-608-25.06.2026");
    expect(fp.meta?.newestDate).toBe("2026-06-25");
    expect(fp.value).toMatch(/^[0-9a-f]+$/);
  });

  it("does not splice the total across a line break", async () => {
    mockFetch("Намерени са общо 4407\n1 акта\nАкт № АКТ-1-01.01.2026");
    const { kzkDecisions } = await import("./kzk_decisions");
    expect((await kzkDecisions.fingerprint()).meta?.total).toBe(4407);
  });

  it("THROWS on unrecognised markup rather than returning a stable value", async () => {
    // A fingerprint that silently stops changing is indistinguishable from
    // "nothing was published", which is exactly how five weeks went unnoticed.
    mockFetch("<html><body>Сайтът е в профилактика</body></html>");
    const { kzkDecisions } = await import("./kzk_decisions");
    await expect(kzkDecisions.fingerprint()).rejects.toThrow(
      /markup not recognised/,
    );
  });

  it("THROWS on a PARTIAL read, not just a total failure", async () => {
    // The guard is `||`, not `&&`. With `&&`, an act-number format change alone
    // would leave meta.newestAct null while the fingerprint kept flipping off the
    // total — so the T6 gate's anchor goes dark while the watcher still reports
    // "changed". That is the same blindness this source exists to end.
    mockFetch("Намерени са общо 4 407 акта за 2026 година. (no act numbers)");
    const { kzkDecisions } = await import("./kzk_decisions");
    await expect(kzkDecisions.fingerprint()).rejects.toThrow(
      /markup not recognised/,
    );
  });

  it("THROWS on an empty response (the non-BG-egress 403 case)", async () => {
    mockFetch(null);
    const { kzkDecisions } = await import("./kzk_decisions");
    await expect(kzkDecisions.fingerprint()).rejects.toThrow(/BG egress/);
  });

  it("describes a change as a signed act delta", async () => {
    mockFetch(PAGE);
    const { kzkDecisions } = await import("./kzk_decisions");
    const curr = await kzkDecisions.fingerprint();
    const line = kzkDecisions.describe!(
      {
        fingerprint: "old",
        detail: "",
        meta: { total: 4400 },
        lastChecked: "",
        lastChanged: "",
      },
      curr,
    );
    expect(line).toMatch(/\+7 КЗК acts \(4400 → 4407\)/);
    expect(line).toMatch(/АКТ-608-25\.06\.2026/);
  });
});
