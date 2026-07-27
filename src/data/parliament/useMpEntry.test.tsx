// Unit test for the fetchMpEntry client contract after the T2.1 cutover to the PG
// /api/db/mp-entry route (persons-pg-retirement-v1). The payload SHAPE parity vs the old
// shard is pinned by scripts/db/tests/mp_serving.data.test.ts; this pins the client's
// branching — miss→null (so useMps fallback fires), non-ok→null, array/non-object→null, and
// the hydrate (relative photoUrl→dataUrl, http passthrough; normalizedName re-canonicalised).
// No DB, no network: fetch is stubbed (an unstubbed fetch throws in jsdom).

import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchMpEntry } from "./useMpEntry";
import { dataUrl } from "@/data/dataUrl";
import { normalizeMpName } from "@/lib/utils";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchMpEntry", () => {
  it("returns null on a null body (unknown id) so callers fall back to useMps", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(null)));
    expect(await fetchMpEntry(999)).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    expect(await fetchMpEntry(1)).toBeNull();
  });

  it("returns null on a non-JSON 200 (misroute / SPA fallthrough)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    expect(await fetchMpEntry(1)).toBeNull();
  });

  it("returns null on an array body (never spread into hydrate)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    expect(await fetchMpEntry(1)).toBeNull();
  });

  it("hydrates a relative photoUrl through dataUrl and re-canonicalises names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 5060,
          name: "Коста Георгиев Стоянов",
          normalizedName: "КОСТА ГЕОРГИЕВ СТОЯНОВ",
          normalizedName_en: "KOSTA GEORGIEV STOYANOV",
          photoUrl: "/parliament/photos/5060.webp",
          isCurrent: true,
        }),
      ),
    );
    const entry = await fetchMpEntry(5060);
    expect(entry?.id).toBe(5060);
    expect(entry?.photoUrl).toBe(dataUrl("/parliament/photos/5060.webp"));
    expect(entry?.normalizedName).toBe(
      normalizeMpName("КОСТА ГЕОРГИЕВ СТОЯНОВ"),
    );
  });

  it("passes an absolute (http) photoUrl through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 7,
          name: "N",
          normalizedName: "N",
          normalizedName_en: "N",
          photoUrl: "https://example.test/portrait.jpg",
          isCurrent: false,
        }),
      ),
    );
    const entry = await fetchMpEntry(7);
    expect(entry?.photoUrl).toBe("https://example.test/portrait.jpg");
  });
});
