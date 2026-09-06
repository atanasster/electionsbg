// The transfer hook's four states, and the one refusal that is the whole point of it.
//
// ⚠ A PAYLOAD THAT LOST ITS CAVEAT IS `unusable`, NOT `ready`. `basis` is the sentence saying
// the matrix is an estimate consistent with the data rather than counted people; without it
// the Sankey publishes individual behaviour inferred from aggregates, at a 200, looking
// exactly like a working chart. Nothing downstream can restore it — the sentence lives in the
// artifact precisely so a surface cannot supply its own.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRunoffTransferWarnings,
  fetchRunoffTransfer,
  isRunoffTransfer,
  runoffTransferPath,
} from "./useRunoffTransfer";

const MATRIX = {
  fromNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 10 }],
  toNodes: [{ id: "t6", label: "Р", labelEn: "R", color: "#000", votes: 12 }],
  flows: [{ from: "t6", to: "t6", votes: 10 }],
};

const payload = (over: Record<string, unknown> = {}) => ({
  cycle: "2021_11_14_pvr",
  basis: "Оценка, не наблюдение.",
  basisEn: "An estimate, not an observation.",
  finalists: [
    { number: 6, president: "Р", votes: 12 },
    { number: 15, president: "Г", votes: 6 },
  ],
  national: { matrix: MATRIX, sections: 1, droppedVotes: 0, marginGap: 0.01 },
  oblasts: [],
  coverage: { basis: "b", basisEn: "b" },
  residue: {
    round1Only: [],
    round2Only: [],
    round1OnlyVotes: 0,
    round2OnlyVotes: 0,
  },
  ...over,
});

afterEach(() => {
  __resetRunoffTransferWarnings();
  vi.restoreAllMocks();
});

const respond = (init: { status: number; body?: unknown }) => {
  globalThis.fetch = vi.fn(async () =>
    init.status === 200
      ? new Response(JSON.stringify(init.body), { status: 200 })
      : new Response("", { status: init.status }),
  ) as unknown as typeof fetch;
};

describe("isRunoffTransfer", () => {
  it("accepts a complete payload", () => {
    expect(isRunoffTransfer(payload())).toBe(true);
  });

  it.each([
    ["basis", { basis: "" }],
    ["basisEn", { basisEn: undefined }],
    ["coverage.basis", { coverage: { basisEn: "b" } }],
    ["coverage.basisEn", { coverage: { basis: "b" } }],
  ])("refuses a payload that lost %s", (_name, over) => {
    // ⚠ BOTH LANGUAGES, BOTH LEVELS. An EN reader of a file carrying only the Bulgarian
    // sentence gets the chart with no caveat at all — the same failure, in one locale.
    expect(isRunoffTransfer(payload(over))).toBe(false);
  });

  it("refuses a payload with no matrix, and one whose finalists are not a pair", () => {
    expect(isRunoffTransfer(payload({ national: { matrix: {} } }))).toBe(false);
    expect(
      isRunoffTransfer(payload({ finalists: [{ number: 6, president: "Р" }] })),
    ).toBe(false);
  });
});

describe("fetchRunoffTransfer", () => {
  it("reads a 404 as ABSENT — a cycle decided in round 1 has no transfer to estimate", async () => {
    respond({ status: 404 });
    await expect(fetchRunoffTransfer("2021_11_14_pvr")).resolves.toEqual({
      status: "absent",
    });
  });

  it("reads a 500 as UNUSABLE, which is a different instruction to the screen", async () => {
    // ⚠ NOT `absent`. „Not published" is the corpus's ordinary state and draws nothing
    // quietly; „the bucket is answering with errors" is a defect and gets a log line.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 500 });
    await expect(fetchRunoffTransfer("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses a 200 that lost the caveat, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respond({ status: 200, body: payload({ basis: "" }) });
    await expect(fetchRunoffTransfer("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    await fetchRunoffTransfer("2021_11_14_pvr");
    // Once per process per reason: a per-render warning is a log nobody reads.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads a 200 carrying the SPA shell as unusable, not as a cycle with no runoff", async () => {
    // ⚠ NOT HYPOTHETICAL IN THIS REPO. A `data/**` fetch that misses the bucket falls through
    // to the SPA catch-all and comes back 200 with `dist/index.html`, which `firebase.json`
    // stamps `application/json` — a fetch that looks successful right up to `JSON.parse`. It is
    // the exact signature of a missing `VITE_DATA_BASE_URL` or a missing bucket-CORS entry, and
    // the one path that separates „not published" from „the data origin is misconfigured".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<!doctype html><html>…", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    await expect(fetchRunoffTransfer("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads a rejected fetch as unusable rather than as routine absence", async () => {
    // A CORS misconfiguration on the data bucket takes every cycle out at once; uncaught it
    // would reach the reader as „this cycle has no runoff estimate".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchRunoffTransfer("2021_11_14_pvr")).resolves.toEqual({
      status: "unusable",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns the payload when it is whole", async () => {
    respond({ status: 200, body: payload() });
    const res = await fetchRunoffTransfer("2021_11_14_pvr");
    expect(res.status).toBe("ready");
  });
});

describe("runoffTransferPath", () => {
  it("names the file the builder writes", () => {
    expect(runoffTransferPath("2021_11_14_pvr")).toBe(
      "2021_11_14_pvr/runoff_transfer.json",
    );
  });
});
