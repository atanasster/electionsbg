// wiki_polls is cross-check-only (docs/plans/polls-agency-watchers-v1.md
// decision 1, T0.3) and tracks TWO pages — parliamentary and presidential —
// as one source. The contract under test: the fingerprint combines both row
// counts, `describe()` names WHICH page moved, and a missing page throws
// rather than silently reporting the other page's count alone (which would
// make a presidential-page outage invisible).

import { afterEach, describe, expect, it, vi } from "vitest";

const wikitable = (rows: number) => {
  const trs = Array.from(
    { length: rows + 1 },
    (_, i) => `<tr><td>row ${i}</td></tr>`,
  ).join("");
  return `<table class="wikitable sortable">${trs}</table>`;
};

const mockFetch = (byUrl: Record<string, string | null>) =>
  vi.doMock("../fingerprint", async (orig) => ({
    ...(await orig<typeof import("../fingerprint")>()),
    fetchText: async (url: string) => {
      for (const [needle, body] of Object.entries(byUrl))
        if (url.includes(needle)) return body;
      throw new Error(`unexpected URL in test: ${url}`);
    },
  }));

// `fetchText`'s REAL failure mode (no `allow404`, per fingerprint.ts) is a
// REJECTION, not a null resolve — this source never passes `allow404`, so a
// mock resolving to null exercises a path production cannot reach.
const mockFetchThrowing = (byUrl: Record<string, string | Error>) =>
  vi.doMock("../fingerprint", async (orig) => ({
    ...(await orig<typeof import("../fingerprint")>()),
    fetchText: async (url: string) => {
      for (const [needle, bodyOrErr] of Object.entries(byUrl)) {
        if (url.includes(needle)) {
          if (bodyOrErr instanceof Error) throw bodyOrErr;
          return bodyOrErr;
        }
      }
      throw new Error(`unexpected URL in test: ${url}`);
    },
  }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../fingerprint");
});

describe("wiki_polls watch source", () => {
  it("is registered as cross-check-only, daily, over the parliamentary URL", async () => {
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    expect(source.label).toBe("BG Wikipedia polls (cross-check only)");
    expect(source.cadence).toBe("daily");
    expect(source.publishes).toBe("weekly");
    expect(source.url).toContain("Парламентарни_избори_в_България_(2026)");
  });

  it("combines both pages' row counts into one fingerprint", async () => {
    mockFetch({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: wikitable(1),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    const fp = await source.fingerprint();
    expect(fp.value).toBe("113:1");
    expect(fp.detail).toBe(
      "113 parliamentary + 1 presidential poll table rows",
    );
    expect(fp.meta).toEqual({ parlRows: 113, presRows: 1 });
  });

  it("names which page changed, and by how much", async () => {
    mockFetch({
      Парламентарни_избори: wikitable(115),
      Президентски_избори: wikitable(2),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    const fp = await source.fingerprint();
    const line = source.describe!(
      {
        fingerprint: "113:1",
        detail: "113 parliamentary + 1 presidential poll table rows",
        meta: { parlRows: 113, presRows: 1 },
        lastChecked: "2026-09-08T00:00:00.000Z",
        lastChanged: "2026-09-01T00:00:00.000Z",
      },
      fp,
    );
    expect(line).toBe(
      "parliamentary +2 rows (113 → 115), presidential +1 rows (1 → 2) since 2026-09-01",
    );
  });

  it("names only the presidential page when only it moved", async () => {
    mockFetch({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: wikitable(2),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    const fp = await source.fingerprint();
    const line = source.describe!(
      {
        fingerprint: "113:1",
        detail: "113 parliamentary + 1 presidential poll table rows",
        meta: { parlRows: 113, presRows: 1 },
        lastChecked: "2026-09-08T00:00:00.000Z",
        lastChanged: "2026-09-01T00:00:00.000Z",
      },
      fp,
    );
    expect(line).toBe("presidential +1 rows (1 → 2) since 2026-09-01");
    expect(line).not.toContain("parliamentary");
  });

  it("reports the unchanged detail when neither count moved", async () => {
    mockFetch({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: wikitable(1),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    const fp = await source.fingerprint();
    const line = source.describe!(
      {
        fingerprint: "113:1",
        detail: "113 parliamentary + 1 presidential poll table rows",
        meta: { parlRows: 113, presRows: 1 },
        lastChecked: "2026-09-08T00:00:00.000Z",
        lastChanged: "2026-09-01T00:00:00.000Z",
      },
      fp,
    );
    expect(line).toBe(fp.detail);
  });

  it("throws rather than silently reporting one page's count alone, on an EMPTY body", async () => {
    mockFetch({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: null,
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    await expect(source.fingerprint()).rejects.toThrow(/presidential/);
  });

  it("throws when the parliamentary page has an EMPTY body", async () => {
    mockFetch({
      Парламентарни_избори: null,
      Президентски_избори: wikitable(1),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    await expect(source.fingerprint()).rejects.toThrow(/parliamentary/);
  });

  // The realistic failure mode: `fetchText` (no `allow404`) THROWS on a real
  // HTTP error rather than resolving null. Without per-page attribution,
  // Promise.all would surface the bare "HTTP 500" with no page name at all.
  it("names the failing page when fetchText THROWS (the real fetchText contract)", async () => {
    mockFetchThrowing({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: new Error("HTTP 500"),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    await expect(source.fingerprint()).rejects.toThrow(
      /presidential.*HTTP 500/,
    );
  });

  it("names the failing page when the parliamentary fetch THROWS", async () => {
    mockFetchThrowing({
      Парламентарни_избори: new Error("HTTP 404"),
      Президентски_избори: wikitable(1),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    await expect(source.fingerprint()).rejects.toThrow(
      /parliamentary.*HTTP 404/,
    );
  });

  it("does not fabricate a delta against the pre-migration single-count state shape", async () => {
    // The live committed state/watch/wiki_polls.json predates this two-page
    // meta shape: { rows: 113 }, not { parlRows, presRows }. With a naive
    // `?? 0` fallback this would report "parliamentary +113 rows (0 → 113)"
    // on the very first run after this ships, even though nothing changed.
    mockFetch({
      Парламентарни_избори: wikitable(113),
      Президентски_избори: wikitable(1),
    });
    const { SOURCES } = await import("./index");
    const source = SOURCES.find((s) => s.id === "wiki_polls")!;
    const fp = await source.fingerprint();
    const line = source.describe!(
      {
        fingerprint: "113",
        detail: "113 poll table rows",
        meta: { rows: 113 },
        lastChecked: "2026-09-08T00:00:00.000Z",
        lastChanged: "2026-05-11T00:00:00.000Z",
      },
      fp,
    );
    expect(line).toBe(fp.detail);
    expect(line).not.toContain("+113");
  });
});
