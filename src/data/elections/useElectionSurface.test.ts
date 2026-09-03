// The fetch layer's contract.
//
// ⚠ THE STATES ARE THE POINT. Five different things can mean "no surface here", and only two of
// them are wrong: an unpublished cycle is §12's designed fallback, a level served from its
// canonical shard is §5.0's design, an unresolved route param is a SKELETON, and a kind × level
// that does not exist is a rendered reason. Collapsing any of them into the others is how a page
// ends up rendering the legacy body while its id is merely still loading — and never
// re-rendering, because a fallback is not a suspended state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import {
  __resetSurfaceWarnings,
  RENDERS_SURFACE,
  fetchSurface,
  rendersSurface,
  warnOnce,
} from "./useElectionSurface";
import { queryClient } from "../queryClient";
import { parliamentaryCountry } from "./fixtures/surfaceFixtures";
import { ELECTION_SURFACE_VERSION } from "./surfaceTypes";

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    url: "https://example.test/x.json",
    json: async () => body,
  }) as unknown as Response;

describe("the app's fetch posture", () => {
  it("carries staleTime and no refetch-on-focus GLOBALLY", () => {
    // ⚠ ASSERTED ON THE SHARED CLIENT, NOT RESTATED IN THE HOOK. React Query's OWN defaults
    // refetch on every window focus — on the highest-traffic pages on the site — and the plan
    // notes no gate would catch it. The repo already overrides them once, in `queryClient.ts`;
    // this is what stops that single definition being quietly relaxed.
    const d = queryClient.getDefaultOptions().queries;
    expect(d?.staleTime).toBe(Infinity);
    expect(d?.refetchOnWindowFocus).toBe(false);
    expect(d?.refetchOnReconnect).toBe(false);
  });
});

describe("fetchSurface", () => {
  beforeEach(() => __resetSurfaceWarnings());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the surface when the artifact is published and valid", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(parliamentaryCountry));
    const r = await fetchSurface("c/surface/country.json");
    expect(r.status).toBe("ready");
    expect(r.status === "ready" && r.surface.place.level).toBe("country");
  });

  it("treats a 404 as ABSENT, not an error", async () => {
    // ⚠ §12's DESIGNED FALLBACK. v1 publishes three cycles; a 404 is the expected answer for
    // most of the corpus. Throwing would put every unmigrated cycle into React Query's
    // retry-and-error path and turn a planned fallback into a visible failure.
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    await expect(fetchSurface("c/surface/country.json")).resolves.toEqual({
      status: "absent",
    });
  });

  it("treats any other HTTP failure as absent too", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(null, 500));
    await expect(fetchSurface("x.json")).resolves.toEqual({ status: "absent" });
  });

  it("distinguishes an UNREADABLE VERSION from a malformed file", async () => {
    // A future v2 is not a corrupt document — it is one this build cannot read. One is a
    // migration, the other is a defect, and a single "unusable" would hide which.
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ ...parliamentaryCountry, schemaVersion: 2 }),
    );
    await expect(fetchSurface("x.json")).resolves.toEqual({
      status: "unusable",
      reason: "schema_version",
    });

    vi.stubGlobal("fetch", async () =>
      jsonResponse({ schemaVersion: ELECTION_SURFACE_VERSION, kind: "nope" }),
    );
    await expect(fetchSurface("x.json")).resolves.toEqual({
      status: "unusable",
      reason: "malformed",
    });
  });

  it("survives a body that is not JSON at all", async () => {
    // The shape CI hits when a data path falls through to the SPA catch-all: a 200, an
    // `application/json` content type from the header rule, and HTML in the body.
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      url: "u",
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    await expect(fetchSurface("x.json")).resolves.toEqual({
      status: "unusable",
      reason: "malformed",
    });
  });
});

describe("a network failure is reported, not silently absent", () => {
  beforeEach(() => __resetSurfaceWarnings());
  afterEach(() => vi.unstubAllGlobals());

  it("names a rejected fetch instead of letting it read as an unpublished cycle", async () => {
    // ⚠ THE FAILURE THAT LOOKS LIKE ROUTINE ABSENCE. `fetch` rejects on a network error, a DNS
    // failure, and — the one this repo has actually hit — a CORS misconfiguration on the data
    // bucket. Uncaught, it propagated into React Query, retried, resolved to `absent`, and
    // reached the reader as the same silent legacy fallback an unpublished cycle produces:
    // every surface on the site missing, and nothing in the log to say why.
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchSurface("x.json")).resolves.toEqual({ status: "absent" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/network or CORS/);
  });

  it("keeps it distinct from an unpublished cycle", async () => {
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await fetchSurface("a.json");
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    await fetchSurface("b.json");
    expect(warn).toHaveBeenCalledTimes(2);
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => /network or CORS/.test(m))).toBe(true);
    expect(msgs.some((m) => /not published/.test(m))).toBe(true);
  });
});

describe("one definition of which states render the surface", () => {
  it("is the predicate the boundary branches on", () => {
    // It was declared "so a gate can enumerate the rule" and used by nothing, while the
    // component tested `status === "ready"` itself — two definitions of the most consequential
    // rule in the phase.
    expect([...RENDERS_SURFACE]).toEqual(["ready"]);
    expect(
      rendersSurface({ status: "ready", surface: parliamentaryCountry }),
    ).toBe(true);
    for (const s of [
      { status: "loading" },
      { status: "canonical" },
      { status: "embedded" },
      { status: "none" },
      { status: "absent" },
      { status: "unusable", reason: "malformed" },
    ] as const)
      expect(rendersSurface(s), s.status).toBe(false);
  });

  it("is read by the boundary, not restated there", () => {
    // A source scan, because the DOM cannot tell one implementation from the other while both
    // happen to agree.
    const src = stripComments(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "src/screens/elections/ElectionSurfaceBoundary.tsx",
        ),
        "utf8",
      ),
    );
    expect(src).toContain("rendersSurface(");
    expect(
      /status\s*[!=]==\s*"ready"/.test(src),
      "the boundary compares the status itself — that is a second definition",
    ).toBe(false);
  });
});

describe("the fallback is logged ONCE per process, per reason", () => {
  beforeEach(() => __resetSurfaceWarnings());
  afterEach(() => vi.unstubAllGlobals());

  it("warns once for a repeated absence", async () => {
    // Phase 2's gate. Once, because these are the highest-traffic pages on the site and a
    // per-render warning is a log nobody reads.
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    await fetchSurface("same.json");
    await fetchSurface("same.json");
    await fetchSurface("same.json");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps an expected absence and a real defect distinguishable", async () => {
    // ⚠ PER REASON, NOT PER PROCESS. "No artifact for this cycle" is routine; "the published
    // artifact is malformed" is a defect. One shared key would silence whichever came second.
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    vi.stubGlobal("fetch", async () => jsonResponse(null, 404));
    await fetchSurface("a.json");
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ schemaVersion: 1, kind: "nope" }),
    );
    await fetchSurface("b.json");
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /not published/.test(m))).toBe(true);
    expect(messages.some((m) => /malformed/.test(m))).toBe(true);
  });

  it("is resettable, so the guard itself is testable", () => {
    const warn = vi.fn();
    vi.stubGlobal("console", { ...console, warn });
    warnOnce("k", "m");
    warnOnce("k", "m");
    expect(warn).toHaveBeenCalledTimes(1);
    __resetSurfaceWarnings();
    warnOnce("k", "m");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
